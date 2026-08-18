/**
 * Automation Service - CRUD operations for Home Assistant automations and scripts
 * Adapted from HomeAssistantVersionControl/automation-parser.js
 */

import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for parsed YAML files to reduce I/O and parsing overhead
const fileCache = new Map();

// Define custom Home Assistant YAML tags so js-yaml safely loads files without throwing unknown tag errors
const HA_TAGS = [
  '!include',
  '!include_dir_list',
  '!include_dir_named',
  '!include_dir_merge_list',
  '!include_dir_merge_named',
  '!secret',
  '!env_var',
  '!input'
];

const customYamlTypes = [];
for (const tag of HA_TAGS) {
  customYamlTypes.push(new yaml.Type(tag, {
    kind: 'scalar',
    construct: (data) => data,
    predicate: () => false
  }));
  customYamlTypes.push(new yaml.Type(tag, {
    kind: 'sequence',
    construct: (data) => data,
    predicate: () => false
  }));
  customYamlTypes.push(new yaml.Type(tag, {
    kind: 'mapping',
    construct: (data) => data,
    predicate: () => false
  }));
}

export const HA_SCHEMA = yaml.DEFAULT_SCHEMA.extend(customYamlTypes);

/**
 * Get cached file entry, refreshing if necessary
 * @param {string} filePath - Path to file
 * @returns {Promise<Object>} Cached entry { mtimeMs, content, data }
 */
async function getCachedFileEntry(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    const cached = fileCache.get(filePath);

    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const newCache = {
      mtimeMs: stats.mtimeMs,
      content,
      data: undefined // Lazy parse
    };
    fileCache.set(filePath, newCache);
    return newCache;
  } catch (error) {
    fileCache.delete(filePath);
    throw error;
  }
}

/**
 * Get file content (cached if possible)
 */
async function getCachedContent(filePath) {
  const entry = await getCachedFileEntry(filePath);
  return entry.content;
}

/**
 * Get parsed YAML data (cached if possible)
 */
async function getCachedYaml(filePath) {
  const entry = await getCachedFileEntry(filePath);
  if (entry.data === undefined) {
    entry.data = yaml.load(entry.content, { schema: HA_SCHEMA });
  }
  return entry.data;
}

async function addYamlFilesFromDir(dirPath, targetArray) {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await addYamlFilesFromDir(full, targetArray);
      } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        if (!targetArray.includes(full)) {
          targetArray.push(full);
        }
      }
    }
  } catch (err) {
    // Ignore missing directories
  }
}

/**
 * Parse configuration.yaml to find automation and script file locations
 * @param {string} configPath - Path to the config directory
 * @returns {Object} Object with automationPaths and scriptPaths arrays
 */
