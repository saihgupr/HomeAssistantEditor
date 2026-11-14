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
 * Parse YAML using the Home Assistant schema.
 * ESPHome style `<<: !include file.yaml` merges cannot be resolved without
 * reading the included file, so those lines are dropped and the parse retried
 * instead of failing the whole document.
 */
export function loadHaYaml(content, label) {
  try {
    return yaml.load(content, { schema: HA_SCHEMA });
  } catch (error) {
    if (/cannot merge mappings/i.test(error.message || '')) {
      console.warn(`[YAML] Dropped unsupported "<<: !include" merge line${label ? ` in ${label}` : ''}`);
      const stripped = String(content)
        .split('\n')
        .filter((line) => !/^\s*<<:\s*!include/.test(line))
        .join('\n');
      return yaml.load(stripped, { schema: HA_SCHEMA });
    }
    throw error;
  }
}

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
    entry.data = loadHaYaml(entry.content, filePath);
  }
  return entry.data;
}

// Matches single-line Home Assistant include directives, e.g.
//   automation: !include automations.yaml
//   packages: !include_dir_named packages/
//   script split: !include_dir_merge_named scripts/
const INCLUDE_LINE_RE = /^([A-Za-z0-9_][A-Za-z0-9_\- ]*?):\s*!(include_dir_merge_named|include_dir_merge_list|include_dir_named|include_dir_list|include)\s+(\S.*)$/;

// Safety valve so a malformed config with include cycles cannot hang the add-on
const MAX_SCANNED_FILES = 1000;

// Files that could not be read or parsed, surfaced to the UI instead of only
// being written to the add-on log.
const parseWarnings = new Map();
const PARSE_WARNING_TTL_MS = 10 * 60 * 1000;

// Short lived cache for the resolved include graph, keyed by config path
const configPathsCache = new Map();
const CONFIG_PATHS_TTL_MS = 2000;

function recordParseWarning(filePath, error, kind = 'parse') {
  parseWarnings.set(filePath, {
    file: filePath,
    error: error && error.message ? error.message.split('\n')[0] : String(error),
    missing: Boolean(error && error.code === 'ENOENT'),
    kind,
    at: Date.now()
  });
}

function clearParseWarning(filePath) {
  parseWarnings.delete(filePath);
}

/**
 * Get configuration files that failed to load, newest first.
 * Entries expire so a file that was fixed or removed stops being reported.
 */
export function getParseWarnings(configPath) {
  const now = Date.now();
  const warnings = [];

  for (const [filePath, warning] of parseWarnings) {
    const expired = now - warning.at > PARSE_WARNING_TTL_MS;
    const vanished = !warning.missing && !fs.existsSync(filePath);
    if (expired || vanished) {
      parseWarnings.delete(filePath);
      continue;
    }
    warnings.push({
      file: configPath ? path.relative(configPath, filePath) : filePath,
      error: warning.error
    });
  }

  return warnings;
}

/**
 * Strip surrounding quotes and trailing comments from an include target
 */
function cleanIncludeTarget(raw) {
  return String(raw)
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

/**
 * Determine how the contents of an included file should be interpreted
 * list   -> file holds a list of items
 * single -> file holds exactly one item
 * named  -> file holds a mapping of name -> item
 * auto   -> inspect the parsed content
 */
function includeShapeForTag(tag) {
  switch (tag) {
    case 'include_dir_list':
      return 'single';
    case 'include_dir_merge_list':
      return 'list';
    case 'include_dir_named':
    case 'include_dir_merge_named':
      return 'named';
    default:
      return 'auto';
  }
}

function domainForKey(key) {
  const normalized = key.toLowerCase();
  if (normalized.includes('automation')) return 'automation';
  if (normalized.includes('script')) return 'script';
  if (normalized.includes('package')) return 'package';
  return null;
}

/**
 * List YAML files below a directory, mirroring Home Assistant's own
 * _find_files() (os.walk with subdirectories, dot entries skipped).
 * Symlinked files are followed; symlinked directories are not, which matches
 * os.walk's default and keeps include loops harmless.
 */
async function listYamlFilesInDir(dirPath, limit = MAX_SCANNED_FILES) {
  const files = [];

  const walk = async (currentDir) => {
    if (files.length >= limit) return;

    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      // A missing directory is reported by the caller. Anything else
      // (permissions, I/O) would look exactly like an empty config, so surface it.
      if (err.code !== 'ENOENT') {
        recordParseWarning(currentDir, err, 'scan');
      }
      return;
    }

    // Stable order keeps the MAX_SCANNED_FILES cutoff deterministic
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name.startsWith('.')) continue;

      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      let isFile = entry.isFile();
      if (!isFile && entry.isSymbolicLink()) {
        try {
          isFile = (await fs.promises.stat(entryPath)).isFile();
        } catch (err) {
          isFile = false;
        }
      }

      if (isFile && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        files.push(entryPath);
      }
    }
  };

  await walk(dirPath);
  return files.sort();
}

