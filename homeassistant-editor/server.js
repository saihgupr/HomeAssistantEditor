/**
 * Home Assistant Editor - Express Server
 * API backend for automation and script CRUD operations
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first'); // Force IPv4 globally for all Node.js requests
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
    dumpYaml,
    getRawAutomationYaml,
    getRawScriptYaml
} from './automation-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 54002;

// Resolve the configuration path: check process.env.CONFIG_PATH, /config, and /homeassistant
function resolveConfigPath() {
    const candidates = [
        process.env.CONFIG_PATH,
        '/config',
        '/homeassistant'
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            const hasYaml = fs.existsSync(path.join(p, 'configuration.yaml')) || 
                            fs.existsSync(path.join(p, 'automations.yaml')) || 
                            fs.existsSync(path.join(p, 'scripts.yaml'));
            if (hasYaml) return p;
        }
    }
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return process.env.CONFIG_PATH || '/config';
}

const CONFIG_PATH = resolveConfigPath();
const HA_URL = process.env.HA_URL ? process.env.HA_URL.replace(/\/$/, '') : null; // Remove trailing slash if present
const VC_URL = process.env.VC_URL ? process.env.VC_URL.replace(/\/$/, '') : null;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// Security headers middleware
app.use((req, res, next) => {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: https://generativelanguage.googleapis.com; frame-ancestors 'self' *;");

    // CORS handling - Restrict to trusted origins
    const origin = req.headers.origin;
    let isAllowed = false;

    if (origin) {
        // Allow localhost/127.0.0.1 for development (http/https, any port)
        if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
            isAllowed = true;
        }
        // Allow configured HA URL
        else if (HA_URL && origin === HA_URL) {
            isAllowed = true;
        }
        // Allow manual override via env var
        else if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) {
            isAllowed = true;
        }
    }

    if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});
// ============================================
// Internal IP Resolution (Fixes HA IPv6 Auth Issue)
// ============================================

let supervisorIPv4 = null;

/**
 * Resolves the 'supervisor' hostname to an IPv4 address to force IPv4 communication.
 * This fixes the 'Login attempt failed' issue caused by IPv6 link-local addresses.
 */