export async function getConfigFilePaths(configPath) {
  const configFile = path.join(configPath, 'configuration.yaml');
  const automationPaths = [];
  const scriptPaths = [];

  const addPathIfUnique = (list, p) => {
    if (p && !list.includes(p)) list.push(p);
  };

  try {
    const configContent = await getCachedContent(configFile);
    const lines = configContent.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;

      // Match automation / script / packages includes
      const includeMatch = trimmedLine.match(/^([\w\-]+(?:\s+[\w\-]+)?):\s*!(include|include_dir_list|include_dir_named|include_dir_merge_list|include_dir_merge_named)\s+(.+)$/);
      if (includeMatch) {
        const key = includeMatch[1].toLowerCase();
        const tag = includeMatch[2];
        const rawTarget = includeMatch[3].trim().replace(/^['"]|['"]$/g, '');
        const targetPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(configPath, rawTarget);
        const isDir = tag.startsWith('include_dir');

        const isAuto = key.includes('automation');
        const isScript = key.includes('script');
        const isPackage = key.includes('package');

        if (isDir) {
          if (isAuto || isPackage) await addYamlFilesFromDir(targetPath, automationPaths);
          if (isScript || isPackage) await addYamlFilesFromDir(targetPath, scriptPaths);
        } else {
          if (isAuto || isPackage) addPathIfUnique(automationPaths, targetPath);
          if (isScript || isPackage) addPathIfUnique(scriptPaths, targetPath);

          // If this is an included file (e.g. integrations/automation.yaml), scan it for nested includes
          try {
            const subContent = await getCachedContent(targetPath);
            const subLines = subContent.split('\n');
            const subDir = path.dirname(targetPath);
            for (const subLine of subLines) {
              const subTrim = subLine.trim();
              const subMatch = subTrim.match(/^([\w\-]+(?:\s+[\w\-]+)?):\s*!(include|include_dir_list|include_dir_named|include_dir_merge_list|include_dir_merge_named)\s+(.+)$/);
              if (subMatch) {
                const subKey = subMatch[1].toLowerCase();
                const subTag = subMatch[2];
                const subRawTarget = subMatch[3].trim().replace(/^['"]|['"]$/g, '');
                const subTargetPath = path.isAbsolute(subRawTarget) ? subRawTarget : path.resolve(subDir, subRawTarget);
                const subIsDir = subTag.startsWith('include_dir');

                const subIsAuto = subKey.includes('automation') || isAuto;
                const subIsScript = subKey.includes('script') || isScript;
                const subIsPackage = subKey.includes('package') || isPackage;

                if (subIsDir) {
                  if (subIsAuto || subIsPackage) await addYamlFilesFromDir(subTargetPath, automationPaths);
                  if (subIsScript || subIsPackage) await addYamlFilesFromDir(subTargetPath, scriptPaths);
                } else {
                  if (subIsAuto || subIsPackage) addPathIfUnique(automationPaths, subTargetPath);
                  if (subIsScript || subIsPackage) addPathIfUnique(scriptPaths, subTargetPath);
                }
              }
            }
          } catch (e) {
            // Ignore sub-file read errors
          }
        }
      }
    }
  } catch (error) {
    // If configuration.yaml doesn't exist or can't be read, continue to defaults
  }

  // Always check standard locations
  const defaultAuto = path.join(configPath, 'automations.yaml');
  const defaultScript = path.join(configPath, 'scripts.yaml');
  
  if (fs.existsSync(defaultAuto)) addPathIfUnique(automationPaths, defaultAuto);
  if (fs.existsSync(defaultScript)) addPathIfUnique(scriptPaths, defaultScript);

  // If still empty, add default filenames
  if (automationPaths.length === 0) automationPaths.push(defaultAuto);
  if (scriptPaths.length === 0) scriptPaths.push(defaultScript);

  return { automationPaths, scriptPaths };
}

function isItemEnabled(obj) {
  if (!obj || typeof obj !== 'object') return true;
  if (obj.enabled === false || obj.enabled === 'false' || obj.enabled === 'off') return false;
  if (obj.initial_state === false || obj.initial_state === 'false' || obj.initial_state === 'off') return false;
  return true;
}

/**
 * Extract all automations from YAML files
 * @param {string} configPath - Path to the config directory
 * @returns {Array} List of automation objects
 */
export async function extractAutomations(configPath) {
  try {
    const { automationPaths } = await getConfigFilePaths(configPath);

    // Combined: Process files in parallel and use cached file entry
    const results = await Promise.all(automationPaths.map(async (filePath) => {
      try {
        const content = await getCachedContent(filePath);
        const data = await getCachedYaml(filePath);
        const fileAutomations = [];

        if (data) {
          const relativeToConfigPath = path.relative(configPath, filePath);
          const lines = content.split('\n');

          // Handle array format (standard HA automations.yaml)
          if (Array.isArray(data)) {
            data.forEach((auto, index) => {
              if (auto && (auto.alias || auto.id)) {
                const lineNumber = findLineNumber(lines, auto.id || `auto_${index}`, auto.alias, true);
                fileAutomations.push({
                  id: auto.id || `auto_${index}`,
                  alias: auto.alias || `Automation ${index}`,
                  description: auto.description || '',
                  mode: auto.mode || 'single',
                  category: auto.category || '',
                  variables: auto.variables || {},
                  triggers: auto.triggers || auto.trigger || [],
                  conditions: auto.conditions || auto.condition || [],
                  actions: auto.actions || auto.action || [],
                  file: relativeToConfigPath,
                  fullPath: filePath,
                  index: index,
                  enabled: isItemEnabled(auto),
                  lineNumber: lineNumber
                });
              }
            });
          }
          // Handle object format (packages or named automations)
          else if (typeof data === 'object') {
            // Check for 'automation' key (standard in packages)
            if (data.automation) {
              const autoData = data.automation;
              if (Array.isArray(autoData)) {
                autoData.forEach((auto, index) => {
                  if (auto && (auto.alias || auto.id)) {
                    const lineNumber = findLineNumber(lines, auto.id || `auto_${index}`, auto.alias, true);
                    fileAutomations.push({
                      id: auto.id || `auto_${index}`,
                      alias: auto.alias || `Automation ${index}`,
                      description: auto.description || '',
                      mode: auto.mode || 'single',
                      category: auto.category || '',
                      variables: auto.variables || {},
                      triggers: auto.triggers || auto.trigger || [],
                      conditions: auto.conditions || auto.condition || [],
                      actions: auto.actions || auto.action || [],
                      file: relativeToConfigPath,
                      fullPath: filePath,
                      index: index,
                      enabled: isItemEnabled(auto),
                      lineNumber: lineNumber
                    });
                  }
                });
              } else if (typeof autoData === 'object') {
                Object.keys(autoData).forEach(key => {
                  const auto = autoData[key];
                  if (auto && typeof auto === 'object') {
                    fileAutomations.push({
                      id: auto.id || key,
                      alias: auto.alias || key,
                      description: auto.description || '',
                      mode: auto.mode || 'single',
                      category: auto.category || '',
                      variables: auto.variables || {},
                      triggers: auto.triggers || auto.trigger || [],
                      conditions: auto.conditions || auto.condition || [],
                      actions: auto.actions || auto.action || [],
                      file: relativeToConfigPath,
                      fullPath: filePath,
                      key: key,
                      enabled: isItemEnabled(auto)
                    });
                  }
                });
              }
            } else {
              // Flat object format (key: { triggers: ... })
              Object.keys(data).forEach(key => {
                const auto = data[key];
                if (auto && typeof auto === 'object') {
                  const hasTriggers = auto.triggers || auto.trigger;
                  if (hasTriggers) {
                    fileAutomations.push({
                      id: auto.id || key,
                      alias: auto.alias || key,
                      description: auto.description || '',
                      mode: auto.mode || 'single',
                      category: auto.category || '',
                      variables: auto.variables || {},
                      triggers: auto.triggers || auto.trigger || [],
                      conditions: auto.conditions || auto.condition || [],
                      actions: auto.actions || auto.action || [],
                      file: relativeToConfigPath,
                      fullPath: filePath,
                      key: key,
                      enabled: isItemEnabled(auto)
                    });
                  }
                }
              });
            }
          }
        }
        return fileAutomations;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.log(`Skipping ${filePath}: ${error.message}`);
        }
        return [];
      }
    }));

    return results.flat();

  } catch (error) {
    console.error('Error extracting automations:', error);
    return [];
  }
}

/**
 * Extract all scripts from YAML files
 * @param {string} configPath - Path to the config directory
 * @returns {Array} List of script objects
 */
export async function extractScripts(configPath) {
  try {
    const { scriptPaths } = await getConfigFilePaths(configPath);

    // Combined: Process files in parallel and use cached file entry
    const results = await Promise.all(scriptPaths.map(async (filePath) => {
      try {
        const content = await getCachedContent(filePath);
        const data = await getCachedYaml(filePath);
        const fileScripts = [];

        if (data && typeof data === 'object') {
          const relativeToConfigPath = path.relative(configPath, filePath);
          const lines = content.split('\n');

          const scriptData = data.script || data;
          if (scriptData && typeof scriptData === 'object' && !Array.isArray(scriptData)) {
            Object.keys(scriptData).forEach(key => {
              const script = scriptData[key];
              if (script && typeof script === 'object') {
                const hasSequence = script.sequence;
                const hasTriggers = script.triggers || script.trigger;

                // Scripts have sequence but NOT triggers
                if (hasSequence && !hasTriggers) {
                  const lineNumber = findLineNumber(lines, key, script.alias, false);
                  fileScripts.push({
                    id: key,
                    alias: script.alias || key,
                    description: script.description || '',
                    mode: script.mode || 'single',
                    category: script.category || '',
                    sequence: script.sequence || [],
                    variables: script.variables || {},
                    fields: script.fields || {},
                    icon: script.icon || '',
                    file: relativeToConfigPath,
                    fullPath: filePath,
                    key: key,
                    enabled: isItemEnabled(script),
                    lineNumber: lineNumber
                  });
                }
              }
            });
          }
        }
        return fileScripts;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.log(`Skipping ${filePath}: ${error.message}`);
        }
        return [];
      }
    }));

    return results.flat();

  } catch (error) {
    console.error('Error extracting scripts:', error);
    return [];
  }
}

/**
 * Get a single automation by ID
 * @param {string} automationId - The automation ID
 * @param {string} configPath - Path to the config directory
 * @returns {Object|null} The automation object or null
 */
export async function getAutomation(automationId, configPath) {
  const automations = await extractAutomations(configPath);
  return automations.find(a => a.id === automationId) || null;
}

/**
 * Get a single script by ID
 * @param {string} scriptId - The script ID
 * @param {string} configPath - Path to the config directory
 * @returns {Object|null} The script object or null
 */
export async function getScript(scriptId, configPath) {
  const scripts = await extractScripts(configPath);
  return scripts.find(s => s.id === scriptId) || null;
}

/**
 * Update an automation
 * @param {string} automationId - The automation ID
 * @param {Object} updatedAutomation - The updated automation object
 * @param {string} configPath - Path to the config directory
 * @returns {boolean} Success status
 */
export async function updateAutomation(automationId, updatedAutomation, configPath) {
  try {
    const automations = await extractAutomations(configPath);
    const existing = automations.find(a => a.id === automationId);

    if (!existing) {
      throw new Error(`Automation not found: ${automationId}`);
    }

    // Validate for unknown keys (common typos like 'triggersa' instead of 'triggers')
    const knownKeys = ['id', 'alias', 'description', 'mode', 'triggers', 'conditions', 'actions', 'enabled', 'trigger', 'condition', 'action', 'initial_state', 'max', 'max_exceeded', 'variables', 'trace', '_type', 'entity_id', 'category'];
    const unknownKeys = Object.keys(updatedAutomation).filter(k => !knownKeys.includes(k));
    if (unknownKeys.length > 0) {
      throw new Error(`Unknown keys in automation: ${unknownKeys.join(', ')}`);
    }

    const filePath = existing.fullPath;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    let data = yaml.load(content, { schema: HA_SCHEMA });

    // Build the automation object for YAML
    const autoObj = {
      id: updatedAutomation.id || automationId,
      alias: updatedAutomation.alias,
      description: updatedAutomation.description || '',
      mode: updatedAutomation.mode || 'single',
      triggers: updatedAutomation.triggers || [],
      conditions: updatedAutomation.conditions || [],
      actions: updatedAutomation.actions || []
    };

    if (updatedAutomation.category) {
      autoObj.category = updatedAutomation.category;
    }

    const variables = updatedAutomation.variables || existing.variables || {};
    if (variables && Object.keys(variables).length > 0) {
      autoObj.variables = variables;
    }

    if (updatedAutomation.enabled === false) {
      autoObj.initial_state = false;
    } else {
      autoObj.initial_state = true;
    }

    // Handle array format
    if (Array.isArray(data)) {
      if (existing.index !== undefined) {
        data[existing.index] = autoObj;
      }
    }
    // Handle object format
    else if (existing.key) {
      data[existing.key] = autoObj;
    }

    // Write back to file
    const updatedYaml = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
      forceQuotes: false
    });

    await fs.promises.writeFile(filePath, updatedYaml);
    console.log(`[updateAutomation] Updated automation: ${automationId}`);
    return true;
  } catch (error) {
    console.error('[updateAutomation] Error:', error);
    throw error;
  }
}