function createSourceRegistry() {
  return {
    automation: new Map(),
    script: new Map()
  };
}

function addSource(sources, domain, filePath, shape, isPackage = false) {
  const registry = sources[domain];
  if (!registry) return;

  const existing = registry.get(filePath);
  if (!existing) {
    registry.set(filePath, { shape, isPackage });
    return;
  }

  if (existing.shape !== shape) existing.shape = 'auto';
  existing.isPackage = existing.isPackage && isPackage;
}

/**
 * Recursively walk a YAML file following Home Assistant !include directives
 */
async function scanConfigFile(filePath, domain, shape, sources, visited, options = {}) {
  const visitKey = `${filePath}\u0000${domain}`;
  if (!filePath || visited.has(visitKey) || visited.size >= MAX_SCANNED_FILES) return;
  visited.add(visitKey);

  let content;
  try {
    content = await getCachedContent(filePath);
  } catch (err) {
    if (!options.optional) recordParseWarning(filePath, err, 'scan');
    return;
  }

  if (domain === 'package') {
    addSource(sources, 'automation', filePath, 'auto', true);
    addSource(sources, 'script', filePath, 'auto', true);
  } else if (domain === 'automation' || domain === 'script') {
    addSource(sources, domain, filePath, shape);
  }

  const dir = path.dirname(filePath);
  for (const line of content.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    const includeMatch = trimmedLine.match(INCLUDE_LINE_RE);
    if (!includeMatch) continue;

    const keyDomain = domainForKey(includeMatch[1]);
    const tag = includeMatch[2];
    const rawTarget = cleanIncludeTarget(includeMatch[3]);
    if (!rawTarget) continue;

    const targetPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(dir, rawTarget);
    const targetShape = includeShapeForTag(tag);

    if (tag.startsWith('include_dir')) {
      const files = await listYamlFilesInDir(targetPath);
      if (files.length === 0) {
        // HA treats an empty directory include as empty, so only report the
        // cases that hide something: a missing directory, or one that holds
        // entries but no YAML the add-on can read.
        if (!fs.existsSync(targetPath)) {
          const err = new Error('Include directory not found');
          err.code = 'ENOENT';
          recordParseWarning(targetPath, err, 'scan');
        } else {
          let hasEntries = false;
          try {
            hasEntries = (await fs.promises.readdir(targetPath)).some((name) => !name.startsWith('.'));
          } catch (err) {
            recordParseWarning(targetPath, err, 'scan');
          }
          if (hasEntries) {
            recordParseWarning(
              targetPath,
              new Error('Directory contains no YAML files (searched subdirectories)'),
              'scan'
            );
          }
        }
      } else if (files.length >= MAX_SCANNED_FILES) {
        recordParseWarning(
          targetPath,
          new Error(`Reached the ${MAX_SCANNED_FILES} file scan limit, so some files were not read`),
          'scan'
        );
      }
      for (const file of files) {
        if (keyDomain === 'package') {
          await scanConfigFile(file, 'package', 'auto', sources, visited);
        } else if (keyDomain) {
          await scanConfigFile(file, keyDomain, targetShape, sources, visited);
        } else {
          // An include under a non-automation key can still contain one further down
          await scanConfigFile(file, 'config', 'auto', sources, visited);
        }
      }
    } else {
      await scanConfigFile(targetPath, keyDomain || 'config', targetShape, sources, visited);
    }
  }
}

/**
 * Parse configuration.yaml and every reachable include to find automation
 * and script file locations
 * @param {string} configPath - Path to the config directory
 * @returns {Object} automationPaths, scriptPaths plus per-file source metadata
 */
