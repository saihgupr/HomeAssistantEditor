/**
 * Home Assistant Editor - Express Server
 * API backend for automation and script CRUD operations
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import {
    extractAutomations,
    extractScripts,
    getAutomation,
    getScript,
    updateAutomation,
    updateScript,
    createAutomation,
    createScript,
    deleteAutomation,
    deleteScript,
    automationToYaml,
    scriptToYaml,
    yamlToAutomation,
    validateAutomation,
    getFolders,
    saveFolders,
    getRawAutomationYaml,
    getRawScriptYaml
} from './automation-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 54002;
const CONFIG_PATH = process.env.CONFIG_PATH || '/config';
const HA_URL = process.env.HA_URL ? process.env.HA_URL.replace(/\/$/, '') : null; // Remove trailing slash if present

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// ============================================
// Helper function to call Home Assistant services
// ============================================

async function callHomeAssistantService(domain, service, serviceData = {}) {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[HA Service] No supervisor token available - running in dev mode');
        return { success: true, message: 'Dev mode - service call simulated' };
    }

    const apiUrl = HA_URL
        ? `${HA_URL}/api/services/${domain}/${service}`
        : `http://supervisor/core/api/services/${domain}/${service}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(serviceData)
        });

        if (!response.ok) {
            throw new Error(`HA API returned ${response.status}`);
        }

        const data = await response.json();
        console.log(`[HA Service] Called ${domain}.${service} successfully`);
        return { success: true, data };
    } catch (error) {
        console.error(`[HA Service] Error calling ${domain}.${service}:`, error.message);
        throw error;
    }
}

async function callHAWebSocket(payload) {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    if (!supervisorToken) {
        throw new Error('No supervisor token');
    }

    return new Promise((resolve, reject) => {
        // Determine WebSocket URL
        let wsUrl;
        if (HA_URL) {
            // Convert http(s) to ws(s)
            wsUrl = HA_URL.startsWith('https')
                ? HA_URL.replace('https', 'wss') + '/api/websocket'
                : HA_URL.replace('http', 'ws') + '/api/websocket';
        } else {
            wsUrl = 'ws://supervisor/core/websocket';
        }

        const ws = new WebSocket(wsUrl);
        let interactionId = 1;

        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('WebSocket timeout'));
        }, 5000);

        ws.on('open', () => {
            // console.log('[WS] Connected');
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'auth_required') {
                    ws.send(JSON.stringify({
                        type: 'auth',
                        access_token: supervisorToken
                    }));
                } else if (msg.type === 'auth_ok') {
                    // Send the actual command
                    ws.send(JSON.stringify({
                        id: interactionId,
                        ...payload
                    }));
                } else if (msg.type === 'result' && msg.id === interactionId) {
                    clearTimeout(timeout);
                    ws.close();
                    if (msg.success) {
                        resolve(msg.result);
                    } else {
                        reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
                    }
                } else if (msg.type === 'auth_invalid') {
                    clearTimeout(timeout);
                    ws.close();
                    reject(new Error('Auth invalid'));
                }
            } catch (e) {
                console.error('[WS] Error parsing message:', e);
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

async function cleanupOrphanedEntities() {
    console.log('[Cleanup] Starting orphaned entity cleanup...');
    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[Cleanup] No supervisor token available - running in dev mode');
        return;
    }

    try {
        // 1. Fetch all states
        const apiUrl = HA_URL
            ? `${HA_URL}/api/states`
            : 'http://supervisor/core/api/states';

        const statesResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!statesResponse.ok) {
            throw new Error(`Failed to fetch states: ${statesResponse.status}`);
        }

        const states = await statesResponse.json();

        // 2. Identify orphaned (restored) entities
        const orphans = states.filter(s => s.attributes && s.attributes.restored === true);

        if (orphans.length === 0) {
            console.log('[Cleanup] No orphaned entities found.');
            return;
        }

        console.log(`[Cleanup] Found ${orphans.length} orphaned entities. Deleting...`);

        // 3. Delete them via WebSocket
        let deletedCount = 0;
        for (const orphan of orphans) {
            try {
                console.log(`[Cleanup] Removing ${orphan.entity_id} from registry...`);

                // Remove from Entity Registry via WebSocket
                await callHAWebSocket({
                    type: 'config/entity_registry/remove',
                    entity_id: orphan.entity_id
                });

                console.log(`[Cleanup] Successfully removed orphan from registry: ${orphan.entity_id}`);
                deletedCount++;

                // Note: We cannot remove the state object via public API (REST or WS) easily.
                // However, removing it from the registry solves the "ghost" issue for the user's config
                // and it will disappear from memory on the next restart (or often immediately from UI lists).

            } catch (err) {
                console.error(`[Cleanup] Error removing ${orphan.entity_id}:`, err.message);
            }
        }

        console.log(`[Cleanup] Cleanup complete. Removed ${deletedCount} entities.`);

    } catch (error) {
        console.error('[Cleanup] Error during cleanup:', error.message);
    }
}

async function checkConfig() {
    // console.log('[Check Config] Checking configuration...');
    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[Check Config] No supervisor token available - returning valid (dev mode)');
        return { result: 'valid', errors: null };
    }

    try {
        const apiUrl = HA_URL
            ? `${HA_URL}/api/config/core/check_config`
            : 'http://supervisor/core/api/config/core/check_config';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HA API returned ${response.status}`);
        }

        const data = await response.json();
        console.log(`[Check Config] Result: ${data.result}`);
        return data;
    } catch (error) {
        console.error('[Check Config] Error:', error.message);
        throw error;
    }
}

// ============================================
// API Routes - Automations
// ============================================

// List all automations
app.get('/api/automations', async (req, res) => {
    try {
        const automations = await extractAutomations(CONFIG_PATH);
        res.json({ success: true, automations });
    } catch (error) {
        console.error('[API] Error fetching automations:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single automation
app.get('/api/automation/:id', async (req, res) => {
    try {
        const automation = await getAutomation(req.params.id, CONFIG_PATH);
        if (!automation) {
            return res.status(404).json({ success: false, error: 'Automation not found' });
        }

        // Include YAML representation
        const yamlContent = automationToYaml(automation);
        res.json({ success: true, automation, yaml: yamlContent });
    } catch (error) {
        console.error('[API] Error fetching automation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get raw YAML for an automation (preserves original formatting)
app.get('/api/automation/:id/raw-yaml', async (req, res) => {
    try {
        const rawYaml = await getRawAutomationYaml(req.params.id, CONFIG_PATH);
        if (!rawYaml) {
            return res.status(404).json({ success: false, error: 'Automation not found' });
        }
        res.json({ success: true, yaml: rawYaml });
    } catch (error) {
        console.error('[API] Error fetching raw automation YAML:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new automation
app.post('/api/automation', async (req, res) => {
    try {
        const automation = await createAutomation(req.body, CONFIG_PATH);
        res.json({ success: true, automation });
    } catch (error) {
        console.error('[API] Error creating automation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update automation
app.put('/api/automation/:id', async (req, res) => {
    try {
        await updateAutomation(req.params.id, req.body, CONFIG_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Error updating automation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete automation
app.delete('/api/automation/:id', async (req, res) => {
    try {
        await deleteAutomation(req.params.id, CONFIG_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Error deleting automation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// API Routes - Scripts
// ============================================

// List all scripts
app.get('/api/scripts', async (req, res) => {
    try {
        const scripts = await extractScripts(CONFIG_PATH);
        res.json({ success: true, scripts });
    } catch (error) {
        console.error('[API] Error fetching scripts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single script
app.get('/api/script/:id', async (req, res) => {
    try {
        const script = await getScript(req.params.id, CONFIG_PATH);
        if (!script) {
            return res.status(404).json({ success: false, error: 'Script not found' });
        }

        const yamlContent = scriptToYaml(script);
        res.json({ success: true, script, yaml: yamlContent });
    } catch (error) {
        console.error('[API] Error fetching script:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get raw YAML for a script (preserves original formatting)
app.get('/api/script/:id/raw-yaml', async (req, res) => {
    try {
        const rawYaml = await getRawScriptYaml(req.params.id, CONFIG_PATH);
        if (!rawYaml) {
            return res.status(404).json({ success: false, error: 'Script not found' });
        }
        res.json({ success: true, yaml: rawYaml });
    } catch (error) {
        console.error('[API] Error fetching raw script YAML:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new script
app.post('/api/script', async (req, res) => {
    try {
        const script = await createScript(req.body, CONFIG_PATH);
        res.json({ success: true, script });
    } catch (error) {
        console.error('[API] Error creating script:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update script
app.put('/api/script/:id', async (req, res) => {
    try {
        await updateScript(req.params.id, req.body, CONFIG_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Error updating script:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete script
app.delete('/api/script/:id', async (req, res) => {
    try {
        await deleteScript(req.params.id, CONFIG_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Error deleting script:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// API Routes - Folders
// ============================================

// List all folders
app.get('/api/folders', async (req, res) => {
    try {
        const folders = getFolders(CONFIG_PATH);
        res.json({ success: true, folders });
    } catch (error) {
        console.error('[API] Error fetching folders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save folder structure
app.post('/api/folders', async (req, res) => {
    try {
        saveFolders(req.body, CONFIG_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Error saving folders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// API Routes - HA Integration
// ============================================

// Reload automations in HA
app.post('/api/reload/automations', async (req, res) => {
    try {
        await callHomeAssistantService('automation', 'reload');

        // Trigger Spook cleanup AFTER reload ensures HA knows about the deleted entities
        cleanupOrphanedEntities().catch(e => console.error(e));

        res.json({ success: true, message: 'Automations reloaded' });
    } catch (error) {
        console.error('[API] Error reloading automations:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reload scripts in HA
app.post('/api/reload/scripts', async (req, res) => {
    try {
        await callHomeAssistantService('script', 'reload');

        // Trigger Spook cleanup AFTER reload ensures HA knows about the deleted entities
        cleanupOrphanedEntities().catch(e => console.error(e));

        res.json({ success: true, message: 'Scripts reloaded' });
    } catch (error) {
        console.error('[API] Error reloading scripts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check HA Configuration
app.post('/api/check_config', async (req, res) => {
    try {
        const result = await checkConfig();
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Error checking config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// API Routes - Version Control Proxy
// Proxies requests to HomeAssistantVersionControlBeta addon
// ============================================

// Helper: Make request to Version Control addon
// Uses Supervisor API to discover addon hostname, with caching
let versionControlHost = null;
const VERSION_CONTROL_PORT = 54001;
const VERSION_CONTROL_SLUG = 'home-assistant-version-control';

async function discoverVersionControlHost() {
    // Already discovered
    if (versionControlHost) return versionControlHost;

    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    if (!supervisorToken) {
        console.log('[Version Control] No supervisor token - using dev mode fallback');
        return null;
    }

    try {
        if (HA_URL) {
            console.log('[Version Control] Standalone mode (HA_URL set) - Version Control discovery not supported yet via API');
            return null;
        }

        // Query Supervisor API to get list of addons
        const response = await fetch('http://supervisor/addons', {
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('[Version Control] Failed to query Supervisor addons API:', response.status);
            return null;
        }

        const data = await response.json();
        const addons = data.data?.addons || [];

        // Find Version Control addon
        const vcAddon = addons.find(a => a.slug && a.slug.includes('version-control'));
        if (vcAddon) {
            // The internal hostname is the slug with underscores replaced by hyphens
            versionControlHost = vcAddon.slug.replace(/_/g, '-');
            console.log(`[Version Control] Discovered addon: slug=${vcAddon.slug}, hostname=${versionControlHost}`);
            return versionControlHost;
        }

        console.log('[Version Control] Version Control addon not found in addon list');
        return null;
    } catch (error) {
        console.log('[Version Control] Error discovering addon:', error.message);
        return null;
    }
}

async function callVersionControlAPI(path) {
    const host = await discoverVersionControlHost();

    if (host) {
        // Try internal addon-to-addon communication
        const url = `http://${host}:${VERSION_CONTROL_PORT}${path}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                return await response.json();
            }
            console.log(`[Version Control] Internal request failed with status: ${response.status}`);
        } catch (error) {
            console.log(`[Version Control] Internal request failed: ${error.message}`);
        }
    }

    throw new Error('Version Control addon not available');
}

// Check if Version Control addon is available
app.get('/api/version-control/status', async (req, res) => {
    try {
        const result = await callVersionControlAPI('/api/automations');
        res.json({ success: true, available: true });
    } catch (error) {
        console.log('[Version Control] Status check failed:', error.message);
        res.json({ success: true, available: false, reason: error.message });
    }
});

// Get automation history metadata (list of commits)
app.get('/api/version-control/automation/:id/history-metadata', async (req, res) => {
    try {
        const result = await callVersionControlAPI(`/api/automation/${encodeURIComponent(req.params.id)}/history-metadata`);
        res.json(result);
    } catch (error) {
        console.error('[Version Control] Error fetching automation history:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get automation content at specific commit
app.get('/api/version-control/automation/:id/at-commit', async (req, res) => {
    try {
        const { commitHash } = req.query;
        if (!commitHash) {
            return res.status(400).json({ success: false, error: 'commitHash is required' });
        }
        const result = await callVersionControlAPI(`/api/automation/${encodeURIComponent(req.params.id)}/at-commit?commitHash=${encodeURIComponent(commitHash)}`);
        res.json(result);
    } catch (error) {
        console.error('[Version Control] Error fetching automation at commit:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get script history metadata (list of commits)
app.get('/api/version-control/script/:id/history-metadata', async (req, res) => {
    try {
        const result = await callVersionControlAPI(`/api/script/${encodeURIComponent(req.params.id)}/history-metadata`);
        res.json(result);
    } catch (error) {
        console.error('[Version Control] Error fetching script history:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get script content at specific commit
app.get('/api/version-control/script/:id/at-commit', async (req, res) => {
    try {
        const { commitHash } = req.query;
        if (!commitHash) {
            return res.status(400).json({ success: false, error: 'commitHash is required' });
        }
        const result = await callVersionControlAPI(`/api/script/${encodeURIComponent(req.params.id)}/at-commit?commitHash=${encodeURIComponent(commitHash)}`);
        res.json(result);
    } catch (error) {
        console.error('[Version Control] Error fetching script at commit:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Parse YAML string to JSON object
app.post('/api/parse-yaml', (req, res) => {
    try {
        const { yaml } = req.body;
        if (yaml === undefined || yaml === null) {
            return res.status(400).json({ success: false, error: 'No YAML content provided' });
        }
        const config = yamlToAutomation(yaml);
        const errors = validateAutomation(config);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: errors.join('. ') });
        }
        res.json({ success: true, config });
    } catch (error) {
        console.error('[API] Error parsing YAML:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Trigger an automation or script
app.post('/api/run/:domain/:itemId', async (req, res) => {
    const { domain, itemId } = req.params;
    const { entity_id } = req.body;

    console.log(`[Run] Triggering ${domain}: ${itemId} (entity_id: ${entity_id})`);

    try {
        if (domain === 'automation') {
            // Priority 1: Use entity_id from request
            // Priority 2: Use slugified itemId
            const serviceData = {
                entity_id: entity_id || `automation.${itemId.toLowerCase().replace(/\s+/g, '_')}`
            };
            await callHomeAssistantService('automation', 'trigger', serviceData);
        } else if (domain === 'script') {
            // Scripts ARE the service. Priority 1: Use entity_id (strip 'script.' prefix)
            // Priority 2: Use slugified itemId
            let serviceName = itemId.toLowerCase().replace(/\s+/g, '_');
            if (entity_id && entity_id.startsWith('script.')) {
                serviceName = entity_id.replace('script.', '');
            }
            await callHomeAssistantService('script', serviceName, {});
        } else {
            return res.status(400).json({ success: false, error: 'Invalid domain' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`[Run] Error triggering ${domain}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle (enable/disable) an automation or script live
app.post('/api/run/:domain/:itemId/toggle', async (req, res) => {
    const { domain, itemId } = req.params;
    const { entity_id, enabled } = req.body;

    console.log(`[Toggle] Setting ${domain}: ${itemId} to ${enabled ? 'on' : 'off'} (entity_id: ${entity_id})`);

    try {
        if (domain === 'automation') {
            const service = enabled ? 'turn_on' : 'turn_off';
            const serviceData = {
                entity_id: entity_id || `automation.${itemId.toLowerCase().replace(/\s+/g, '_')}`
            };
            await callHomeAssistantService('automation', service, serviceData);
        } else if (domain === 'script') {
            // Scripts can also be turned on/off if they are currently running, 
            // but usually this toggle means enabling/disabling the entity.
            // In HA, scripts don't have an 'enabled' state in the same way automations do 
            // but they can be turn_on/off. However, since the user likely means 
            // enabling/disabling the automation, we'll focus on that.
            // If they toggle a script, we'll try script.turn_on/off but it might not be what they expect.
            const service = enabled ? 'turn_on' : 'turn_off';
            const serviceData = {
                entity_id: entity_id || `script.${itemId.toLowerCase().replace(/\s+/g, '_')}`
            };
            await callHomeAssistantService('script', service, serviceData);
        } else {
            return res.status(400).json({ success: false, error: 'Invalid domain' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`[Toggle] Error toggling ${domain}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Parse YAML to JSON (for the editor)
app.post('/api/parse-yaml', async (req, res) => {
    try {
        const { yaml: yamlContent } = req.body;
        const parsed = yamlToAutomation(yamlContent);
        res.json({ success: true, data: parsed });
    } catch (error) {
        console.error('[API] Error parsing YAML:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================
// API Routes - Traces
// ============================================

// Helper: Format steps from raw HA trace data
function formatTraceSteps(traceData) {
    const steps = [];
    if (traceData && typeof traceData === 'object') {
        for (const [path, stepData] of Object.entries(traceData)) {
            if (Array.isArray(stepData) && stepData.length > 0) {
                const step = stepData[0];
                const changedVars = step.changed_variables || {};

                // Extract entity and description from trigger data
                let entityId = null;
                let description = null;
                if (changedVars.trigger) {
                    entityId = changedVars.trigger.entity_id;
                    description = changedVars.trigger.description;
                }

                // Format result for display
                let resultText = null;
                if (step.result) {
                    if (step.result.choice) {
                        resultText = `→ ${step.result.choice}`;
                    } else if (step.result.result === true) {
                        resultText = '✓ passed';
                    } else if (step.result.result === false) {
                        resultText = '✗ failed';
                    } else if (typeof step.result === 'object') {
                        resultText = JSON.stringify(step.result);
                    }
                }

                steps.push({
                    path: path,
                    timestamp: step.timestamp,
                    result: step.result || null,
                    resultText: resultText,
                    error: step.error || null,
                    entityId: entityId,
                    description: description
                });
            }
        }
    }
    return steps;
}

// Helper: Fetch traces via WebSocket (for live traces)
async function fetchTracesViaWebSocket(domain, itemId, fetchDetails = false) {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    if (!supervisorToken) {
        console.log('[WS Traces] No supervisor token, skipping WebSocket');
        return null;
    }

    return new Promise((resolve, reject) => {
        // Determine WebSocket URL
        let wsUrl;
        if (HA_URL) {
            wsUrl = HA_URL.startsWith('https')
                ? HA_URL.replace('https', 'wss') + '/api/websocket'
                : HA_URL.replace('http', 'ws') + '/api/websocket';
        } else {
            wsUrl = 'ws://supervisor/core/websocket';
        }

        const ws = new WebSocket(wsUrl);
        let msgId = 1;
        let traceList = [];
        const detailRequests = new Map(); // To track detail requests by msgId
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('WebSocket timeout'));
        }, 15000); // Increased timeout for multiple detail fetches

        ws.on('open', () => {
            console.log('[WS Traces] Connected to HA WebSocket');
        });

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'auth_required') {
                    ws.send(JSON.stringify({
                        type: 'auth',
                        access_token: supervisorToken
                    }));
                } else if (msg.type === 'auth_ok') {
                    console.log('[WS Traces] Authenticated, requesting traces');
                    ws.send(JSON.stringify({
                        id: msgId++,
                        type: 'trace/list',
                        domain: domain,
                        item_id: itemId
                    }));
                } else if (msg.type === 'result') {
                    if (detailRequests.has(msg.id)) {
                        // This is a detail result
                        const { run_id, resolveDetail } = detailRequests.get(msg.id);
                        detailRequests.delete(msg.id);

                        if (msg.success && msg.result && msg.result.trace) {
                            const detailedTrace = msg.result;
                            const originalSummary = traceList.find(t => t.run_id === detailedTrace.run_id);
                            if (originalSummary) {
                                originalSummary.full_trace = detailedTrace.trace;
                            }
                        }
                        resolveDetail(); // Resolve the individual detail fetch promise

                        // Check if all detail requests have been processed
                        if (detailRequests.size === 0) {
                            clearTimeout(timeout);
                            ws.close();
                            resolve(traceList);
                        }
                    } else if (Array.isArray(msg.result)) {
                        // This is the trace/list result
                        traceList = msg.result;
                        console.log(`[WS Traces] Got ${traceList.length} trace summaries`);

                        if (!fetchDetails || traceList.length === 0) {
                            clearTimeout(timeout);
                            ws.close();
                            resolve(traceList);
                        } else {
                            // Fetch details for the first 5 traces (or fewer)
                            const tracesToFetch = traceList.slice(0, 5);
                            const detailPromises = [];

                            for (const t of tracesToFetch) {
                                const currentMsgId = msgId++;
                                detailPromises.push(new Promise(resDetail => {
                                    detailRequests.set(currentMsgId, { run_id: t.run_id, resolveDetail: resDetail });
                                    ws.send(JSON.stringify({
                                        id: currentMsgId,
                                        type: 'trace/get',
                                        domain: domain,
                                        item_id: itemId,
                                        run_id: t.run_id
                                    }));
                                }));
                            }
                            // Wait for all detail fetches to complete
                            Promise.all(detailPromises).then(() => {
                                // This block will only execute if all detail requests were sent and their results handled
                                // The final resolve is handled by the last detail result received
                            }).catch(err => {
                                console.error('[WS Traces] Error fetching details:', err);
                                clearTimeout(timeout);
                                ws.close();
                                reject(err);
                            });
                        }
                    } else {
                        // Success but no data or unexpected format for list or detail
                        if (fetchDetails && detailRequests.size > 0) {
                            // If we were waiting for details but got an unexpected result,
                            // we might be stuck. Resolve what we have.
                            console.warn('[WS Traces] Unexpected result while fetching details. Resolving partial traces.');
                            clearTimeout(timeout);
                            ws.close();
                            resolve(traceList);
                        } else if (!fetchDetails) {
                            // If not fetching details and got an unexpected result, resolve empty.
                            clearTimeout(timeout);
                            ws.close();
                            resolve([]);
                        }
                    }
                } else if (msg.type === 'auth_invalid') {
                    clearTimeout(timeout);
                    ws.close();
                    reject(new Error('Auth invalid'));
                }
            } catch (e) {
                console.error('[WS Traces] Error handling message:', e);
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            console.error('[WS Traces] Error:', err.message);
            reject(err);
        });

        ws.on('close', () => {
            console.log('[WS Traces] Connection closed');
            if (detailRequests.size > 0) {
                // If connection closes before all details are fetched, resolve with what we have
                console.warn('[WS Traces] Connection closed before all detail requests completed. Resolving partial traces.');
                clearTimeout(timeout);
                resolve(traceList);
            }
        });
    });
}

// Get run history for an automation (merges live WebSocket traces with historical file data)
app.get('/api/traces/:domain/:itemId', async (req, res) => {
    const { domain, itemId } = req.params;

    // Normalization for matching
    const normalizedItemSearch = itemId.toLowerCase().replace(/[\s_]+/g, '');
    const titleCaseItemId = itemId
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    let allTraces = [];

    // 1. Try to get live traces via WebSocket (with details for first few)
    try {
        const wsTraces = await fetchTracesViaWebSocket(domain, titleCaseItemId, true);
        if (wsTraces && wsTraces.length > 0) {
            console.log(`[Traces] Got ${wsTraces.length} live traces via WebSocket`);
            wsTraces.forEach(t => {
                allTraces.push({
                    run_id: t.run_id,
                    timestamp: t.timestamp?.start,
                    finish_time: t.timestamp?.finish,
                    state: t.state,
                    script_execution: t.script_execution,
                    trigger: t.trigger || 'unknown',
                    error: t.script_execution === 'failed_single' ? 'Already running' : null,
                    last_step: t.last_step,
                    steps: formatTraceSteps(t.full_trace),
                    source: 'websocket'
                });
            });
        }
    } catch (wsError) {
        console.log('[Traces] WebSocket fetch failed:', wsError.message);
    }

    // 2. Try to read the saved_traces file for historical data
    try {
        const savedTracesPath = path.join(CONFIG_PATH, '.storage', 'trace.saved_traces');
        if (fs.existsSync(savedTracesPath)) {
            const savedTraces = JSON.parse(fs.readFileSync(savedTracesPath, 'utf8'));
            const entityKey = `${domain}.${itemId}`;
            let fileTraces = savedTraces.data?.[entityKey] || [];

            // If not found by direct key, try normalized search
            if (fileTraces.length === 0) {
                for (const [key, traces] of Object.entries(savedTraces.data || {})) {
                    const keyParts = key.split('.');
                    const keyItemId = keyParts.slice(1).join('.'); // Everything after domain.
                    const normalizedKey = keyItemId.toLowerCase().replace(/[\s_]+/g, '');
                    if (normalizedKey === normalizedItemSearch) {
                        fileTraces = traces;
                        break;
                    }
                }
            }

            // Merge file traces into allTraces, avoiding duplicates by run_id
            fileTraces.forEach(t => {
                const short = t.short_dict || {};
                const extended = t.extended_dict || {};
                const run_id = short.run_id || extended.run_id;

                if (!allTraces.find(existing => existing.run_id === run_id)) {
                    const isFailed = short.script_execution === 'failed_single' ||
                        short.script_execution === 'error' ||
                        (short.state === 'stopped' && extended.error);

                    allTraces.push({
                        run_id: run_id,
                        timestamp: short.timestamp?.start || extended.timestamp?.start,
                        finish_time: short.timestamp?.finish || extended.timestamp?.finish,
                        state: short.state || extended.state,
                        script_execution: short.script_execution || extended.script_execution,
                        trigger: short.trigger || extended.trigger || 'unknown',
                        error: isFailed ? (extended.error || short.script_execution) : null,
                        last_step: short.last_step || extended.last_step,
                        steps: formatTraceSteps(extended.trace),
                        source: 'saved_traces'
                    });
                }
            });
        }
    } catch (fileError) {
        console.error('[Traces] Error reading saved_traces file:', fileError.message);
    }

    // Sort by timestamp descending
    allTraces.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Limit to 50
    const finalTraces = allTraces.slice(0, 50);

    console.log(`[Traces] Returning ${finalTraces.length} merged traces`);
    res.json({ success: true, traces: finalTraces });
});

// Helper: Extract trigger info from trace
function extractTriggerInfo(trace) {
    if (trace.trigger) {
        return trace.trigger;
    }
    if (trace.context && trace.context.trigger_type) {
        return trace.context.trigger_type;
    }
    return 'manual';
}

// Helper: Extract step summary from trace
function extractStepSummary(trace) {
    const steps = [];

    if (trace.trace) {
        // Walk through the trace tree
        for (const [path, stepData] of Object.entries(trace.trace)) {
            if (Array.isArray(stepData)) {
                for (const step of stepData) {
                    steps.push({
                        path: path,
                        result: step.result || {},
                        error: step.error || null,
                        timestamp: step.timestamp
                    });
                }
            }
        }
    }

    return steps;
}

// Helper: Generate mock traces for dev mode
function generateMockTraces() {
    const now = Date.now();
    return [
        {
            run_id: 'mock_1',
            timestamp: new Date(now - 3600000).toISOString(), // 1 hour ago
            state: 'stopped',
            trigger: 'state',
            error: null,
            steps: [
                { path: 'trigger/0', result: { triggered: true }, error: null },
                { path: 'action/0', result: { done: true }, error: null }
            ]
        },
        {
            run_id: 'mock_2',
            timestamp: new Date(now - 7200000).toISOString(), // 2 hours ago
            state: 'stopped',
            trigger: 'time',
            error: null,
            steps: [
                { path: 'trigger/0', result: { triggered: true }, error: null },
                { path: 'condition/0', result: { result: false }, error: null }
            ]
        },
        {
            run_id: 'mock_3',
            timestamp: new Date(now - 86400000).toISOString(), // Yesterday
            state: 'stopped',
            trigger: 'state',
            error: 'Service not found: light.turn_on_fake',
            steps: [
                { path: 'trigger/0', result: { triggered: true }, error: null },
                { path: 'action/0', result: {}, error: 'Service not found' }
            ]
        }
    ];
}

// ============================================
// Debug endpoint
// ============================================

// Debug trace API connectivity - tries multiple endpoints
app.get('/api/debug/traces/:domain/:itemId', async (req, res) => {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    const { domain, itemId } = req.params;

    const debug = {
        hasSupervisorToken: !!supervisorToken,
        tokenPreview: supervisorToken ? `${supervisorToken.substring(0, 10)}...` : 'MISSING',
        domain,
        itemId,
        entityId: `${domain}.${itemId}`,
        attempts: []
    };

    if (!supervisorToken) {
        debug.result = 'No supervisor token - cannot make HA API call';
        return res.json(debug);
    }

    // Try multiple possible endpoints
    const endpointsToTry = [
        `http://supervisor/core/api/trace/${domain}/${itemId}`,
        `http://supervisor/core/api/logbook/${domain}.${itemId}`,
        `http://supervisor/core/api/history/period?filter_entity_id=${domain}.${itemId}`,
        `http://supervisor/core/api/trace/debug/${domain}.${itemId}`,
        `http://supervisor/core/api/config/automation/trace/${itemId}`
    ];

    for (const url of endpointsToTry) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${supervisorToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const attempt = {
                url,
                status: response.status,
                ok: response.ok
            };

            if (response.ok) {
                const data = await response.json();
                attempt.dataType = Array.isArray(data) ? 'array' : typeof data;
                attempt.dataLength = Array.isArray(data) ? data.length : null;
                attempt.sample = Array.isArray(data) && data.length > 0
                    ? JSON.stringify(data[0]).substring(0, 200)
                    : JSON.stringify(data).substring(0, 200);
                attempt.success = true;
            } else {
                attempt.error = await response.text().catch(() => 'Could not read error');
            }

            debug.attempts.push(attempt);
        } catch (error) {
            debug.attempts.push({
                url,
                error: error.message
            });
        }
    }

    // Find the first successful attempt
    const success = debug.attempts.find(a => a.success);
    debug.workingEndpoint = success ? success.url : null;

    res.json(debug);
});

app.get('/api/debug', async (req, res) => {
    const fs = await import('fs');
    const debug = {
        configPath: CONFIG_PATH,
        env: {
            CONFIG_PATH: process.env.CONFIG_PATH,
            SUPERVISOR_TOKEN: process.env.SUPERVISOR_TOKEN ? 'present' : 'missing'
        },
        files: {},
        errors: []
    };

    try {
        // Check if config path exists
        const configExists = await fs.promises.access(CONFIG_PATH).then(() => true).catch(() => false);
        debug.configPathExists = configExists;

        if (configExists) {
            // List files in config directory
            const files = await fs.promises.readdir(CONFIG_PATH);
            debug.files.configDir = files.slice(0, 20); // First 20 files

            // Check for specific files
            const checkFiles = ['configuration.yaml', 'automations.yaml', 'scripts.yaml'];
            for (const file of checkFiles) {
                const filePath = `${CONFIG_PATH}/${file}`;
                try {
                    const stat = await fs.promises.stat(filePath);
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    debug.files[file] = {
                        exists: true,
                        size: stat.size,
                        preview: content.substring(0, 500)
                    };
                } catch (e) {
                    debug.files[file] = { exists: false, error: e.message };
                }
            }
        }

        // Try to extract automations
        try {
            const automations = await extractAutomations(CONFIG_PATH);
            debug.automationsFound = automations.length;
            debug.automationsSample = automations.slice(0, 3).map(a => ({ id: a.id, alias: a.alias }));
        } catch (e) {
            debug.errors.push(`extractAutomations: ${e.message}`);
        }

        // Try to extract scripts
        try {
            const scripts = await extractScripts(CONFIG_PATH);
            debug.scriptsFound = scripts.length;
            debug.scriptsSample = scripts.slice(0, 3).map(s => ({ id: s.id, alias: s.alias }));
        } catch (e) {
            debug.errors.push(`extractScripts: ${e.message}`);
        }

    } catch (error) {
        debug.errors.push(error.message);
    }

    res.json(debug);
});

// Get all states from Home Assistant
app.get('/api/states', async (req, res) => {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[API] No supervisor token available - returning mock states');
        // Return empty array or mock data in dev mode
        return res.json({ success: true, states: [] });
    }

    try {
        const response = await fetch('http://supervisor/core/api/states', {
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HA API returned ${response.status}`);
        }

        const states = await response.json();
        res.json({ success: true, states });
    } catch (error) {
        console.error('[API] Error fetching states:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get entities list for entity picker (simplified format)
app.get('/api/entities', async (req, res) => {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    const { domain } = req.query; // Optional domain filter

    if (!supervisorToken) {
        console.log('[API] No supervisor token available - returning mock entities');
        return res.json({ success: true, entities: [] });
    }

    try {
        const response = await fetch('http://supervisor/core/api/states', {
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HA API returned ${response.status}`);
        }

        const states = await response.json();

        // Transform to simplified entity format
        let entities = states.map(state => ({
            entity_id: state.entity_id,
            friendly_name: state.attributes?.friendly_name || state.entity_id.split('.')[1],
            domain: state.entity_id.split('.')[0],
            state: state.state,
            icon: state.attributes?.icon || null
        }));

        // Filter by domain if specified
        if (domain) {
            entities = entities.filter(e => e.domain === domain);
        }

        // Sort alphabetically by friendly_name
        entities.sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));

        res.json({ success: true, entities });
    } catch (error) {
        console.error('[API] Error fetching entities:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get services list for service picker
app.get('/api/services', async (req, res) => {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[API] No supervisor token available - returning mock services');
        return res.json({
            success: true,
            services: [
                {
                    service_id: 'adguard.add_url',
                    domain: 'adguard',
                    name: 'Add URL',
                    description: 'Adds a new URL filter to AdGuard Home.',
                    fields: {
                        url: {
                            name: 'URL',
                            description: 'The URL to block or allow.',
                            selector: { text: {} }
                        },
                        name: {
                            name: 'Name',
                            description: 'Optional name for the filter.',
                            selector: { text: {} }
                        }
                    }
                },
                {
                    service_id: 'light.turn_on',
                    domain: 'light',
                    name: 'Turn On',
                    description: 'Turn on one or more lights.',
                    fields: {
                        brightness: {
                            name: 'Brightness',
                            description: 'Number between 0 and 255.',
                            selector: { number: { min: 0, max: 255 } }
                        },
                        rgb_color: {
                            name: 'Color (RGB)',
                            description: 'Color for the light in RGB format.',
                            selector: { color_rgb: {} }
                        }
                    }
                },
                {
                    service_id: 'switch.turn_on',
                    domain: 'switch',
                    name: 'Turn On',
                    description: 'Turn a switch on.',
                    fields: {}
                },
                {
                    service_id: 'notify.mobile_app_iphone',
                    domain: 'notify',
                    name: 'Notify iPhone',
                    description: 'Send a notification to iPhone.',
                    fields: {
                        message: { name: 'Message', selector: { text: {} } },
                        title: { name: 'Title', selector: { text: {} } }
                    }
                }
            ].sort((a, b) => a.service_id.localeCompare(b.service_id))
        });
    }

    try {
        const response = await fetch('http://supervisor/core/api/services', {
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HA API returned ${response.status}`);
        }

        const servicesByDomain = await response.json();
        const services = [];

        // Flatten services structure: [{domain: 'light', services: {turn_on: {...}}}] -> [{service_id: 'light.turn_on', ...}]
        for (const domainData of servicesByDomain) {
            const domain = domainData.domain;
            for (const [serviceName, serviceData] of Object.entries(domainData.services)) {
                services.push({
                    service_id: `${domain}.${serviceName}`,
                    domain: domain,
                    name: serviceData.name || serviceName,
                    description: serviceData.description || '',
                    fields: serviceData.fields || {}
                });
            }
        }

        // Sort alphabetically
        services.sort((a, b) => a.service_id.localeCompare(b.service_id));

        res.json({ success: true, services });
    } catch (error) {
        console.error('[API] Error fetching services:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get devices list for device picker
app.get('/api/devices', async (req, res) => {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[API] No supervisor token available - returning mock devices');
        return res.json({ success: true, devices: [] });
    }

    try {
        const response = await fetch('http://supervisor/core/api/devices', {
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HA API returned ${response.status}`);
        }

        const devices = await response.json();

        const simplified = devices.map(d => ({
            device_id: d.id || d.device_id,
            name: d.name_by_user || d.name || d.id,
            manufacturer: d.manufacturer || '',
            model: d.model || '',
            area_id: d.area_id || null
        }));

        simplified.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        res.json({ success: true, devices: simplified });
    } catch (error) {
        console.error('[API] Error fetching devices:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get areas list for area picker
app.get('/api/areas', async (req, res) => {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[API] No supervisor token available - returning mock areas');
        return res.json({ success: true, areas: [] });
    }

    try {
        const response = await fetch('http://supervisor/core/api/areas', {
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HA API returned ${response.status}`);
        }

        const areas = await response.json();
        const simplified = areas.map(a => ({
            area_id: a.id || a.area_id,
            name: a.name || a.id
        }));

        simplified.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        res.json({ success: true, areas: simplified });
    } catch (error) {
        console.error('[API] Error fetching areas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute a specific service (for "Run" context menu)
app.post('/api/execute_service', async (req, res) => {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    const { domain, service, serviceData } = req.body;

    if (!supervisorToken) {
        console.log('[API] No supervisor token available - executing mock service');
        console.log(`[Mock Run] Calling ${domain}.${service} with:`, serviceData);
        // Simulate success delay
        await new Promise(r => setTimeout(r, 500));
        return res.json({ success: true, message: 'Mock service executed' });
    }

    try {
        console.log(`[API] Executing service ${domain}.${service}`, serviceData);

        const response = await fetch(`http://supervisor/core/api/services/${domain}/${service}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supervisorToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(serviceData || {})
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HA API returned ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        res.json({ success: true, result });
    } catch (error) {
        console.error('[API] Error executing service:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});



// ============================================
// Health check & static files
// ============================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', configPath: CONFIG_PATH });
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// Orphaned Entity Management
// ============================================

app.get('/api/orphaned/:type', async (req, res) => {
    const { type } = req.params; // 'automations' or 'scripts'
    const domain = type === 'automations' ? 'automation' : 'script';

    try {
        // 1. Get all entities from HA states
        const supervisorToken = process.env.SUPERVISOR_TOKEN;
        let haEntities = [];

        if (supervisorToken) {
            try {
                // Try to get specific domain lists effectively
                // First try the entity registry via list endpoints if available, otherwise states
                const response = await fetch('http://supervisor/core/api/states', {
                    headers: { 'Authorization': `Bearer ${supervisorToken}` }
                });
                if (response.ok) {
                    const states = await response.json();
                    haEntities = states
                        .filter(s => s.entity_id.startsWith(`${domain}.`))
                        .map(s => ({
                            entity_id: s.entity_id,
                            attributes: s.attributes
                        }));
                }
            } catch (e) {
                console.error('[Orphans] Failed to fetch HA states:', e.message);
            }
        }

        // 2. Get all entities from YAML config
        let yamlEntities = [];
        if (type === 'automations') {
            const automations = await extractAutomations(CONFIG_PATH);
            yamlEntities = automations.map(a => a.id);
        } else {
            const scripts = await extractScripts(CONFIG_PATH);
            yamlEntities = scripts.map(s => s.id);
        }

        // 3. Find HA entities that are NOT in YAML
        // Determining ID compatibility is tricky. 
        // YAML IDs usually match the entity_id slug, but not always.
        // We'll try to match by friendly_name slug or explicit ID if possible.

        const orphans = [];

        for (const entity of haEntities) {
            // Logic: If we can't match this entity to a known YAML ID, it's a candidate
            // A common pattern is that "ghosts" have specific attributes or just don't parse from YAML

            // This is a simplified check. Real matching needs to strictly check unique_id if available.
            // For now, we'll return what we find and let the user verify.

            // Note: This logic is rudimentary. 
            // A better approach for "ghosts" specifically is often that they exist in the entity registry
            // but have no config entry.

            // For the purpose of this task (Spook integration), we mainly provide the endpoint
            // to listing potential candidates or just returning an empty list if we rely solely on Spook's service.

            // However, the user asked for a UI to delete them.
            // Let's assume ANY entity in HA that doesn't strictly match a YAML file ID is suspect.
            // But strict matching is hard without unique_id map.

            // CHANGE: Just pass known orphans if we can identify them, 
            // OR simply rely on the "delete all orphans" button logic.

            // For safely, let's just return an empty list for now until we have robust "scan" logic,
            // UNLESS we want to reimplement the scan logic from the lost context properly.
            // Given the user said "orphaned entities that appear greyed out", 
            // those might not even be in `api/states`.

            // Let's stick to the user's specific request: 
            // "we will just have it run after everytime you delete something in the ui"
            // So this endpoint might be less critical for AUTOMATIC cleanup, 
            // but if we want a manual "Scan" button, we need it.

            // Let's rely on the previous logic described in the prompt history:
            // "Updated orphan scan to use states API as primary source and cross-reference with YAML"

            // Since I don't have that code anymore (it was lost/overwritten), 
            // I'll implement a basic version that checks:
            // Entity exists in HA but ID isn't in our YAML list.

            const entitySlug = entity.entity_id.split('.')[1];
            const isMatch = yamlEntities.some(id =>
                id === entitySlug ||
                entity.attributes.friendly_name === id
            );

            if (!isMatch) {
                orphans.push({
                    id: entity.entity_id, // Use entity_id as ID for display
                    entity_id: entity.entity_id,
                    friendly_name: entity.attributes.friendly_name || entity.entity_id,
                    type: type
                });
            }
        }

        res.json({ success: true, orphans });
    } catch (error) {
        console.error('[Orphans] Error scanning:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete specific orphan (manual trigger)
app.delete('/api/orphaned/:type/:id', async (req, res) => {
    // We'll just run the Spook service. 
    // Ideally this service cleans ALL orphans, so targeting one specifically 
    // is just triggering the general cleanup.
    try {
        await cleanupOrphanedEntities();
        res.json({ success: true, message: 'Triggered orphaned entity cleanup' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// Start server
// ============================================

app.listen(PORT, () => {
    console.log(`[Home Assistant Editor] Server running on port ${PORT}`);
    console.log(`[Home Assistant Editor] Config path: ${CONFIG_PATH}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[system] Received SIGTERM signal - shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[system] Received SIGINT signal - shutting down...');
    process.exit(0);
});