/**
 * Create a new automation
 * @param {Object} automation - The automation object
 * @param {string} configPath - Path to the config directory
 * @returns {Object} The created automation with ID
 */
export async function createAutomation(automation, configPath) {
  try {
    const { automationPaths } = await getConfigFilePaths(configPath);
    const filePath = automationPaths[0]; // Use the first/default automation file

    let data = [];
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      data = yaml.load(content, { schema: HA_SCHEMA }) || [];
    } catch (e) {
      // File might not exist, start with empty array
    }

    // Generate a unique ID if not provided
    const newId = automation.id || `automation_${Date.now()}`;

    const autoObj = {
      id: newId,
      alias: automation.alias || 'New Automation',
      description: automation.description || '',
      mode: automation.mode || 'single',
      triggers: automation.triggers || [],
      conditions: automation.conditions || [],
      actions: automation.actions || []
    };

    if (automation.category) {
      autoObj.category = automation.category;
    }

    if (automation.variables && Object.keys(automation.variables).length > 0) {
      autoObj.variables = automation.variables;
    }

    if (automation.enabled === false) {
      autoObj.initial_state = false;
    } else {
      autoObj.initial_state = true;
    }

    if (Array.isArray(data)) {
      data.push(autoObj);
    } else {
      // Convert to array if needed
      data = [autoObj];
    }

    const updatedYaml = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    await fs.promises.writeFile(filePath, updatedYaml);
    console.log(`[createAutomation] Created automation: ${newId}`);

    return { ...autoObj, file: path.relative(configPath, filePath), fullPath: filePath };
  } catch (error) {
    console.error('[createAutomation] Error:', error);
    throw error;
  }
}