export async function getConfigFilePaths(configPath, { fresh = false } = {}) {
  // extractAutomations and extractScripts both resolve paths on every request;
  // a short lived cache keeps that to a single directory walk.
  const cached = configPathsCache.get(configPath);
  if (!fresh && cached && Date.now() - cached.at < CONFIG_PATHS_TTL_MS) {
    return cached.value;
  }

  const sources = createSourceRegistry();
  const visited = new Set();

  // Drop scan warnings from the previous pass; this scan re-adds what still applies
  for (const [warnedPath, warning] of parseWarnings) {
    if (warning.kind === 'scan') parseWarnings.delete(warnedPath);
  }

  await scanConfigFile(path.join(configPath, 'configuration.yaml'), 'config', 'auto', sources, visited, { optional: true });

  const defaultAuto = path.join(configPath, 'automations.yaml');
  const defaultScript = path.join(configPath, 'scripts.yaml');

  // Fall back to the standard locations when nothing was discovered
  if (fs.existsSync(defaultAuto) && !sources.automation.has(defaultAuto)) {
    addSource(sources, 'automation', defaultAuto, 'auto');
  }
  if (fs.existsSync(defaultScript) && !sources.script.has(defaultScript)) {
    addSource(sources, 'script', defaultScript, 'auto');
  }

  if (sources.automation.size === 0) addSource(sources, 'automation', defaultAuto, 'auto');
  if (sources.script.size === 0) addSource(sources, 'script', defaultScript, 'auto');

  const toSourceList = (registry) =>
    Array.from(registry, ([filePath, meta]) => ({
      filePath,
      shape: meta.shape,
      isPackage: meta.isPackage
    }));

  const value = {
    automationPaths: Array.from(sources.automation.keys()),
    scriptPaths: Array.from(sources.script.keys()),
    automationSources: toSourceList(sources.automation),
    scriptSources: toSourceList(sources.script)
  };

  configPathsCache.set(configPath, { at: Date.now(), value });
  return value;
}

function isItemEnabled(obj) {
  if (!obj || typeof obj !== 'object') return true;
  if (obj.enabled === false || obj.enabled === 'false' || obj.enabled === 'off') return false;
  if (obj.initial_state === false || obj.initial_state === 'false' || obj.initial_state === 'off') return false;
  return true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeAutomation(obj) {
  return isPlainObject(obj) && Boolean(obj.trigger || obj.triggers || obj.action || obj.actions || obj.alias || obj.id || obj.use_blueprint);
}

function looksLikeScript(obj) {
  return isPlainObject(obj) && !(obj.trigger || obj.triggers) && Boolean(obj.sequence || obj.alias);
}

/**
 * Flatten parsed YAML into individual automation entries, remembering where
 * each one lives so it can be written back to the right spot.
 * Entry: { obj, index?, key?, container?, single? }
 */
function collectAutomationEntries(data, shape) {
  const entries = [];

  const addList = (list, container) => {
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      if (isPlainObject(item)) entries.push({ obj: item, index, container });
    });
  };

  const addNamed = (obj, container) => {
    if (!isPlainObject(obj)) return;
    Object.keys(obj).forEach((key) => {
      if (isPlainObject(obj[key])) entries.push({ obj: obj[key], key, container });
    });
  };

  if (shape === 'list') {
    addList(data);
    return entries;
  }
  if (shape === 'named') {
    // A named include may still hold a single item named after its file
    if (looksLikeAutomation(data)) entries.push({ obj: data, single: true });
    else addNamed(data);
    return entries;
  }
  if (shape === 'single') {
    if (looksLikeAutomation(data)) entries.push({ obj: data, single: true });
    return entries;
  }

  // shape === 'auto' - inspect the parsed content
  if (Array.isArray(data)) {
    addList(data);
    return entries;
  }
  if (!isPlainObject(data)) return entries;

  if (Array.isArray(data.automation)) addList(data.automation, 'automation');
  else if (isPlainObject(data.automation)) addNamed(data.automation, 'automation');

  // Package style keys: "automation split:", "automation ui:", ...
  Object.keys(data).forEach((key) => {
    if (key === 'automation' || !/^automation(\s|$)/i.test(key)) return;
    const value = data[key];
    if (Array.isArray(value)) {
      addList(value, key);
    } else if (isPlainObject(value)) {
      if (looksLikeAutomation(value)) entries.push({ obj: value, key });
      else addNamed(value, key);
    }
  });

  if (looksLikeAutomation(data)) {
    entries.push({ obj: data, single: true });
    return entries;
  }

  const hasAutomationKey = Object.keys(data).some((key) => /^automation(\s|$)/i.test(key));
  if (!hasAutomationKey) addNamed(data);

  return entries;
}

/**
 * Flatten parsed YAML into individual script entries
 * Entry: { obj, index?, key?, container?, single? }
 */