async function resolveSupervisorIP() {
    if (supervisorIPv4) return supervisorIPv4;

    try {
        console.log('[Supervisor] Attempting to resolve supervisor to IPv4...');
        const result = await dns.promises.lookup('supervisor', { family: 4 });
        supervisorIPv4 = result.address;
        console.log(`[Supervisor] Successfully resolved supervisor to IPv4: ${supervisorIPv4}`);
        return supervisorIPv4;
    } catch (error) {
        // Fallback to hostname if resolution fails (e.g. dev mode)
        console.warn(`[Supervisor] IPv4 resolution failed for 'supervisor', will retry next time. Error: ${error.message}`);
        return 'supervisor';
    }
}

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(url, options = {}, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// ============================================
// Helper function to call Home Assistant services
// ============================================

/**
 * Validates that a string is a safe identifier (alphanumeric, underscores, hyphens)
 * to prevent path traversal and SSRF attacks.
 * @param {string} name
 * @returns {boolean}
 */
function isValidIdentifier(name) {
    if (!name || typeof name !== 'string') return false;
    return /^[a-z0-9_-]+$/i.test(name);
}

async function callHomeAssistantService(domain, service, serviceData = {}) {
    // Validate inputs to prevent SSRF/Path Traversal
    if (!isValidIdentifier(domain)) {
        throw new Error(`Invalid domain format: ${domain}`);
    }
    if (!isValidIdentifier(service)) {
        throw new Error(`Invalid service format: ${service}`);
    }

    const supervisorToken = process.env.SUPERVISOR_TOKEN;

    if (!supervisorToken) {
        console.log('[HA Service] No supervisor token available - running in dev mode');
        return { success: true, message: 'Dev mode - service call simulated' };
    }

    const host = HA_URL ? null : await resolveSupervisorIP();
    const apiUrl = HA_URL
        ? `${HA_URL}/api/services/${domain}/${service}`
        : `http://${host || 'supervisor'}/core/api/services/${domain}/${service}`;

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

    const host = HA_URL ? null : await resolveSupervisorIP();

    return new Promise((resolve, reject) => {
        // Determine WebSocket URL
        let wsUrl;
        if (HA_URL) {
            // Convert http(s) to ws(s)
            wsUrl = HA_URL.startsWith('https')
                ? HA_URL.replace('https', 'wss') + '/api/websocket'
                : HA_URL.replace('http', 'ws') + '/api/websocket';
        } else {
            wsUrl = `ws://${host}/core/websocket`;
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
        const host = await resolveSupervisorIP();
        const apiUrl = HA_URL
            ? `${HA_URL}/api/states`
            : `http://${host}/core/api/states`;

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
        const host = await resolveSupervisorIP();
        const apiUrl = HA_URL
            ? `${HA_URL}/api/config/core/check_config`
            : `http://${host}/core/api/config/core/check_config`;

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
        const host = await resolveSupervisorIP();
        const response = await fetch(`http://${host}/addons`, {
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
    // If VC_URL is provided directly (Docker mode), use it
    if (VC_URL) {
        const url = `${VC_URL}${path}`;
        try {
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            }, 5000);

            if (response.ok) {
                return await response.json();
            }
            console.log(`[Version Control] Request to VC_URL failed with status: ${response.status}`);
        } catch (error) {
            console.log(`[Version Control] Request to VC_URL failed: ${error.message}`);
        }
        throw new Error('Version Control API not reachable at VC_URL');
    }

    const host = await discoverVersionControlHost();

    if (host) {
        // Try internal addon-to-addon communication
        const url = `http://${host}:${VERSION_CONTROL_PORT}${path}`;
        try {
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
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

// Stop a running script or automation
app.post('/api/stop/:domain/:itemId', async (req, res) => {
    const { domain, itemId } = req.params;
    const { entity_id } = req.body;

    console.log(`[Stop] Stopping ${domain}: ${itemId} (entity_id: ${entity_id})`);

    try {
        if (domain === 'script') {
            // Scripts are stopped via script.turn_off
            let serviceName = 'turn_off';
            const serviceData = {
                entity_id: entity_id || `script.${itemId.toLowerCase().replace(/\s+/g, '_')}`
            };
            await callHomeAssistantService('script', serviceName, serviceData);
        } else if (domain === 'automation') {
            // Automations are "stopped" by turning off then on, or canceling delays
            // For now, let's keep it simple and focus on scripts as requested
            const serviceData = {
                entity_id: entity_id || `automation.${itemId.toLowerCase().replace(/\s+/g, '_')}`
            };
            // Turning off an automation stops its running instances
            await callHomeAssistantService('automation', 'turn_off', serviceData);
            // Turn it back on so it can run again later
            await callHomeAssistantService('automation', 'turn_on', serviceData);
        } else {
            return res.status(400).json({ success: false, error: 'Invalid domain' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`[Stop] Error stopping ${domain}:`, error.message);
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

// Convert JSON object to YAML string
app.post('/api/dump-yaml', (req, res) => {
    try {
        const { config } = req.body;
        if (config === undefined || config === null) {
            return res.status(400).json({ success: false, error: 'No config provided' });
        }
        const yaml = dumpYaml(config);
        res.json({ success: true, yaml });
    } catch (error) {
        console.error('[API] Error dumping YAML:', error);
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

    const host = HA_URL ? null : await resolveSupervisorIP();

    return new Promise((resolve, reject) => {
        // Determine WebSocket URL
        let wsUrl;
        if (HA_URL) {
            wsUrl = HA_URL.startsWith('https')
                ? HA_URL.replace('https', 'wss') + '/api/websocket'
                : HA_URL.replace('http', 'ws') + '/api/websocket';
        } else {
            wsUrl = `ws://${host}/core/websocket`;
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
                    console.log(`[WS Traces] Authenticated, requesting traces for ${domain}.${itemId}`);
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
        const wsTraces = await fetchTracesViaWebSocket(domain, itemId, true);
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

            console.log(`[Traces] Got ${fileTraces.length} historical traces from file`);

            fileTraces.forEach(t => {
                // Avoid duplicating traces already fetched via WebSocket
                if (!allTraces.some(existing => existing.run_id === t.run_id)) {
                    allTraces.push({
                        run_id: t.run_id,
                        timestamp: t.timestamp?.start,
                        finish_time: t.timestamp?.finish,
                        state: t.state,
                        script_execution: t.script_execution,
                        trigger: t.trigger || 'unknown',
                        error: t.script_execution === 'failed_single' ? 'Already running' : null,
                        last_step: t.last_step,
                        steps: formatTraceSteps(t.trace),
                        source: 'file'
                    });
                }
            });
        }
    } catch (fileError) {
        console.log('[Traces] File fetch failed:', fileError.message);
    }

    // Sort by timestamp descending (newest first)
    allTraces.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
        success: true,
        domain,
        itemId,
        traces: allTraces
    });
});

// ============================================
// Fallback Route - Serve SPA index.html for unknown non-API routes
// ============================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', configPath: CONFIG_PATH });
});

// ============================================
// Orphaned Entity Management
// ============================================

app.get('/api/orphaned/:type', async (req, res) => {
    const { type } = req.params; // 'automations' or 'scripts'
    const domain = type === 'automations' ? 'automation' : 'script';

    try {
        const supervisorToken = process.env.SUPERVISOR_TOKEN;
        let haEntities = [];

        if (supervisorToken) {
            try {
                const host = HA_URL ? null : await resolveSupervisorIP();
                const apiUrl = HA_URL
                    ? `${HA_URL}/api/states`
                    : `http://${host}/core/api/states`;

                const response = await fetch(apiUrl, {
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

        let yamlEntities = [];
        if (type === 'automations') {
            const automations = await extractAutomations(CONFIG_PATH);
            yamlEntities = automations.map(a => a.id);
        } else {
            const scripts = await extractScripts(CONFIG_PATH);
            yamlEntities = scripts.map(s => s.id);
        }

        const orphans = [];
        for (const entity of haEntities) {
            const entitySlug = entity.entity_id.split('.')[1];
            const isMatch = yamlEntities.some(id =>
                id === entitySlug ||
                entity.attributes.friendly_name === id
            );

            if (!isMatch) {
                orphans.push({
                    id: entity.entity_id,
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
    try {
        await cleanupOrphanedEntities();
        res.json({ success: true, message: 'Triggered orphaned entity cleanup' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fetch metadata from Home Assistant (Areas, Labels, Entity Registry, Device Registry, Categories)
app.get('/api/ha-metadata', async (req, res) => {
    try {
        const areaRegistry = await callHAWebSocket({ type: 'config/area_registry/list' });
        const labelRegistry = await callHAWebSocket({ type: 'config/label_registry/list' });
        const entityRegistry = await callHAWebSocket({ type: 'config/entity_registry/list' });
        const deviceRegistry = await callHAWebSocket({ type: 'config/device_registry/list' });

        let automationCategories = [];
        let scriptCategories = [];
        try {
            automationCategories = await callHAWebSocket({ type: 'config/category_registry/list', scope: 'automation' }) || [];
        } catch (err) {
            console.warn('[API] Could not fetch automation categories registry:', err.message);
        }
        try {
            scriptCategories = await callHAWebSocket({ type: 'config/category_registry/list', scope: 'script' }) || [];
        } catch (err) {
            console.warn('[API] Could not fetch script categories registry:', err.message);
        }

        res.json({
            success: true,
            areas: areaRegistry,
            labels: labelRegistry,
            entities: entityRegistry,
            devices: deviceRegistry,
            automation_categories: automationCategories,
            script_categories: scriptCategories
        });
    } catch (error) {
        console.error('[API] Error fetching HA metadata:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// Static SPA Fallback Route
// ============================================

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// Start server
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Home Assistant Editor] Server running on port ${PORT}`);
    console.log(`[Home Assistant Editor] Config path: ${CONFIG_PATH}`);
    console.log(`[Home Assistant Editor] Home Assistant URL: ${HA_URL || 'Not specified (using Supervisor API)'}`);
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