/**
 * Delete an automation
 * @param {string} automationId - The automation ID
 * @param {string} configPath - Path to the config directory
 * @returns {boolean} Success status
 */
export async function deleteAutomation(automationId, configPath) {
  try {
    const automations = await extractAutomations(configPath);
    const existing = automations.find(a => a.id === automationId);

    if (!existing) {
      throw new Error(`Automation not found: ${automationId}`);
    }

    const filePath = existing.fullPath;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    let data = yaml.load(content, { schema: HA_SCHEMA });

    // Handle array format
    if (Array.isArray(data) && existing.index !== undefined) {
      data.splice(existing.index, 1);
    }
    // Handle object format
    else if (existing.key) {
      delete data[existing.key];
    }

    const updatedYaml = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    await fs.promises.writeFile(filePath, updatedYaml);
    console.log(`[deleteAutomation] Deleted automation: ${automationId}`);
    return true;
  } catch (error) {
    console.error('[deleteAutomation] Error:', error);
    throw error;
  }
}

/**
 * Update a script
 * @param {string} scriptId - The script ID
 * @param {Object} updatedScript - The updated script object
 * @param {string} configPath - Path to the config directory
 * @returns {boolean} Success status
 */
export async function updateScript(scriptId, updatedScript, configPath) {
  try {
    const scripts = await extractScripts(configPath);
    const existing = scripts.find(s => s.id === scriptId);

    if (!existing) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const filePath = existing.fullPath;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    let data = yaml.load(content, { schema: HA_SCHEMA });

    const scriptObj = {
      alias: updatedScript.alias,
      description: updatedScript.description || '',
      mode: updatedScript.mode || 'single',
      sequence: updatedScript.sequence || []
    };

    if (updatedScript.category) {
      scriptObj.category = updatedScript.category;
    }

    const variables = updatedScript.variables || existing.variables || {};
    if (variables && Object.keys(variables).length > 0) {
      scriptObj.variables = variables;
    }

    if (updatedScript.icon) {
      scriptObj.icon = updatedScript.icon;
    }
    if (updatedScript.fields && Object.keys(updatedScript.fields).length > 0) {
      scriptObj.fields = updatedScript.fields;
    }

    data[existing.key] = scriptObj;

    const updatedYaml = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    await fs.promises.writeFile(filePath, updatedYaml);
    console.log(`[updateScript] Updated script: ${scriptId}`);
    return true;
  } catch (error) {
    console.error('[updateScript] Error:', error);
    throw error;
  }
}