function collectScriptEntries(data, shape) {
  const entries = [];

  const addNamed = (obj, container) => {
    if (!isPlainObject(obj)) return;
    Object.keys(obj).forEach((key) => {
      if (isPlainObject(obj[key])) entries.push({ obj: obj[key], key, container });
    });
  };

  if (shape === 'named') {
    // A named include may still hold a single item named after its file
    if (looksLikeScript(data)) entries.push({ obj: data, single: true });
    else addNamed(data);
    return entries;
  }
  if (shape === 'single') {
    if (looksLikeScript(data)) entries.push({ obj: data, single: true });
    return entries;
  }
  if (shape === 'list') {
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        if (isPlainObject(item)) entries.push({ obj: item, index });
      });
    }
    return entries;
  }

  // shape === 'auto' - inspect the parsed content
  if (!isPlainObject(data)) return entries;

  if (isPlainObject(data.script)) addNamed(data.script, 'script');

  // Package style keys: "script split:", "script ui:", ...
  Object.keys(data).forEach((key) => {
    if (key === 'script' || !/^script(\s|$)/i.test(key)) return;
    const value = data[key];
    if (isPlainObject(value)) {
      if (looksLikeScript(value)) entries.push({ obj: value, key });
      else addNamed(value, key);
    }
  });

  if (looksLikeScript(data)) {
    entries.push({ obj: data, single: true });
    return entries;
  }

  const hasScriptKey = Object.keys(data).some((key) => /^script(\s|$)/i.test(key));
  if (!hasScriptKey) {
    Object.keys(data).forEach((key) => {
      if (looksLikeScript(data[key])) entries.push({ obj: data[key], key });
    });
  }

  return entries;
}

/**
 * Write an updated entry back into its parsed document
 */
function setEntryValue(data, entry, value) {
  if (entry.single) return value;

  const target = entry.container ? data[entry.container] : data;
  if (!target) {
    throw new Error(`Unable to locate "${entry.container}" in the configuration file`);
  }

  if (Array.isArray(target) && entry.index !== undefined) {
    target[entry.index] = value;
  } else if (entry.key !== undefined) {
    target[entry.key] = value;
  }

  return data;
}

/**
 * Remove an entry from its parsed document
 */
function removeEntry(data, entry) {
  if (entry.single) {
    throw new Error(`${entry.file || 'This file'} holds a single item and cannot be edited in place. Delete or empty that file manually.`);
  }

  const target = entry.container ? data[entry.container] : data;
  if (!target) {
    throw new Error(`Unable to locate "${entry.container}" in the configuration file`);
  }

  if (Array.isArray(target) && entry.index !== undefined) {
    target.splice(entry.index, 1);
  } else if (entry.key !== undefined) {
    delete target[entry.key];
  }

  return data;
}

/**
 * Pick a sensible file for newly created items: prefer a plain (non package)
 * list/auto source, otherwise fall back to the standard file.
 */
function pickCreateTarget(sources, defaultPath) {
  const preferred = sources.find((source) => !source.isPackage && (source.shape === 'list' || source.shape === 'auto'));
  return preferred ? preferred.filePath : defaultPath;
}

/**
 * Extract all automations from YAML files
 * @param {string} configPath - Path to the config directory
 * @returns {Array} List of automation objects
 */