/**
 * Create a new script
 * @param {Object} script - The script object
 * @param {string} configPath - Path to the config directory
 * @returns {Object} The created script
 */
export async function createScript(script, configPath) {
  try {
    const { scriptPaths } = await getConfigFilePaths(configPath);
    const filePath = scriptPaths[0];

    let data = {};
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      data = yaml.load(content, { schema: HA_SCHEMA }) || {};
    } catch (e) {
      // File might not exist
    }

    const scriptId = script.id || `script_${Date.now()}`;

    const scriptObj = {
      alias: script.alias || 'New Script',
      description: script.description || '',
      mode: script.mode || 'single',
      sequence: script.sequence || []
    };

    if (script.category) {
      scriptObj.category = script.category;
    }

    if (script.variables && Object.keys(script.variables).length > 0) {
      scriptObj.variables = script.variables;
    }
    if (script.icon) {
      scriptObj.icon = script.icon;
    }

    data[scriptId] = scriptObj;

    const updatedYaml = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    await fs.promises.writeFile(filePath, updatedYaml);
    console.log(`[createScript] Created script: ${scriptId}`);

    return { id: scriptId, ...scriptObj, file: path.relative(configPath, filePath), fullPath: filePath };
  } catch (error) {
    console.error('[createScript] Error:', error);
    throw error;
  }
}

/**
 * Delete a script
 * @param {string} scriptId - The script ID
 * @param {string} configPath - Path to the config directory
 * @returns {boolean} Success status
 */
export async function deleteScript(scriptId, configPath) {
  try {
    const scripts = await extractScripts(configPath);
    const existing = scripts.find(s => s.id === scriptId);

    if (!existing) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const filePath = existing.fullPath;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    let data = yaml.load(content, { schema: HA_SCHEMA });

    delete data[existing.key];

    const updatedYaml = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    await fs.promises.writeFile(filePath, updatedYaml);
    console.log(`[deleteScript] Deleted script: ${scriptId}`);
    return true;
  } catch (error) {
    console.error('[deleteScript] Error:', error);
    throw error;
  }
}
/**
 * Convert arbitrary object to YAML string
 */
export function dumpYaml(obj) {
  try {
    return yaml.dump(obj, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });
  } catch (error) {
    throw new Error(`Failed to dump YAML: ${error.message}`);
  }
}

/**
 * Get automation as YAML string
 */

/**
 * Get automation as YAML string
 */
export function automationToYaml(automation) {
  const obj = {
    id: automation.id,
    alias: automation.alias,
    description: automation.description || '',
    mode: automation.mode || 'single',
    triggers: automation.triggers || [],
    conditions: automation.conditions || [],
    actions: automation.actions || []
  };

  if (automation.category) {
    obj.category = automation.category;
  }

  if (automation.enabled === false) {
    obj.initial_state = false;
  } else {
    obj.initial_state = true;
  }

  return yaml.dump(obj, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}

/**
 * Get script as YAML string
 */
export function scriptToYaml(script) {
  const obj = {
    [script.id]: {
      alias: script.alias,
      description: script.description || '',
      mode: script.mode || 'single',
      sequence: script.sequence || []
    }
  };

  if (script.category) {
    obj[script.id].category = script.category;
  }

  if (script.icon) {
    obj[script.id].icon = script.icon;
  }

  return yaml.dump(obj, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}

/**
 * Get raw YAML string for an automation directly from the file
 * This preserves exact formatting from the source file
 * @param {string} automationId - The automation ID
 * @param {string} configPath - Path to the config directory
 * @returns {string|null} The raw YAML string or null
 */
export async function getRawAutomationYaml(automationId, configPath) {
  try {
    const automations = await extractAutomations(configPath);
    const automation = automations.find(a => a.id === automationId);

    if (!automation || !automation.fullPath) {
      return null;
    }

    const content = await getCachedContent(automation.fullPath);
    const lines = content.split('\n');

    // Find start line of this automation
    const startLine = automation.lineNumber - 1; // Convert to 0-indexed

    // For array format (automations.yaml), find the next item or end of file
    let endLine = lines.length;

    // Look for next automation (starts with "- " at same or less indentation)
    const startIndent = lines[startLine].match(/^(\s*)/)?.[1]?.length || 0;

    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      // Skip empty lines
      if (line.trim() === '') continue;

      // Check if this is a new list item at the same indentation level
      const currentIndent = line.match(/^(\s*)/)?.[1]?.length || 0;
      if (currentIndent <= startIndent && line.trim().startsWith('- ')) {
        endLine = i;
        break;
      }
    }

    // Extract the YAML block
    const yamlLines = lines.slice(startLine, endLine);

    // For array items, remove the leading "- " from first line and adjust indentation
    let yamlContent = yamlLines.join('\n');

    // If it starts with "- ", convert to object format for display
    if (yamlContent.trim().startsWith('- ')) {
      // Remove "- " prefix and reduce indentation by 2 spaces
      yamlContent = yamlLines.map((line, idx) => {
        if (idx === 0) {
          return line.replace(/^(\s*)- /, '$1');
        }
        // Remove 2 spaces of indentation from subsequent lines
        return line.replace(/^  /, '');
      }).join('\n');
    }

    return yamlContent.trim();
  } catch (error) {
    console.error('[getRawAutomationYaml] Error:', error);
    return null;
  }
}

/**
 * Get raw YAML string for a script directly from the file
 * @param {string} scriptId - The script ID
 * @param {string} configPath - Path to the config directory
 * @returns {string|null} The raw YAML string or null
 */
export async function getRawScriptYaml(scriptId, configPath) {
  try {
    const scripts = await extractScripts(configPath);
    const script = scripts.find(s => s.id === scriptId);

    if (!script || !script.fullPath) {
      return null;
    }

    const content = await getCachedContent(script.fullPath);
    const lines = content.split('\n');

    // Find start line of this script
    const startLine = script.lineNumber - 1; // Convert to 0-indexed

    // Find the next script (starts with no indentation, followed by colon)
    let endLine = lines.length;

    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      // Skip empty lines
      if (line.trim() === '') continue;

      // Check if this is a new top-level key (no indentation, ends with colon)
      if (!line.startsWith(' ') && !line.startsWith('\t') && line.includes(':')) {
        endLine = i;
        break;
      }
    }

    // Extract the YAML block
    const yamlLines = lines.slice(startLine, endLine);
    return yamlLines.join('\n').trimEnd();
  } catch (error) {
    console.error('[getRawScriptYaml] Error:', error);
    return null;
  }
}