export async function extractAutomations(configPath) {
  try {
    const { automationSources } = await getConfigFilePaths(configPath);

    // Combined: Process files in parallel and use cached file entry
    const results = await Promise.all(automationSources.map(async ({ filePath, shape }) => {
      try {
        const content = await getCachedContent(filePath);
        const data = await getCachedYaml(filePath);
        clearParseWarning(filePath);
        if (!data) return [];

        const relativeToConfigPath = path.relative(configPath, filePath);
        const lines = content.split('\n');

        return collectAutomationEntries(data, shape)
          .filter(({ obj }) => obj.alias || obj.id || obj.use_blueprint)
          .map(({ obj: auto, index, key, container, single }) => {
            const fallbackId = path.basename(filePath, path.extname(filePath));
            let lineNumber = 1;
            if (!single) {
              lineNumber = index !== undefined
                ? findLineNumber(lines, auto.id || `auto_${index}`, auto.alias, true)
                : findLineNumber(lines, key, auto.alias, false);
            }

            return {
              id: auto.id || key || (index !== undefined ? `auto_${index}` : fallbackId),
              alias: auto.alias || key || (index !== undefined ? `Automation ${index}` : fallbackId),
              description: auto.description || '',
              mode: auto.mode || 'single',
              category: auto.category || '',
              variables: auto.variables || {},
              triggers: auto.triggers || auto.trigger || [],
              conditions: auto.conditions || auto.condition || [],
              actions: auto.actions || auto.action || [],
              use_blueprint: auto.use_blueprint || null,
              file: relativeToConfigPath,
              fullPath: filePath,
              index,
              key,
              container,
              single: Boolean(single),
              shape,
              enabled: isItemEnabled(auto),
              lineNumber
            };
          });
      } catch (error) {
        console.log(`Skipping ${filePath}: ${error.message}`);
        recordParseWarning(filePath, error, error.code === 'ENOENT' ? 'scan' : 'parse');
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
    const { scriptSources } = await getConfigFilePaths(configPath);

    // Combined: Process files in parallel and use cached file entry
    const results = await Promise.all(scriptSources.map(async ({ filePath, shape }) => {
      try {
        const content = await getCachedContent(filePath);
        const data = await getCachedYaml(filePath);
        clearParseWarning(filePath);
        if (!data) return [];

        const relativeToConfigPath = path.relative(configPath, filePath);
        const lines = content.split('\n');

        return collectScriptEntries(data, shape)
          .filter(({ obj }) => obj.sequence)
          .map(({ obj: script, index, key, container, single }) => {
            const fallbackId = path.basename(filePath, path.extname(filePath));
            const id = key || (single ? fallbackId : `script_${index}`);

            return {
              id,
              alias: script.alias || id,
              description: script.description || '',
              mode: script.mode || 'single',
              category: script.category || '',
              sequence: script.sequence || [],
              variables: script.variables || {},
              fields: script.fields || {},
              icon: script.icon || '',
              file: relativeToConfigPath,
              fullPath: filePath,
              key,
              container,
              single: Boolean(single),
              shape,
              enabled: isItemEnabled(script),
              lineNumber: single ? 1 : findLineNumber(lines, key, script.alias, false)
            };
          });
      } catch (error) {
        console.log(`Skipping ${filePath}: ${error.message}`);
        recordParseWarning(filePath, error, error.code === 'ENOENT' ? 'scan' : 'parse');
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
    const knownKeys = ['id', 'alias', 'description', 'mode', 'triggers', 'conditions', 'actions', 'enabled', 'trigger', 'condition', 'action', 'initial_state', 'max', 'max_exceeded', 'variables', 'trace', '_type', 'entity_id', 'category', 'use_blueprint'];
    const unknownKeys = Object.keys(updatedAutomation).filter(k => !knownKeys.includes(k));
    if (unknownKeys.length > 0) {
      throw new Error(`Unknown keys in automation: ${unknownKeys.join(', ')}`);
    }

    const filePath = existing.fullPath;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    let data = loadHaYaml(content);

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

    if (updatedAutomation.use_blueprint || existing.use_blueprint) {
      autoObj.use_blueprint = updatedAutomation.use_blueprint || existing.use_blueprint;
      if (!updatedAutomation.triggers || updatedAutomation.triggers.length === 0) delete autoObj.triggers;
      if (!updatedAutomation.conditions || updatedAutomation.conditions.length === 0) delete autoObj.conditions;
      if (!updatedAutomation.actions || updatedAutomation.actions.length === 0) delete autoObj.actions;
    }

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

    // Write the automation back to the exact place it came from
    data = setEntryValue(data, existing, autoObj);

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
    const { automationSources } = await getConfigFilePaths(configPath);
    const filePath = pickCreateTarget(automationSources, path.join(configPath, 'automations.yaml'));

    let data = [];
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      data = loadHaYaml(content) || [];
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
    let data = loadHaYaml(content);

    // Remove the automation from the exact place it came from
    data = removeEntry(data, existing);

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
    let data = loadHaYaml(content);

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

    data = setEntryValue(data, existing, scriptObj);

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
    const { scriptSources } = await getConfigFilePaths(configPath);
    const filePath = pickCreateTarget(scriptSources, path.join(configPath, 'scripts.yaml'));

    let data = {};
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      data = loadHaYaml(content) || {};
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
    let data = loadHaYaml(content);

    data = removeEntry(data, existing);

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
    mode: automation.mode || 'single'
  };

  if (automation.use_blueprint) {
    obj.use_blueprint = automation.use_blueprint;
  }
  if (automation.triggers && automation.triggers.length > 0) {
    obj.triggers = automation.triggers;
  } else if (!automation.use_blueprint) {
    obj.triggers = [];
  }

  if (automation.conditions && automation.conditions.length > 0) {
    obj.conditions = automation.conditions;
  } else if (!automation.use_blueprint) {
    obj.conditions = [];
  }

  if (automation.actions && automation.actions.length > 0) {
    obj.actions = automation.actions;
  } else if (!automation.use_blueprint) {
    obj.actions = [];
  }

  if (automation.variables && Object.keys(automation.variables).length > 0) {
    obj.variables = automation.variables;
  }

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
    return loadHaYaml(yamlString);
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