/**
 * Parse YAML string to automation object
 */

export function yamlToAutomation(yamlString) {
  try {
    return yaml.load(yamlString, { schema: HA_SCHEMA });
  } catch (error) {
    throw new Error(`Invalid YAML: ${error.message}`);
  }
}

/**
 * Validate automation object structure and values
 * @param {Object} automation - The automation object to validate
 * @returns {Array} List of error messages (empty if valid)
 */
export function validateAutomation(automation) {
  const errors = [];

  // Validate Mode
  const validModes = ['single', 'restart', 'queued', 'parallel'];
  if (automation.mode && !validModes.includes(automation.mode)) {
    errors.push(`Invalid mode: '${automation.mode}'. Must be one of: ${validModes.join(', ')}`);
  }

  // Validate Triggers
  if (automation.triggers && !Array.isArray(automation.triggers)) {
    errors.push('Triggers must be a list');
  }

  // Validate Conditions
  if (automation.conditions && !Array.isArray(automation.conditions)) {
    errors.push('Conditions must be a list');
  }

  // Validate Actions
  if (automation.actions && !Array.isArray(automation.actions)) {
    errors.push('Actions must be a list');
  }

  return errors;
}

/**
 * Get folder structure from .storage/automation_folders.json
 */
export function getFolders(configPath) {
  const storagePath = path.join(configPath, '.storage', 'automation_folders.json');
  if (!fs.existsSync(storagePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(storagePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Folders] Error reading folders:', error);
    return [];
  }
}

/**
 * Save folder structure to .storage/automation_folders.json
 */
export function saveFolders(folders, configPath) {
  const storageDir = path.join(configPath, '.storage');
  const storagePath = path.join(storageDir, 'automation_folders.json');

  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  try {
    fs.writeFileSync(storagePath, JSON.stringify(folders, null, 2));
    return true;
  } catch (error) {
    console.error('[Folders] Error saving folders:', error);
    throw error;
  }
}

/**
 * Find the line number of an automation or script in the file content
 * @param {Array<string>} lines - Lines of the file
 * @param {string} id - The ID or Key
 * @param {string} alias - The alias (fallback)
 * @param {boolean} isListItem - Whether looking for a list item (- id: ...)
 */
function findLineNumber(lines, id, alias, isListItem) {
  if (!lines || lines.length === 0) return 1;

  // Function to escape regex special characters
  const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Try ID match
  if (id) {
    const escapedId = escapeRegExp(id);
    let regex;

    if (isListItem) {
      // Look for "- id: ID" or "- id: 'ID'"
      regex = new RegExp(`^\\s*-\\s+id:\\s*['"]?${escapedId}['"]?`);
    } else {
      // Look for "ID:" (script key) or "id: ID" (object key)
      // For scripts, key is at start (or indented) ending with colon
      regex = new RegExp(`^\\s*${escapedId}:`);
    }

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) return i + 1;
    }
  }

  // 2. Try Alias match as fallback
  if (alias) {
    const escapedAlias = escapeRegExp(alias);
    let regex;

    if (isListItem) {
      regex = new RegExp(`^\\s*-\\s+alias:\\s*['"]?${escapedAlias}['"]?`);
    } else {
      regex = new RegExp(`^\\s*alias:\\s*['"]?${escapedAlias}['"]?`);
    }

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) return i + 1;
    }
  }

  return 1;
}
