/**
 * Home Assistant Editor - Main Application
 */

// ============================================
// State
// ============================================

/**
 * Update the save button visual state based on dirty status or preview mode
 */
function updateSaveButtonStatus(isDirty) {
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        // Illuminate save button if dirty OR if viewing a historical version (preview mode)
        const shouldIlluminate = isDirty || state.versionControl.previewMode;
        if (shouldIlluminate) {
            btnSave.classList.add('is-dirty');
        } else {
            btnSave.classList.remove('is-dirty');
        }
        setSaveButtonLabel();
    }
}

function setSaveButtonLabel() {
    const btnSave = document.getElementById('btn-save');
    if (!btnSave) return;

    let label = btnSave.querySelector('.btn-label');
    if (!label) {
        // Remove stray text nodes and insert a dedicated label span
        Array.from(btnSave.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                node.remove();
            }
        });
        label = document.createElement('span');
        label.className = 'btn-label';
        const svg = btnSave.querySelector('svg');
        if (svg && svg.nextSibling) {
            btnSave.insertBefore(label, svg.nextSibling);
        } else {
            btnSave.appendChild(label);
        }
    }

    label.textContent = state.versionControl.previewMode ? 'Restore' : 'Save';
    btnSave.classList.toggle('is-restore', state.versionControl.previewMode);
}

/**
 * Check if the editor has unsaved changes by comparing current data with snapshot
 */
function checkDirty() {
    if (!state.selectedItem) {
        state.isDirty = false;
        return;
    }
    // New items are always dirty
    if (state.isNewItem) {
        state.isDirty = true;
        return;
    }

    const currentData = getEditorData();
    const originalData = JSON.parse(state.originalItemSnapshot);

    // Normalize both for comparison (remove undefined/null, handle empty arrays)
    const normalize = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            const arr = obj.map(normalize).filter(v => v !== undefined);
            return arr.length === 0 ? undefined : arr;
        }
        const res = {};
        Object.keys(obj).sort().forEach(k => {
            // Ignore internal fields during comparison
            if (k === 'block-alias' || k === '_type') return;

            const v = normalize(obj[k]);
            if (v !== undefined && v !== null && v !== '') res[k] = v;
        });
        return Object.keys(res).length === 0 ? undefined : res;
    };

    const s1 = JSON.stringify(normalize(currentData));
    const s2 = JSON.stringify(normalize(originalData));

    let isDirty = s1 !== s2;

    // If in YAML view and already marked dirty (by manual edit), keep it dirty
    // because getEditorData() only checks Visual Editor fields which might match snapshot
    if (state.currentView === 'yaml' && state.isDirty) {
        isDirty = true;
    }

    state.isDirty = isDirty;
}

/**
 * Remove internal UI-only fields from data before saving
 * This ensures corrupted historical versions don't pollute saved automations
 */
function cleanupInternalFields(obj) {
    const internalFields = ['block-alias', '_invalid_event_data', '_invalid_device_extra', '_invalid_variables'];

    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => cleanupInternalFields(item));
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        if (internalFields.includes(key)) continue;
        cleaned[key] = cleanupInternalFields(value);
    }
    return cleaned;
}

const _state = {
    currentGroup: 'automations', // 'automations' or 'scripts'
    currentView: 'visual', // 'visual' or 'yaml'
    automations: [],
    scripts: [],
    haStates: {},
    selectedItem: null,
    selectedItems: [], // Multi-select array
    selectedActionIndices: new Set(),
    actionSelectionAnchor: null,
    folders: [],
    selectedFolder: null,
    selectedTagGroup: null,
    isNewItem: false,
    isDirty: false,
    originalItemSnapshot: null,
    tagGroups: [],
    // Grouping state
    groups: {}, // { groupName: [itemIds] }
    expandedGroups: new Set(['Ungrouped']),
    groupingEnabled: localStorage.getItem('ha-editor-grouping') === 'true',
    // Filter state
    // Filter state
    filters: {
        searchFields: 'all' // 'all', 'name', 'description', 'entities'
    },
    settings: {
        collapseBlocksByDefault: localStorage.getItem('ha-editor-collapse-blocks') !== 'false', // Default to true
        colorModeEnabled: localStorage.getItem('ha-editor-color-mode') === 'true', // Default to false
        miniListMode: localStorage.getItem('ha-editor-mini-list') === 'true',
        showRequiredBadges: localStorage.getItem('ha-editor-show-required') !== 'false'
    },
    clipboard: null, // For copy/paste blocks
    draggingBlock: null, // { section, index }
    // Replay state
    replayMode: false,
    replayTrace: null,
    replayStepIndex: 0,
    history: [],
    future: [],
    traceInterval: null,
    sidebarCollapsed: localStorage.getItem('ha-editor-sidebar-collapsed') === 'true',
    historyCollapsed: localStorage.getItem('ha-editor-history-collapsed') === 'true',
    // Version Control integration
    versionControl: {
        available: null, // null = unknown, true/false after check
        commits: [],     // List of commits for current item
        currentIndex: -1, // -1 = live version, 0+ = historical version index
        previewMode: false,
        previewData: null, // The historical automation/script data
        loading: false
    }
};

const state = new Proxy(_state, {
    set(target, prop, value) {
        if (target[prop] === value) return true; // Avoid redundant triggers
        target[prop] = value;
        if (prop === 'isDirty') {
            updateSaveButtonStatus(value);
        }
        return true;
    }
});

// ============================================
// DOM Elements
// ============================================

const elements = {
    // Groups
    groupItems: document.querySelectorAll('.group-item'),
    automationCount: document.getElementById('automation-count'),
    scriptCount: document.getElementById('script-count'),

    // Items list
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    searchBox: document.querySelector('.search-box'),
    btnNew: document.getElementById('btn-new'),
    itemsList: document.getElementById('items-list'),

    // View toggle
    toggleBtns: document.querySelectorAll('.toggle-btn'),

    // Editor
    editorContainer: document.getElementById('editor-container'),
    emptyState: document.getElementById('empty-state'),
    editorHeader: document.getElementById('editor-header'),
    visualEditor: document.getElementById('visual-editor'),
    yamlEditor: document.getElementById('yaml-editor'),
    yamlContent: document.getElementById('yaml-content'),
    editorFooter: document.getElementById('editor-footer'),

    // Editor fields
    editorAlias: document.getElementById('editor-alias'),
    editorDescription: document.getElementById('editor-description'),
    editorTags: document.getElementById('editor-tags'),
    editorTagsInline: document.getElementById('editor-tags-inline'),
    editorTagsAdd: document.getElementById('editor-tags-add'),
    editorTagsInput: document.getElementById('editor-tags-input'),
    editorEnabled: document.getElementById('editor-enabled'),

    // Sections
    triggersContainer: document.getElementById('triggers-container'),
    conditionsContainer: document.getElementById('conditions-container'),
    actionsContainer: document.getElementById('actions-container'),

    // Buttons
    btnSave: document.getElementById('btn-save'),
    btnDelete: document.getElementById('btn-delete'),
    btnDuplicate: document.getElementById('btn-duplicate'),
    btnRun: document.getElementById('btn-run'),
    btnRunSelected: document.getElementById('btn-run-selected'),

    // Modal
    addBlockModal: document.getElementById('add-block-modal'),
    modalSectionType: document.getElementById('modal-section-type'),
    blockTypesGrid: document.getElementById('block-types-grid'),

    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    btnSettings: document.getElementById('btn-settings'),
    // btnTheme removed from header, now checkbox in settings
    settingDarkMode: document.getElementById('setting-dark-mode'),
    settingCollapseBlocks: document.getElementById('setting-collapse-blocks'),
    settingColorMode: document.getElementById('setting-color-mode'),
    settingMiniList: document.getElementById('setting-mini-list'),

    // Trace Panel
    panelTrace: document.getElementById('panel-trace'),
    traceList: document.getElementById('trace-list'),

    // Resizables
    dividers: document.querySelectorAll('.main > .divider'),
    dividerSidebar: document.querySelector('.divider[data-id="sidebar"]'),
    sidebarLeft: document.querySelector('.sidebar-left'),
    panelMiddle: document.querySelector('.panel-middle'),
    panelRight: document.querySelector('.panel-right'),
    panelRight: document.querySelector('.panel-right'),
    btnSidebarToggle: document.getElementById('btn-sidebar-toggle'),
    btnHistoryToggle: document.getElementById('btn-history-toggle'),
    dividerTrace: document.getElementById('divider-trace'),

    // Toast
    toastContainer: document.getElementById('toast-container'),

    // Filter


    // Bulk Actions
    bulkActions: document.getElementById('bulk-actions'),
    bulkCount: document.getElementById('bulk-count'),
    btnBulkEnable: document.getElementById('btn-bulk-enable'),
    btnBulkDisable: document.getElementById('btn-bulk-disable'),
    btnBulkDelete: document.getElementById('btn-bulk-delete'),
    btnBulkCancel: document.getElementById('btn-bulk-cancel'),

    // Replay Controls
    replayControls: document.getElementById('replay-controls'),
    replayStepStatus: document.getElementById('replay-step-status'),
    replayStepTitle: document.getElementById('replay-step-title'),
    replayStepCounter: document.getElementById('replay-step-counter'),
    replayResultValue: document.getElementById('replay-result-value'),
    replayDetailEntity: document.getElementById('replay-detail-entity'),
    replayEntityValue: document.getElementById('replay-entity-value'),
    replayTimeValue: document.getElementById('replay-time-value'),
    replayDetailError: document.getElementById('replay-detail-error'),
    replayErrorValue: document.getElementById('replay-error-value'),
    replayPrev: document.getElementById('replay-prev'),
    replayNext: document.getElementById('replay-next'),
    replayExit: document.getElementById('replay-exit'),
    btnAddFolder: document.getElementById('btn-add-folder'),
    folderList: document.getElementById('folder-list'),
    btnAddTag: document.getElementById('btn-add-tag'),
    tagGroupList: document.getElementById('tag-group-list')
};

// ============================================
// Block Type Definitions
// ============================================

const TRIGGER_TYPES = [
    { id: 'state', name: 'State Change', icon: 'toggle' },
    { id: 'time', name: 'Time', icon: 'clock' },
    { id: 'sun', name: 'Sun', icon: 'sun' },
    { id: 'numeric_state', name: 'Numeric State', icon: 'hash' },
    { id: 'event', name: 'Event', icon: 'zap' },
    { id: 'persistent_notification', name: 'Persistent Notification', icon: 'bell' },
    { id: 'device', name: 'Device', icon: 'smartphone' },
    { id: 'template', name: 'Template', icon: 'code' },
    { id: 'zone', name: 'Zone', icon: 'map-pin' },
    { id: 'homeassistant', name: 'Home Assistant', icon: 'home' },
    { id: 'mqtt', name: 'MQTT', icon: 'rss' },
    { id: 'webhook', name: 'Webhook', icon: 'link' },
    { id: 'time_pattern', name: 'Time Pattern', icon: 'clock' }
];

const CONDITION_TYPES = [
    { id: 'state', name: 'State', icon: 'toggle' },
    { id: 'numeric_state', name: 'Numeric State', icon: 'hash' },
    { id: 'time', name: 'Time', icon: 'clock' },
    { id: 'sun', name: 'Sun', icon: 'sun' },
    { id: 'template', name: 'Template', icon: 'code' },
    { id: 'zone', name: 'Zone', icon: 'map-pin' },
    { id: 'device', name: 'Device', icon: 'smartphone' },
    { id: 'trigger', name: 'Trigger', icon: 'target' },
    { id: 'and', name: 'And', icon: 'layers' },
    { id: 'or', name: 'Or', icon: 'git-branch' },
    { id: 'not', name: 'Not', icon: 'filter' }
];

const ACTION_TYPES = [
    { id: 'service', name: 'Call Service', icon: 'play' },
    { id: 'notification', name: 'Notification', icon: 'bell' },
    { id: 'delay', name: 'Delay', icon: 'clock' },
    { id: 'wait_template', name: 'Wait Template', icon: 'pause' },
    { id: 'wait_for_trigger', name: 'Wait for Trigger', icon: 'target' },
    { id: 'condition', name: 'Condition', icon: 'filter' },
    { id: 'choose', name: 'Choose', icon: 'git-branch' },
    { id: 'if', name: 'If/Then/Else', icon: 'help-circle' },
    { id: 'repeat', name: 'Repeat', icon: 'repeat' },
    { id: 'parallel', name: 'Parallel', icon: 'layers' },
    { id: 'sequence', name: 'Sequence', icon: 'list' },
    { id: 'scene', name: 'Activate Scene', icon: 'sunset' },
    { id: 'event', name: 'Fire Event', icon: 'zap' },
    { id: 'variables', name: 'Set Variables', icon: 'edit-3' },
    { id: 'stop', name: 'Stop', icon: 'square' },
    { id: 'device', name: 'Device Action', icon: 'smartphone' }
];

// ============================================
// API Functions
// ============================================

async function fetchAutomations() {
    try {
        console.log('[fetchAutomations] Fetching from ./api/automations...');
        const res = await fetch('./api/automations');
        console.log('[fetchAutomations] Response status:', res.status);
        const data = await res.json();
        console.log('[fetchAutomations] Data received:', data);
        if (data.success) {
            state.automations = data.automations;
            elements.automationCount.textContent = data.automations.length;
            console.log('[fetchAutomations] Loaded', data.automations.length, 'automations');
        } else {
            console.error('[fetchAutomations] API returned success=false:', data.error);
        }
        return data.automations || [];
    } catch (error) {
        console.error('[fetchAutomations] Error:', error);
        showToast('Failed to load automations', 'error');
        return [];
    }
}

async function fetchHAStates() {
    try {
        const res = await fetch('./api/states');
        const data = await res.json();
        if (data.success) {
            const statesObj = {};
            data.states.forEach(s => {
                statesObj[s.entity_id] = s;
            });
            state.haStates = statesObj;
        }
    } catch (error) {
        console.warn('[fetchHAStates] Failed to load states:', error);
    }
}

async function fetchScripts() {
    try {
        const res = await fetch('./api/scripts');
        const data = await res.json();
        if (data.success) {
            state.scripts = data.scripts;
            elements.scriptCount.textContent = data.scripts.length;
        }
        return data.scripts || [];
    } catch (error) {
        showToast('Failed to load scripts', 'error');
        return [];
    }
}

// ============================================
// Version Control API Functions
// ============================================

async function checkVersionControlStatus() {
    try {
        const res = await fetch('./api/version-control/status');
        const data = await res.json();
        state.versionControl.available = data.available === true;
        updateVersionNavUI();
    } catch (error) {
        console.log('[VersionControl] Status check failed:', error);
        state.versionControl.available = false;
        updateVersionNavUI();
    }
}

async function loadVersionHistory(itemId, type = 'automation') {
    if (!state.versionControl.available) return;

    // Reset state - no loading indicator, just start fresh
    state.versionControl.commits = [];
    state.versionControl.currentIndex = -1;
    state.versionControl.previewMode = false;
    state.versionControl.previewData = null;
    state.versionControl.loading = false; // Don't show loading
    updateVersionNavUI();

    try {
        // Construct the VC-compatible composite ID
        const fileType = type === 'automation' ? 'automations' : 'scripts';
        const fileName = type === 'automation' ? 'automations.yaml' : 'scripts.yaml';
        const vcId = `${fileType}:${fileName}:${itemId}`;

        const endpoint = `./api/version-control/${type}/${encodeURIComponent(vcId)}/history-metadata`;
        const res = await fetch(endpoint);
        const data = await res.json();

        if (data.success && data.commits && data.commits.length > 0) {
            // Progressive filtering - update UI as each version is found
            await filterCommitsProgressively(data.commits, type, vcId);
        }
    } catch (error) {
        console.warn('[VersionControl] Failed to load history:', error);
    }
}

/**
 * Progressively filter commits and update UI as versions are discovered
 */
async function filterCommitsProgressively(commits, type, vcId) {
    let lastKeptContent = null;

    // Get current content for comparison
    const currentContent = state.selectedItem ? JSON.stringify(normalizeForComparison(state.selectedItem)) : '';

    // Only check the most recent 25 commits to avoid excessive API calls
    const commitsToScan = commits.slice(0, 25);
    for (const commit of commitsToScan) {
        // Check if we switched to a different item while scanning
        if (!state.selectedItem || String(state.selectedItem.id) !== String(vcId.split(':').pop())) {
            console.log('[VersionControl] Item changed, stopping scan');
            return;
        }

        try {
            // Fetch content at this commit
            const endpoint = `./api/version-control/${type}/${encodeURIComponent(vcId)}/at-commit?commitHash=${encodeURIComponent(commit.hash)}`;
            const res = await fetch(endpoint);
            const data = await res.json();

            if (!data.success) continue;

            const content = type === 'automation' ? data.automation : data.script;
            if (!content) continue;

            const contentStr = JSON.stringify(normalizeForComparison(content));

            // Skip if identical to current version
            if (contentStr === currentContent) continue;

            // Skip if identical to last kept version (consecutive duplicates)
            if (lastKeptContent !== null && contentStr === lastKeptContent) continue;

            // This commit has actual changes - add it and update UI immediately
            state.versionControl.commits.push(commit);
            lastKeptContent = contentStr;

            // Update the navigation UI to enable back button
            updateVersionNavUI();

        } catch (error) {
            console.warn(`[VersionControl] Error checking commit ${commit.hash}:`, error);
        }
    }

    console.log(`[VersionControl] Found ${state.versionControl.commits.length} versions with changes`);
}

/**
 * Normalize an object for comparison (remove noise like internal fields, sort keys)
 */
function normalizeForComparison(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => normalizeForComparison(item));
    }

    const result = {};
    const sortedKeys = Object.keys(obj).sort();
    for (const key of sortedKeys) {
        // Skip internal fields that don't affect the automation
        if (key === 'block-alias' || key === '_type') continue;
        result[key] = normalizeForComparison(obj[key]);
    }
    return result;
}


async function loadVersionAtCommit(commitHash, expansionState = null) {
    console.log('[Version] Loading commit with expansion state:', expansionState);
    if (!state.selectedItem) return;

    const type = state.selectedItem._type;
    const itemId = state.selectedItem.id;

    try {
        // Construct the VC-compatible composite ID
        const fileType = type === 'automation' ? 'automations' : 'scripts';
        const fileName = type === 'automation' ? 'automations.yaml' : 'scripts.yaml';
        const vcId = `${fileType}:${fileName}:${itemId}`;

        const endpoint = `./api/version-control/${type}/${encodeURIComponent(vcId)}/at-commit?commitHash=${encodeURIComponent(commitHash)}`;
        const res = await fetch(endpoint);
        const data = await res.json();

        if (data.success) {
            const content = type === 'automation' ? data.automation : data.script;
            if (content) {
                state.versionControl.previewData = content;
                state.versionControl.previewMode = true;

                // Re-render the editor with the historical version
                const historicalItem = { ...content, _type: type, id: itemId };
                populateEditor(historicalItem, expansionState);
                updateVersionNavUI();
            }
        }
    } catch (error) {
        console.error('[VersionControl] Failed to load version:', error);
        showToast('Failed to load historical version', 'error');
    }
}

function navigateVersion(direction) {
    const commits = state.versionControl.commits;
    if (commits.length === 0) return;

    const currentIndex = state.versionControl.currentIndex;
    let newIndex;

    if (direction === 'back') {
        // Go back in time (higher index = older)
        if (currentIndex === -1) {
            // Currently at live, go to most recent commit
            newIndex = 0;
        } else if (currentIndex < commits.length - 1) {
            newIndex = currentIndex + 1;
        } else {
            return; // Already at oldest
        }
    } else {
        // Go forward in time (lower index = newer)
        if (currentIndex === 0) {
            // Go back to live version
            newIndex = -1;
        } else if (currentIndex > 0) {
            newIndex = currentIndex - 1;
        } else {
            return; // Already at live
        }
    }

    state.versionControl.currentIndex = newIndex;

    if (newIndex === -1) {
        // Restore live version
        exitVersionPreview(getExpansionState());
    } else {
        // Load historical version
        const commit = commits[newIndex];
        loadVersionAtCommit(commit.hash, getExpansionState());
    }
}

/**
 * Initialize version nav style (Enforce Style 1 for now)
 */
function initVersionNavStyle() {
    const nav = document.querySelector('.version-nav');
    if (!nav) return;
    nav.dataset.style = "1";
}


function exitVersionPreview(expansionState = null) {
    if (!state.selectedItem) return;

    state.versionControl.previewMode = false;
    state.versionControl.previewData = null;
    state.versionControl.currentIndex = -1;

    // Reload the original item
    populateEditor(state.selectedItem, expansionState);
    updateVersionNavUI();
}

function updateVersionNavUI() {
    const nav = document.querySelector('.version-nav');
    if (!nav) return;

    const commits = state.versionControl.commits;
    const currentIndex = state.versionControl.currentIndex;
    const available = state.versionControl.available;
    const loading = state.versionControl.loading;
    const previewMode = state.versionControl.previewMode;

    // Show/hide based on availability
    console.log('[VersionControl] updateVersionNavUI: available=', available, 'commits=', commits.length);
    nav.style.display = available ? 'flex' : 'none';

    if (!available) {
        console.log('[VersionControl] nav hidden because available is false');
        return;
    }

    // Update buttons
    const btnBack = nav.querySelector('.version-nav-back');
    const btnForward = nav.querySelector('.version-nav-forward');
    const badge = nav.querySelector('.version-badge');

    if (loading) {
        badge.textContent = 'Loading...';
        btnBack.disabled = true;
        btnForward.disabled = true;
        return;
    }

    // Enable/disable navigation buttons
    btnBack.disabled = commits.length === 0 || currentIndex >= commits.length - 1;
    btnForward.disabled = currentIndex === -1;

    // Update badge text and container state
    const versionNav = document.querySelector('.version-nav');
    if (currentIndex === -1) {
        badge.textContent = 'Current';
        badge.classList.remove('is-historical');
        if (versionNav) versionNav.classList.remove('is-historical-mode');
    } else {
        const commit = commits[currentIndex];
        const date = new Date(commit.date);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        const time = date.toLocaleString(undefined, {
            hour: 'numeric',
            minute: '2-digit'
        });

        if (isToday) {
            badge.textContent = `Today ${time}`;
        } else {
            const month = date.toLocaleString(undefined, { month: 'short' });
            const day = date.toLocaleString(undefined, { day: 'numeric' });
            badge.textContent = `${month} ${day} ${time}`;
        }
        badge.classList.add('is-historical');
        if (versionNav) versionNav.classList.add('is-historical-mode');
    }

    // Update save button visual state (illuminate if in preview mode)
    updateSaveButtonStatus(state.isDirty);
}

async function saveItem() {
    if (!state.selectedItem) return;

    let item;
    const isRestoring = state.versionControl.previewMode;

    if (!isRestoring && state.currentView !== 'yaml') {
        const validation = validateEditorFields();
        if (!validation.valid) {
            showToast('Please fill required fields before saving.', 'error');
            if (validation.firstInvalid) {
                const blockEl = validation.firstInvalid.closest('.action-block');
                if (blockEl && blockEl.classList.contains('collapsed')) {
                    blockEl.classList.remove('collapsed');
                }
                validation.firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
    }

    // If restoring a historical version, use the preview data directly
    if (isRestoring && state.versionControl.previewData) {
        item = JSON.parse(JSON.stringify(state.versionControl.previewData));
        // Ensure the ID matches the current item
        item.id = state.selectedItem.id;
        console.log('[Save] Restoring historical version:', item);
    }
    // If in YAML view, parse the YAML first
    else if (state.currentView === 'yaml') {
        try {
            const res = await fetch('./api/parse-yaml', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml: elements.yamlContent.value })
            });
            const data = await res.json();
            if (!data.success) {
                showToast(`YAML Error: ${data.error}`, 'error');
                return;
            }
            item = data.config;

            // Update state so if we switch back to visual, it's correct
            // (Note: this modifies the in-memory state object structure)
            Object.assign(state.selectedItem, item);
        } catch (e) {
            showToast(`Error parsing YAML: ${e.message}`, 'error');
            return;
        }
    } else {
        item = getEditorData();
    }

    // Clean up internal UI fields before saving
    item = cleanupInternalFields(item);

    const isAutomation = state.currentGroup === 'automations';
    const endpoint = isAutomation ? './api/automation' : './api/script';

    console.log('[saveCurrentItem] Saving item:', item);

    try {
        let res;
        if (state.isNewItem) {
            res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
        } else {
            res = await fetch(`${endpoint}/${state.selectedItem.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
        }

        const data = await res.json();
        if (data.success) {
            // Exit preview mode after successful restore
            if (isRestoring) {
                // Update the live entity in our state with the restored data
                Object.assign(state.selectedItem, item);
                exitVersionPreview();
            }

            // Use the item we just saved (which is clean and accurate) as the snapshot
            // This ensures logic works for both Visual and YAML views
            state.originalItemSnapshot = JSON.stringify(item);
            state.isDirty = false;
            state.isNewItem = false;

            // Reload the list (so we have the updated file content locally)
            await loadItems();

            // Check config before confirming success
            try {
                const configRes = await fetch('./api/check_config', { method: 'POST' });
                const configData = await configRes.json();

                if (configData.result === 'invalid') {
                    showToast('Saved with errors - Config invalid', 'error');
                    showConfigError(configData.errors);
                    return; // Stop here, do not reload HA
                }
            } catch (err) {
                console.warn('Config check failed:', err);
            }

            // Config is valid, reload in HA first, then show a single success toast
            await reloadInHA(false);
            const typeLabel = isAutomation ? 'Automation' : 'Script';
            const actionLabel = isRestoring ? 'restored' : 'saved';
            showToast(`${typeLabel} ${actionLabel} and reloaded!`, 'success');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast(`Failed to save: ${error.message}`, 'error');
    }
}

function deleteItem() {
    if (!state.selectedItem || state.isNewItem) return;

    showConfirm(`Are you sure you want to delete "${state.selectedItem.alias}"?`, async () => {

        const isAutomation = state.currentGroup === 'automations';
        const endpoint = isAutomation
            ? `./api/automation/${state.selectedItem.id}`
            : `./api/script/${state.selectedItem.id}`;

        try {
            const res = await fetch(endpoint, { method: 'DELETE' });
            const data = await res.json();

            if (data.success) {
                showToast(`${isAutomation ? 'Automation' : 'Script'} deleted`, 'success');
                state.selectedItem = null;
                showEmptyState();
                await loadItems();
                await reloadInHA();
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            showToast(`Failed to delete: ${error.message}`, 'error');
        }
    });
}

async function reloadInHA(showToastNotice = true) {
    const endpoint = state.currentGroup === 'automations'
        ? './api/reload/automations'
        : './api/reload/scripts';

    try {
        await fetch(endpoint, { method: 'POST' });
        if (showToastNotice) {
            showToast('Reloaded in Home Assistant', 'success');
        }
    } catch (error) {
        console.warn('Failed to reload in HA:', error);
    }
}

async function runSelectedItem() {
    if (!state.selectedItem) return;

    const domain = state.currentGroup === 'automations' ? 'automation' : 'script';
    const itemId = state.selectedItem.id;
    const entityId = state.selectedItem.entity_id;

    try {
        elements.btnRun.disabled = true;
        elements.btnRun.innerHTML = `
            <div class="spinner spinner-sm"></div>
            Running...
        `;

        const response = await fetch(`./api/run/${domain}/${encodeURIComponent(itemId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_id: entityId })
        });

        const result = await response.json();

        if (result.success) {
            showToast(`${state.currentGroup === 'automations' ? 'Automation' : 'Script'} triggered successfully!`, 'success');
            // Refresh traces after a short delay
            setTimeout(() => {
                if (String(state.selectedItem?.id) === String(itemId)) {
                    loadTracesForItem();
                }
            }, 1500);
        } else {
            showToast(`Failed to trigger: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error triggering:', error);
        showToast(`Error: ${error.message}`, 'error');
    } finally {
        elements.btnRun.disabled = false;
        elements.btnRun.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run
        `;
    }
}

async function toggleItemEnabled(item, enabled) {
    if (!item || item._type !== 'automation') {
        showToast('Enable/Disable is only available for automations', 'info');
        return;
    }

    const itemId = item.id;
    const entityId = item.entity_id;

    try {
        const response = await fetch(`./api/run/automation/${encodeURIComponent(itemId)}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_id: entityId, enabled: enabled })
        });

        const result = await response.json();
        if (result.success) {
            showToast(`Automation ${enabled ? 'enabled' : 'disabled'}`, 'success');
            await loadItems();

            if (state.selectedItem && String(state.selectedItem.id) === String(itemId)) {
                elements.editorEnabled.checked = enabled;
                const toggleLabel = elements.editorEnabled.closest('.enabled-toggle').querySelector('.toggle-label');
                if (toggleLabel) toggleLabel.textContent = enabled ? 'Enabled' : 'Disabled';
            }
        } else {
            showToast(`Failed to toggle: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error toggling automation:', error);
        showToast(`Error: ${error.message}`, 'error');
    }
}

// ============================================
// Trace Functions
// ============================================

async function fetchTraces(automationId) {
    try {
        const domain = state.currentGroup === 'automations' ? 'automation' : 'script';
        const res = await fetch(`./api/traces/${domain}/${encodeURIComponent(automationId)}`);
        const data = await res.json();
        if (data.success) {
            return data.traces || [];
        }
        return [];
    } catch (error) {
        console.error('[fetchTraces] Error:', error);
        return [];
    }
}

function renderTracePanel(traces) {
    let filtered = traces;

    if (filtered.length === 0) {
        elements.traceList.innerHTML = `
            <div class="trace-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>No runs yet</span>
            </div>
        `;
        return;
    }

    // Group by day
    const groups = groupTracesByDay(filtered);

    let html = '';
    for (const [label, dayTraces] of Object.entries(groups)) {
        html += `<div class="trace-day-group">`;
        html += `<div class="trace-day-label">${label}</div>`;

        for (const trace of dayTraces) {
            const status = getTraceStatus(trace);
            const time = formatTraceTime(trace.timestamp);
            const trigger = formatTriggerText(trace.trigger);
            const duration = formatDurationMs(trace.timestamp, trace.finish_time);
            const statusLabel = getStatusLabel(trace);

            html += `
                <div class="trace-item ${status}" data-run-id="${trace.run_id}" data-trace-index="${dayTraces.indexOf(trace)}">
                    <div class="trace-item-header">
                        <div class="trace-status-icon ${status}">
                            ${getStatusIcon(status)}
                        </div>
                        <div class="trace-info">
                            <div class="trace-time-row">
                                <span class="trace-time">${time}</span>
                                ${duration ? `<span class="trace-duration">${duration}</span>` : ''}
                            </div>
                            <div class="trace-trigger">${escapeHtml(trigger)}</div>
                        </div>
                        ${trace.steps && trace.steps.length > 0 ? `
                        <button class="trace-replay-btn" title="Replay this run" data-run-id="${trace.run_id}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="5 3 19 12 5 21 5 3"/>
                            </svg>
                        </button>
                        ` : ''}
                        <svg class="trace-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </div>
                    <div class="trace-details">
                        ${renderTraceDetails(trace)}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
    }

    elements.traceList.innerHTML = html;

    // Store traces in state for replay access
    state.currentTraces = traces;

    // Add click handlers for expand/collapse
    elements.traceList.querySelectorAll('.trace-item-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // Don't toggle if clicking the replay button
            if (e.target.closest('.trace-replay-btn')) return;
            header.parentElement.classList.toggle('expanded');
        });
    });

    // Add click handlers for replay buttons
    elements.traceList.querySelectorAll('.trace-replay-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const runId = btn.dataset.runId;
            const trace = traces.find(t => String(t.run_id) === String(runId));
            if (trace) {
                enterReplayMode(trace);
            }
        });
    });
}

// Format trigger text to be more readable
function formatTriggerText(trigger) {
    if (!trigger || trigger === 'unknown') return 'Manual trigger';

    // Simplify common patterns
    return trigger
        .replace('state of ', '')
        .replace('_', ' ')
        .split('.').pop(); // Get just the entity name
}

// Calculate duration between start and finish
function formatDurationMs(start, finish) {
    if (!start || !finish) return null;

    const startTime = new Date(start).getTime();
    const finishTime = new Date(finish).getTime();
    const diffMs = finishTime - startTime;

    if (diffMs < 1) return '<1ms';
    if (diffMs < 1000) return `${diffMs}ms`;
    if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
    return `${(diffMs / 60000).toFixed(1)}m`;
}

// Get status icon SVG
function getStatusIcon(status) {
    if (status === 'failed') {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>`;
    }
    if (status === 'condition-failed') {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>`;
    }
    // Success
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="8 12 11 15 16 9"/>
    </svg>`;
}

// Get human-readable status label
function getStatusLabel(trace) {
    if (trace.error) return trace.error;
    if (trace.script_execution === 'failed_single') return 'Already running';
    if (trace.script_execution === 'finished') return null; // Don't show for success
    if (trace.script_execution) return trace.script_execution.replace(/_/g, ' ');
    return null;
}

// Render detailed trace information
function renderTraceDetails(trace) {
    if (!trace.steps || trace.steps.length === 0) {
        return '<div class="trace-detail-row"><span class="trace-detail-value">No details available</span></div>';
    }

    let html = `<div class="trace-steps-list">`;

    // Pre-process steps to group successful conditions
    const processedSteps = [];
    let conditionCount = 0;

    trace.steps.forEach(step => {
        const isCondition = step.path.startsWith('condition');
        const isSuccess = !step.error && (!step.resultText || !step.resultText.includes('✗'));

        if (isCondition && isSuccess) {
            conditionCount++;
        } else {
            if (conditionCount > 0) {
                processedSteps.push({ type: 'conditions_grouped', count: conditionCount });
                conditionCount = 0;
            }
            processedSteps.push(step);
        }
    });
    // Push remaining conditions
    if (conditionCount > 0) {
        processedSteps.push({ type: 'conditions_grouped', count: conditionCount });
    }

    // Render steps
    for (const step of processedSteps) {
        if (step.type === 'conditions_grouped') {
            html += `
                <div class="trace-step success grouped">
                    <div class="trace-step-header">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg class="step-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span class="trace-step-path">${step.count} Conditions Passed</span>
                        </div>
                    </div>
                </div>`;
            continue;
        }

        // Normal Step
        const stepStatus = step.error ? 'failed' : (step.resultText?.includes('✗') ? 'condition-failed' : 'success');
        const stepPath = formatStepPath(step.path);

        // Clean up entity/description
        let entityLine = '';
        if (step.entityId) {
            entityLine = `<span class="trace-step-entity">${escapeHtml(step.entityId)}</span>`;
        } else if (step.description) {
            entityLine = `<span class="trace-step-entity">${escapeHtml(step.description)}</span>`;
        }

        // Clean up result/error
        let resultLine = '';
        let errorLine = '';

        if (step.error) {
            // Try to parse if it's JSON
            let errorText = step.error;
            try {
                if (errorText.trim().startsWith('{')) {
                    const parsed = JSON.parse(errorText);
                    // Extract meaningful message if possible
                    if (parsed.message) errorText = parsed.message;
                    else if (parsed.error) errorText = parsed.error;
                    // Otherwise keep simpler JSON string
                }
            } catch (e) { } // Not JSON, keep as is

            errorLine = `<div class="trace-step-error">${escapeHtml(errorText)}</div>`;
        } else if (step.resultText && !step.resultText.includes('passed')) {
            // Only show result text if it's not just "passed" (which is redundant with the icon)
            // Also check for raw JSON in result text
            let resText = step.resultText;
            if (resText.trim().startsWith('{')) {
                try {
                    const parsed = JSON.parse(resText);
                    if (parsed.params) resText = `Call ${parsed.params.domain}.${parsed.params.service}`;
                    else resText = 'Complex Result'; // Simplified
                } catch (e) { }
            }
            resultLine = `<span class="trace-step-result">${escapeHtml(resText)}</span>`;
        }

        html += `
            <div class="trace-step ${stepStatus}">
                <div class="trace-step-header">
                    <div style="display:flex; align-items:center; gap:6px;">
                        ${stepStatus === 'failed' ?
                `<svg class="step-icon failed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` :
                (stepStatus === 'condition-failed' ?
                    `<svg class="step-icon condition-failed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` :
                    `<svg class="step-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>` // Use circle for normal steps
                )
            }
                        <span class="trace-step-path">${stepPath}</span>
                    </div>
                    ${resultLine}
                </div>
                ${entityLine ? `<div class="trace-step-entity-row">${entityLine}</div>` : ''}
                ${errorLine}
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

function renderTraceSteps(trace) {
    if (!trace.steps || trace.steps.length === 0) {
        if (trace.error) {
            return `<div class="trace-step">
                <svg class="trace-step-icon failed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <div class="trace-step-content">
                    <div class="trace-step-error">${escapeHtml(trace.error)}</div>
                </div>
            </div>`;
        }
        return '<div class="trace-step"><span class="trace-step-result">No details available</span></div>';
    }

    return trace.steps.map(step => {
        const isSuccess = !step.error;
        const iconClass = isSuccess ? 'success' : 'failed';
        const icon = isSuccess
            ? '<circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>'
            : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';

        const pathLabel = formatStepPath(step.path);
        const result = step.error
            ? `<span class="trace-step-error">${escapeHtml(step.error)}</span>`
            : formatStepResult(step.result);

        return `
            <div class="trace-step">
                <svg class="trace-step-icon ${iconClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${icon}
                </svg>
                <div class="trace-step-content">
                    <div class="trace-step-path">${pathLabel}</div>
                    <div class="trace-step-result">${result}</div>
                </div>
            </div>
        `;
    }).join('');
}

function formatStepPath(path) {
    // Convert "trigger/0" to "Trigger 1", "action/2" to "Action 3"
    if (!path) return 'Step';
    const parts = path.split('/');
    const type = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const index = parts[1] ? parseInt(parts[1]) + 1 : '';
    return `${type} ${index}`;
}

function formatStepResult(result) {
    if (!result || Object.keys(result).length === 0) return '✓';

    // Show key results
    if (result.result === false) return 'Condition: false';
    if (result.result === true) return 'Condition: true';
    if (result.triggered) return 'Triggered';
    if (result.done) return 'Complete';

    return JSON.stringify(result).substring(0, 50);
}

function getTraceStatus(trace) {
    if (trace.error) return 'failed';
    if (trace.script_execution === 'failed_single') return 'failed';
    if (trace.script_execution === 'error') return 'failed';
    if (hasConditionFailed(trace)) return 'condition-failed';
    return 'success';
}

function hasFailedStep(trace) {
    return trace.steps?.some(s => s.error) || false;
}

function hasConditionFailed(trace) {
    return trace.steps?.some(s =>
        s.path?.includes('condition') && s.result?.result === false
    ) || false;
}

function groupTracesByDay(traces) {
    const groups = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);

    for (const trace of traces) {
        const date = new Date(trace.timestamp);
        const traceDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        let label;
        if (traceDay.getTime() === today.getTime()) {
            label = 'Today';
        } else if (traceDay.getTime() === yesterday.getTime()) {
            label = 'Yesterday';
        } else {
            label = traceDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }

        if (!groups[label]) groups[label] = [];
        groups[label].push(trace);
    }

    return groups;
}

function formatTraceTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function loadTracesForItem() {
    if (!state.selectedItem) {
        elements.panelTrace.style.display = 'none';
        return;
    }

    // Both automations and scripts support traces
    const isVisible = !state.historyCollapsed;
    elements.panelTrace.style.display = isVisible ? 'flex' : 'none';
    if (elements.dividerTrace) elements.dividerTrace.style.display = isVisible ? 'block' : 'none';

    if (!isVisible) return;

    console.log(`[loadTracesForItem] Loading traces for ${state.selectedItem.id}`);
    const traces = await fetchTraces(state.selectedItem.id);
    console.log(`[loadTracesForItem] Received ${traces.length} traces`);
    renderTracePanel(traces);

    // Setup periodic refresh
    if (state.traceInterval) clearInterval(state.traceInterval);
    state.traceInterval = setInterval(async () => {
        if (!state.selectedItem || state.historyCollapsed) {
            clearInterval(state.traceInterval);
            state.traceInterval = null;
            return;
        }
        const updatedTraces = await fetchTraces(state.selectedItem.id);
        renderTracePanel(updatedTraces);
    }, 15000); // Refresh every 15 seconds
}

function showConfigError(errors) {
    // Make sure panel is visible (force open on error)
    elements.panelTrace.style.display = 'flex';
    if (elements.dividerTrace) elements.dividerTrace.style.display = 'block';
    state.historyCollapsed = false; // Update state
    localStorage.setItem('ha-editor-history-collapsed', 'false');

    // Create error message
    // Convert errors to string if object
    let errorText = errors;
    if (typeof errors === 'object') {
        errorText = JSON.stringify(errors, null, 2);
    }

    const errorHtml = `
        <div class="config-error-message">
            <div class="config-error-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                   <circle cx="12" cy="12" r="10"></circle>
                   <line x1="12" y1="8" x2="12" y2="12"></line>
                   <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>Configuration Error</span>
            </div>
            <pre>${escapeHtml(errorText)}</pre>
        </div>
    `;

    // Inject at top (keeping existing traces below)
    elements.traceList.innerHTML = errorHtml + elements.traceList.innerHTML;

    // Scroll to top
    elements.traceList.scrollTop = 0;
}

// ============================================
// Trace Replay Functions
// ============================================

function enterReplayMode(trace) {
    if (!trace || !trace.steps || trace.steps.length === 0) {
        showToast('No steps available to replay', 'warning');
        return;
    }

    console.log('[Replay] Entering replay mode with trace:', trace.run_id);

    state.replayMode = true;
    state.replayTrace = trace;
    state.replayStepIndex = 0;

    // Add replay mode class to body
    document.body.classList.add('replay-mode');

    // Show replay controls
    elements.replayControls.style.display = 'flex';

    // Highlight first step
    highlightBlockForStep(state.replayStepIndex);
    updateReplayUI();

    // Add keyboard listener
    document.addEventListener('keydown', handleReplayKeydown);
}

function exitReplayMode() {
    console.log('[Replay] Exiting replay mode');

    state.replayMode = false;
    state.replayTrace = null;
    state.replayStepIndex = 0;

    // Remove replay mode class
    document.body.classList.remove('replay-mode');

    // Hide replay controls
    elements.replayControls.style.display = 'none';

    // Clear all highlights
    clearBlockHighlights();

    // Remove keyboard listener
    document.removeEventListener('keydown', handleReplayKeydown);
}

function navigateReplayStep(direction) {
    if (!state.replayMode || !state.replayTrace) return;

    const steps = state.replayTrace.steps;
    const newIndex = state.replayStepIndex + direction;

    if (newIndex < 0 || newIndex >= steps.length) return;

    state.replayStepIndex = newIndex;
    highlightBlockForStep(state.replayStepIndex);
    updateReplayUI();
}

function highlightBlockForStep(stepIndex) {
    const trace = state.replayTrace;
    if (!trace || !trace.steps || stepIndex >= trace.steps.length) return;

    const step = trace.steps[stepIndex];
    const path = step.path; // e.g., "trigger/0", "condition/1", "action/2"

    // Clear previous highlights
    clearBlockHighlights();

    // Parse the path to find the section and index
    const [section, indexStr] = path.split('/');
    const blockIndex = parseInt(indexStr, 10);

    // Determine the status for this step
    let stepStatus = 'success';
    if (step.error) {
        stepStatus = 'failed';
    } else if (step.result?.result === false) {
        stepStatus = 'condition-failed';
    }

    // Find the container for this section
    let containerId;
    if (section === 'trigger') {
        containerId = 'triggers-container';
    } else if (section === 'condition') {
        containerId = 'conditions-container';
    } else if (section === 'action' || section === 'sequence') {
        containerId = 'actions-container';
    } else {
        // For nested paths like "action/0/choose/0", try to find in actions
        containerId = 'actions-container';
    }

    const container = document.getElementById(containerId);
    if (!container) {
        console.warn('[Replay] Container not found:', containerId);
        return;
    }

    // Find the block at this index
    const blocks = container.querySelectorAll('.action-block');
    const block = blocks[blockIndex];

    if (!block) {
        console.warn('[Replay] Block not found at index:', blockIndex, 'in', containerId);
        return;
    }

    // Add highlight classes
    block.classList.add('replay-highlight', `replay-${stepStatus}`);

    // Auto-expand the block if it's collapsed (so user can see the details)
    if (block.classList.contains('collapsed')) {
        block.classList.remove('collapsed');
        block.classList.add('replay-auto-expanded'); // Mark for later collapse
    }

    // Add step badge
    const badge = document.createElement('div');
    badge.className = 'replay-step-badge';
    badge.textContent = stepIndex + 1;
    block.appendChild(badge);

    // Add error tooltip if there's an error
    if (step.error) {
        const tooltip = document.createElement('div');
        tooltip.className = 'replay-error-tooltip';
        tooltip.textContent = step.error;
        block.appendChild(tooltip);
    }

    // Scroll the block into view
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearBlockHighlights() {
    // Remove highlight classes from all blocks and re-collapse auto-expanded ones
    document.querySelectorAll('.action-block.replay-highlight').forEach(block => {
        block.classList.remove('replay-highlight', 'replay-success', 'replay-failed', 'replay-condition-failed');

        // Re-collapse blocks that were auto-expanded for replay
        if (block.classList.contains('replay-auto-expanded')) {
            block.classList.remove('replay-auto-expanded');
            block.classList.add('collapsed');
        }

        // Remove badge
        const badge = block.querySelector('.replay-step-badge');
        if (badge) badge.remove();

        // Remove error tooltip
        const tooltip = block.querySelector('.replay-error-tooltip');
        if (tooltip) tooltip.remove();
    });
}

function updateReplayUI() {
    const trace = state.replayTrace;
    if (!trace || !trace.steps) return;

    const step = trace.steps[state.replayStepIndex];
    const totalSteps = trace.steps.length;

    // Determine step status
    let statusClass = 'success';
    let resultText = '✓ Executed';
    if (step.error) {
        statusClass = 'failed';
        resultText = '✗ Failed';
    } else if (step.result?.result === false) {
        statusClass = 'condition-failed';
        resultText = '✗ Condition not met';
    } else if (step.result?.result === true) {
        resultText = '✓ Condition passed';
    } else if (step.result?.choice) {
        resultText = `→ Took branch: ${step.result.choice}`;
    } else if (step.resultText) {
        resultText = step.resultText;
    }

    // Update status indicator
    elements.replayStepStatus.className = `replay-step-status ${statusClass}`;

    // Update step title (e.g., "Trigger 0" or "Action 5")
    elements.replayStepTitle.textContent = formatStepPath(step.path);

    // Update counter
    elements.replayStepCounter.textContent = `${state.replayStepIndex + 1}/${totalSteps}`;

    // Update result
    elements.replayResultValue.textContent = resultText;
    elements.replayResultValue.className = `replay-detail-value ${statusClass === 'failed' ? 'replay-error' : ''}`;

    // Update entity (show if available)
    if (step.entityId) {
        elements.replayDetailEntity.style.display = 'flex';
        elements.replayEntityValue.textContent = step.entityId;
    } else {
        elements.replayDetailEntity.style.display = 'none';
    }

    // Update timestamp
    if (step.timestamp) {
        const time = new Date(step.timestamp).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
        });
        elements.replayTimeValue.textContent = time;
    } else {
        elements.replayTimeValue.textContent = '--';
    }

    // Update error (show if present)
    if (step.error) {
        elements.replayDetailError.style.display = 'flex';
        elements.replayErrorValue.textContent = step.error;
    } else {
        elements.replayDetailError.style.display = 'none';
    }

    // Update button states
    elements.replayPrev.disabled = state.replayStepIndex === 0;
    elements.replayNext.disabled = state.replayStepIndex >= totalSteps - 1;
}

function handleReplayKeydown(e) {
    if (!state.replayMode) return;

    switch (e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            navigateReplayStep(-1);
            break;
        case 'ArrowRight':
            e.preventDefault();
            navigateReplayStep(1);
            break;
        case 'Escape':
            e.preventDefault();
            exitReplayMode();
            break;
    }
}

// ============================================
// UI Functions
// ============================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-message">${message}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s cubic-bezier(0.2, 0, 0.2, 1) forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showEmptyState() {
    elements.emptyState.style.display = 'flex';
    elements.editorHeader.style.display = 'none';
    elements.visualEditor.style.display = 'none';
    elements.yamlEditor.style.display = 'none';
    elements.editorFooter.style.display = 'none';
}

function showEditor() {
    elements.emptyState.style.display = 'none';
    elements.editorHeader.style.display = 'block';
    elements.editorFooter.style.display = 'flex';

    if (state.currentView === 'visual') {
        elements.visualEditor.style.display = 'block';
        elements.yamlEditor.style.display = 'none';
    } else {
        elements.visualEditor.style.display = 'none';
        elements.yamlEditor.style.display = 'flex';
    }
    updatePasteButtonsVisibility();
}

async function loadItems() {
    console.log('>>> [loadItems] START. Group:', state.currentGroup, 'Folder:', state.selectedFolder);

    const search = parseSearchInput(elements.searchInput.value);
    const useUnified = !!state.selectedFolder || !!state.selectedTagGroup || search.tags.length > 0;

    // Fetch items, states, and folders in parallel
    const promises = [
        fetchHAStates(),
        state.folders.length === 0 ? fetchFolders() : Promise.resolve()
    ];

    if (useUnified) {
        // Unified view: fetch both automations and scripts
        promises.push(fetchAutomations());
        promises.push(fetchScripts());
    } else {
        promises.push(state.currentGroup === 'automations' ? fetchAutomations() : fetchScripts());
    }

    await Promise.all(promises);

    let items = [];
    if (useUnified) {
        // Mark types for state matching and icons
        state.automations.forEach(a => a._type = 'automation');
        state.scripts.forEach(s => s._type = 'script');
        items = [...state.automations, ...state.scripts];
    } else {
        items = state.currentGroup === 'automations' ? state.automations : state.scripts;
        items.forEach(i => i._type = state.currentGroup === 'automations' ? 'automation' : 'script');
    }

    // Merge state data (last_triggered)
    items.forEach(item => {
        const domain = item._type;
        // Try to find the matching HA state
        // 1. Try exact ID match
        let entityId = `${domain}.${item.id}`;
        let haState = state.haStates[entityId];

        // 2. Try slugified ID
        if (!haState) {
            const slugId = item.id.toLowerCase().replace(/\s+/g, '_');
            entityId = `${domain}.${slugId}`;
            haState = state.haStates[entityId];
        }

        // 3. Try slugified Alias (most common for automations)
        if (!haState && item.alias) {
            const slugAlias = item.alias.toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_|_$/g, '');

            const aliasEntityId = `${domain}.${slugAlias}`;
            const aliasState = state.haStates[aliasEntityId];

            if (aliasState) {
                haState = aliasState;
                entityId = aliasEntityId;
            }
        }

        // 4. Try matching friendly_name (scan all states)
        if (!haState && item.alias) {
            const entries = Object.values(state.haStates);
            const match = entries.find(s =>
                s.entity_id.startsWith(domain + '.') &&
                s.attributes.friendly_name === item.alias
            );

            if (match) {
                haState = match;
                entityId = match.entity_id;
            }
        }

        if (haState) {
            item.last_triggered = haState.attributes?.last_triggered || null;
            item.entity_id = entityId;

            // Sync enabled state from HA (only for automations)
            if (domain === 'automation') {
                item.enabled = haState.state === 'on';
            }
        } else {
            // Fallback (keep what we guessed, or null)
            item.last_triggered = null;
            item.entity_id = entityId;
            // If we have an entity_id but no state, don't automatically mark as disabled
            // if the server already claimed it was enabled (initial_state: true)
        }
    });

    // Sort by last_triggered (most recent first)
    items.sort((a, b) => {
        if (!a.last_triggered) return 1;
        if (!b.last_triggered) return -1;
        return new Date(b.last_triggered) - new Date(a.last_triggered);
    });

    renderItemsList(items);
    renderTagGroups();
}

function renderItemsList(items) {
    console.log('>>> [renderItemsList] START. Items count:', items.length);
    const search = parseSearchInput(elements.searchInput.value);

    // Filter by folder if one is selected
    let filtered = items;
    if (state.selectedFolder) {
        const folder = state.folders.find(f => String(f.id) === String(state.selectedFolder));
        if (folder) {
            filtered = items.filter(item => folder.items.includes(item.id));
        }
    }

    if (state.selectedTagGroup) {
        const group = state.tagGroups.find(g => String(g.id) === String(state.selectedTagGroup));
        if (group && group.tags && group.tags.length) {
            filtered = filtered.filter(item => {
                const itemTags = getItemTags(item).normalized;
                return group.tags.some(tag => itemTags.includes(tag.toLowerCase()));
            });
        }
    }

    filtered = filtered.filter(item => {
        const name = (item.alias || item.id || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const textMatch = !search.text || name.includes(search.text) || desc.includes(search.text);

        if (!search.tags.length) return textMatch;

        const itemTags = getItemTags(item).normalized;
        const tagMatch = search.tags.every(tag => itemTags.includes(tag));
        return textMatch && tagMatch;
    });

    if (filtered.length === 0) {
        elements.itemsList.innerHTML = '<div class="loading-state"><span>No items found</span></div>';
        return;
    }

    elements.itemsList.innerHTML = filtered.map(item => {
        const lastRunText = item.last_triggered ? formatRelativeTime(item.last_triggered) : 'Never';
        const activeClass = (state.selectedItem && String(state.selectedItem.id) === String(item.id)) ? 'active' : '';
        const typeIcon = item._type === 'automation' ?
            `<svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>` :
            `<svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>`;
        const showType = state.selectedFolder !== null || state.selectedTagGroup !== null;

        const descText = stripTagsFromText(item.description || '');

        return `
    <div class="item-card ${item.enabled === false ? 'disabled' : ''} ${activeClass}" 
         data-id="${item.id}" data-type="${item._type}" draggable="true">
      <div class="item-name">
        <span class="status-dot ${item.enabled === false ? 'disabled' : ''}"></span>
        ${showType ? `<div class="item-type-tag" title="${item._type === 'automation' ? 'Automation' : 'Script'}">${typeIcon}</div>` : ''}
        <div class="item-info">
          <div class="item-title">
            <span class="item-text">${escapeHtml(item.alias || item.id)}</span>
          </div>
          ${descText ? `<div class="item-description">${escapeHtml(descText)}</div>` : ''}
        </div>
        <div class="item-last-run">${lastRunText}</div>
      </div>
    </div>
  `;
    }).join('');

    // Event listeners are now handled via delegation in initEventListeners
}

function parseSearchInput(value) {
    const raw = (value || '').trim();
    const tags = [];
    const tagRegex = /#[\w-]+/g;
    const matches = raw.match(tagRegex) || [];
    matches.forEach(tag => {
        const normalized = tag.slice(1).toLowerCase();
        if (normalized && !tags.includes(normalized)) tags.push(normalized);
    });
    const text = raw.replace(tagRegex, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return { text, tags };
}

function getItemTags(item) {
    const source = `${item.alias || item.id || ''} ${item.description || ''}`;
    const regex = /#[\w-]+/g;
    const matches = source.match(regex) || [];
    const normalized = [];
    const display = [];
    matches.forEach(tag => {
        const norm = tag.slice(1).toLowerCase();
        if (!normalized.includes(norm)) {
            normalized.push(norm);
            display.push(tag);
        }
    });
    const variableTags = getVariableTags(item.variables);
    variableTags.forEach(tag => {
        const norm = tag.slice(1).toLowerCase();
        if (!normalized.includes(norm)) {
            normalized.push(norm);
            display.push(tag);
        }
    });
    return { normalized, display };
}

function extractTagsFromText(text) {
    const regex = /#[\w-]+/g;
    const matches = (text || '').match(regex) || [];
    const unique = [];
    matches.forEach(tag => {
        const norm = tag.toLowerCase();
        if (!unique.includes(norm)) unique.push(norm);
    });
    return unique;
}

function stripTagsFromText(text) {
    return (text || '').replace(/#[\w-]+/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeTagsInput(value) {
    const raw = (value || '').trim();
    if (!raw) return [];
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    const tags = [];
    parts.forEach(part => {
        let tag = part.startsWith('#') ? part : `#${part}`;
        tag = tag.replace(/[^#\w-]/g, '');
        if (tag === '#') return;
        const norm = tag.toLowerCase();
        if (!tags.includes(norm)) tags.push(norm);
    });
    return tags;
}

function buildDescriptionWithTags(description) {
    return (description || '').trim();
}

function getVariableTags(vars) {
    if (!vars || typeof vars !== 'object') return [];
    const raw = vars.__tags;
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw
            .map(t => String(t || '').trim())
            .filter(Boolean)
            .map(t => t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`);
    }
    if (typeof raw === 'string') {
        return normalizeTagsInput(raw);
    }
    return [];
}

let tagsAutosaveTimeout = null;
let activeInlineTagText = null;

function scheduleTagsAutosave() {
    if (!state.selectedItem || state.isNewItem) return;
    if (state.versionControl.previewMode) return;
    if (state.currentView === 'yaml') return;

    if (tagsAutosaveTimeout) clearTimeout(tagsAutosaveTimeout);
    tagsAutosaveTimeout = setTimeout(async () => {
        if (!state.selectedItem || state.isNewItem) return;

        checkDirty();
        updateSaveButtonStatus(state.isDirty);
        if (!state.isDirty) return;

        const validation = validateEditorFields();
        if (!validation.valid) return;

        await saveItem();
    }, 300);
}

function startInlineTagEdit(tagEl, tagValue) {
    if (!tagEl || !elements.editorTags) return;
    const tagText = tagEl.querySelector('.editor-tag-text');
    if (!tagText) return;

    if (activeInlineTagText && activeInlineTagText !== tagText) {
        activeInlineTagText.blur();
    }

    tagText.dataset.original = tagValue || '';
    tagText.contentEditable = 'true';
    tagText.spellcheck = false;
    tagEl.classList.add('is-editing');
    activeInlineTagText = tagText;

    const range = document.createRange();
    range.selectNodeContents(tagText);
    const selection = window.getSelection();
    if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
    }
    tagText.focus();

    const commit = (cancelled = false) => {
        const original = tagText.dataset.original || tagValue || '';
        const rawValue = cancelled ? original : (tagText.textContent || '').trim();
        const current = normalizeTagsInput(elements.editorTags.value);
        const normalizedNew = normalizeTagsInput(rawValue).map(t => t.toLowerCase());
        const replaced = [];

        current.forEach(t => {
            if (t === original) {
                normalizedNew.forEach(n => {
                    if (!replaced.includes(n)) replaced.push(n);
                });
            } else if (!replaced.includes(t)) {
                replaced.push(t);
            }
        });

        elements.editorTags.value = replaced.join(' ');
        updateEditorTagsPreview();
        checkDirty();
        scheduleTagsAutosave();
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            tagText.blur();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            commit(true);
            tagText.blur();
        }
    };

    const handleBlur = () => {
        tagText.contentEditable = 'false';
        tagEl.classList.remove('is-editing');
        activeInlineTagText = null;
        commit(false);
        tagText.removeEventListener('keydown', handleKeydown);
        tagText.removeEventListener('blur', handleBlur);
    };

    tagText.addEventListener('keydown', handleKeydown);
    tagText.addEventListener('blur', handleBlur);
}

function updateEditorTagsPreview() {
    if (!elements.editorTagsInline || !elements.editorTags) return;
    const tags = normalizeTagsInput(elements.editorTags.value);
    elements.editorTags.value = tags.join(' ');
    elements.editorTagsInline.innerHTML = tags.map(tag => `
        <span class="editor-tag" data-tag="${escapeHtml(tag)}">
            <span class="editor-tag-text">${escapeHtml(tag.replace(/^#/, '#'))}</span>
            <button type="button" class="editor-tag-remove" data-tag="${escapeHtml(tag)}" aria-label="Remove tag">×</button>
        </span>
    `).join('');
}

function addTagsFromInput() {
    if (!elements.editorTagsInput || !elements.editorTags) return;
    const newTags = normalizeTagsInput(elements.editorTagsInput.value);
    if (!newTags.length) return;
    const current = normalizeTagsInput(elements.editorTags.value);
    const merged = [...current];
    newTags.forEach(tag => {
        if (!merged.includes(tag)) merged.push(tag);
    });
    elements.editorTags.value = merged.join(' ');
    updateEditorTagsPreview();
    scheduleTagsAutosave();
}

// Format relative time (e.g., "2 hours ago", "yesterday")
function formatRelativeTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function selectItem(id, forceType = null) {
    if (!id) return;

    // Find the item in our state
    // We cast both to string to be safe
    const automation = state.automations.find(i => String(i.id) === String(id));
    const script = state.scripts.find(i => String(i.id) === String(id));
    const item = automation || script;

    if (!item) {
        console.warn('[selectItem] Item NOT found in state:', id);
        return;
    }

    const type = forceType || (automation ? 'automation' : 'script');

    // Sync selected type and group if needed
    // IMPORTANT: If we are in a folder, we stay in folder view but still track the group internally
    const expectedGroup = type === 'automation' ? 'automations' : 'scripts';
    if (state.currentGroup !== expectedGroup) {
        state.currentGroup = expectedGroup;

        // Update sidebar buttons highlight ONLY if NOT in a folder
        if (!state.selectedFolder) {
            elements.groupItems.forEach(i => {
                const isActive = i.dataset.group === state.currentGroup;
                i.classList.toggle('active', isActive);
            });
        }
    }

    // Update state
    state.selectedItem = item;
    state.isNewItem = false;
    state.isDirty = false;

    // Highlighting - DO THIS IMMEDIATELY
    const cards = Array.from(elements.itemsList.querySelectorAll('.item-card'));
    let foundCard = false;
    cards.forEach(card => {
        const isActive = String(card.dataset.id) === String(id);
        if (isActive) {
            foundCard = true;
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    if (!foundCard) {
        console.warn('[selectItem] Warning: Card not found in DOM for ID:', id);
    }

    // Load editor content
    try {
        populateEditor(item);

        // Snapshot for dirty checking
        state.originalItemSnapshot = JSON.stringify(getEditorData());
        state.isDirty = false;

        showEditor();
        loadTracesForItem();

        // Load version history
        if (state.versionControl && state.versionControl.available) {
            loadVersionHistory(item.id, type);
        }
    } catch (err) {
        console.error('[selectItem] Error during editor population:', err);
    }
}

function moveListSelection(delta) {
    const cards = Array.from(elements.itemsList.querySelectorAll('.item-card'));
    if (!cards.length) return;

    const activeIndex = cards.findIndex(card => card.classList.contains('active'));
    let nextIndex = activeIndex + delta;

    if (activeIndex === -1) {
        nextIndex = delta > 0 ? 0 : cards.length - 1;
    }

    nextIndex = Math.max(0, Math.min(cards.length - 1, nextIndex));
    const nextCard = cards[nextIndex];
    if (!nextCard) return;

    selectItem(nextCard.dataset.id, nextCard.dataset.type);
    nextCard.scrollIntoView({ block: 'nearest' });
}

function populateEditor(item, expansionState = null) {
    const isAutomation = item._type === 'automation';

    try {
        clearActionSelection();
        // Basic fields
        if (elements.editorAlias) {
            elements.editorAlias.value = item.alias || '';
            autoResizeInput(elements.editorAlias);
        }
        const descText = item.description || '';
        const extractedTags = extractTagsFromText(descText);
        const variableTags = getVariableTags(item.variables);
        const mergedTags = Array.from(new Set([...extractedTags, ...variableTags]));
        if (elements.editorDescription) elements.editorDescription.value = stripTagsFromText(descText);
        if (elements.editorTags) elements.editorTags.value = mergedTags.join(' ');
        updateEditorTagsPreview();
        if (elements.editorEnabled) elements.editorEnabled.checked = item.enabled !== false;

        // Show/hide automation-specific sections
        const triggersInfo = document.getElementById('triggers-section');
        const conditionsInfo = document.getElementById('conditions-section');
        if (triggersInfo) triggersInfo.style.display = isAutomation ? 'block' : 'none';
        if (conditionsInfo) conditionsInfo.style.display = isAutomation ? 'block' : 'none';

        // Populate blocks safely
        if (isAutomation) {
            try { renderBlocks('triggers', normalizeArray(item.triggers), expansionState?.triggers); } catch (e) { console.error('Error rendering triggers:', e); }
            try { renderBlocks('conditions', normalizeArray(item.conditions), expansionState?.conditions); } catch (e) { console.error('Error rendering conditions:', e); }
            try { renderBlocks('actions', normalizeArray(item.actions), expansionState?.actions); } catch (e) { console.error('Error rendering actions:', e); }
        } else {
            try { renderBlocks('actions', normalizeArray(item.sequence), expansionState?.actions); } catch (e) { console.error('Error rendering sequence:', e); }
        }

        // Update YAML view safely
        updateYamlView(item).catch(e => console.error('Error generating YAML view:', e));

    } catch (err) {
        console.error('[populateEditor] CRITICAL ERROR:', err);
        // Even if population fails, try to show something
    }
}

// Helper to auto-resize input width based on content
function autoResizeInput(input) {
    if (!input) return;

    // Create a temporary span to measure text width
    // We need to match font properties exactly
    const styles = window.getComputedStyle(input);
    const span = document.createElement('span');
    span.style.font = styles.font;
    span.style.fontSize = styles.fontSize;
    span.style.fontWeight = styles.fontWeight;
    span.style.letterSpacing = styles.letterSpacing;
    span.style.visibility = 'hidden';
    span.style.position = 'absolute';
    span.style.whiteSpace = 'pre';

    // Set text (use placeholder if empty)
    span.textContent = input.value || input.placeholder || '';

    document.body.appendChild(span);
    const width = span.offsetWidth;
    document.body.removeChild(span);

    // Update input width (add a little buffer)
    input.style.width = Math.max(150, width + 10) + 'px';
}

function getExpansionState() {
    const getState = (section) => {
        const container = document.getElementById(`${section}-container`);
        if (!container) return [];
        const states = Array.from(container.querySelectorAll('.action-block')).map(el => !el.classList.contains('collapsed'));
        // console.log(`[Expansion] Captured ${section}:`, states);
        return states;
    };

    return {
        triggers: getState('triggers'),
        conditions: getState('conditions'),
        actions: getState('actions')
    };
}

function normalizeArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return [val];
}

function updateRunSelectedButton() {
    if (!elements.btnRunSelected) return;
    const count = state.selectedActionIndices.size;
    elements.btnRunSelected.classList.toggle('is-visible', count > 0);
    elements.btnRunSelected.title = count > 0 ? `Run ${count} selected action${count > 1 ? 's' : ''}` : 'Run selected actions';
}

function applyActionSelectionStyles(container) {
    if (!container) return;
    const blocks = Array.from(container.children).filter(el => el.classList.contains('action-block'));
    blocks.forEach(el => {
        el.classList.remove('is-selected', 'is-range-first', 'is-range-middle', 'is-range-last');
    });

    const indices = Array.from(state.selectedActionIndices).sort((a, b) => a - b);
    if (indices.length === 0) return;

    // Build contiguous ranges
    let rangeStart = indices[0];
    let prev = indices[0];
    const ranges = [];
    for (let i = 1; i < indices.length; i++) {
        const idx = indices[i];
        if (idx === prev + 1) {
            prev = idx;
            continue;
        }
        ranges.push([rangeStart, prev]);
        rangeStart = idx;
        prev = idx;
    }
    ranges.push([rangeStart, prev]);

    ranges.forEach(([start, end]) => {
        for (let i = start; i <= end; i++) {
            const el = blocks[i];
            if (!el) continue;
            el.classList.add('is-selected');
            if (start === end) {
                el.classList.add('is-range-first', 'is-range-last');
            } else if (i === start) {
                el.classList.add('is-range-first');
            } else if (i === end) {
                el.classList.add('is-range-last');
            } else {
                el.classList.add('is-range-middle');
            }
        }
    });
}

function clearActionSelection() {
    state.selectedActionIndices.clear();
    state.actionSelectionAnchor = null;
    document.querySelectorAll('#actions-container .action-block.is-selected').forEach(el => {
        el.classList.remove('is-selected');
    });
    updateRunSelectedButton();
}

function setActionSelectionRange(start, end) {
    state.selectedActionIndices.clear();
    const [s, e] = start <= end ? [start, end] : [end, start];
    for (let i = s; i <= e; i++) state.selectedActionIndices.add(i);
    updateRunSelectedButton();
}

function toggleActionSelection(index) {
    if (state.selectedActionIndices.has(index)) {
        state.selectedActionIndices.delete(index);
    } else {
        state.selectedActionIndices.add(index);
    }
    updateRunSelectedButton();
}

function renderBlocks(section, blocks, expandedStates = null) {
    const container = document.getElementById(`${section}-container`);
    if (!container) return;

    if (blocks.length === 0) {
        container.innerHTML = `<div class="blocks-empty">No ${section} configured. Click + to add one.</div>`;
        return;
    }

    if (section === 'actions' && state.selectedActionIndices.size > 0) {
        state.selectedActionIndices = new Set(
            Array.from(state.selectedActionIndices).filter(i => i >= 0 && i < blocks.length)
        );
    }

    const blockType = section === 'triggers' ? 'trigger' :
        section === 'conditions' ? 'condition' : 'action';

    const htmlParts = blocks.map((block, index) => {
        try {
            return createBlockHtml(block, blockType, index);
        } catch (err) {
            console.error(`[renderBlocks] Error rendering block ${index} in ${section}:`, err, block);
            return `<div class="block-error">Error rendering block ${index}: ${err.message}</div>`;
        }
    });

    container.innerHTML = htmlParts.join('');

    // Add event listeners and apply collapse setting
    Array.from(container.children).filter(el => el.classList.contains('action-block')).forEach((blockEl, index) => {
        const header = blockEl.querySelector('.block-header');
        const deleteBtn = blockEl.querySelector('.block-action-btn.delete');
        const copyBtn = blockEl.querySelector('.block-action-btn.copy');
        const aliasText = blockEl.querySelector('.block-alias-text');
        const aliasInput = blockEl.querySelector('.block-title-input');

        // Initial Tag Render
        if (aliasText) {
            renderBlockTags(blockEl, aliasText.textContent);
        }

        // Apply collapse setting or restore state
        let shouldCollapse = state.settings.collapseBlocksByDefault;
        if (expandedStates && index < expandedStates.length) {
            shouldCollapse = !expandedStates[index];
        }
        if (shouldCollapse) {
            blockEl.classList.add('collapsed');
        }

        // Toggle Collapse on header click
        header.addEventListener('click', (e) => {
            if (blockEl.classList.contains('dragging-active')) return;
            if (e.shiftKey && section === 'actions') {
                e.preventDefault();
                e.stopPropagation();
                if (state.actionSelectionAnchor === null) {
                    state.actionSelectionAnchor = index;
                }
                setActionSelectionRange(state.actionSelectionAnchor, index);
                applyActionSelectionStyles(container);
                return;
            }
            if (section === 'actions' && state.selectedActionIndices.size > 0) {
                clearActionSelection();
            }
            if (e.target.closest('.block-action-btn') || e.target.closest('.block-menu-trigger') || e.target.closest('.block-title-input')) return;
            blockEl.classList.toggle('collapsed');
        });

        if (section === 'actions') {
            blockEl.addEventListener('click', (e) => {
                if (!e.shiftKey) return;
                if (e.target.closest('input, textarea, select, button, .block-menu-trigger, .block-action-btn')) return;
                e.preventDefault();
                e.stopPropagation();
                if (state.actionSelectionAnchor === null) {
                    state.actionSelectionAnchor = index;
                }
                setActionSelectionRange(state.actionSelectionAnchor, index);
                applyActionSelectionStyles(container);
            });
        }

        // Inline Alias Editing
        if (aliasText && aliasInput) {
            aliasText.addEventListener('click', (e) => {
                e.stopPropagation();
                aliasText.style.display = 'none';
                aliasInput.style.display = 'block';
                aliasInput.focus();
            });

            aliasInput.addEventListener('blur', () => {
                const newValue = aliasInput.value.trim();
                const defaultTitle = aliasInput.getAttribute('placeholder');
                aliasText.textContent = newValue || defaultTitle;
                if (!newValue) aliasText.classList.add('is-placeholder');
                else aliasText.classList.remove('is-placeholder');
                aliasInput.style.display = 'none';
                aliasText.style.display = 'block';

                // Update tags
                renderBlockTags(blockEl, aliasText.textContent);

                checkDirty();
                updateYamlView();
            });

            aliasInput.addEventListener('input', () => {
                checkDirty();
                updateYamlView();
            });

            aliasInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') aliasInput.blur();
                if (e.key === 'Escape') aliasInput.blur();
            });

            aliasInput.addEventListener('click', (e) => e.stopPropagation());
        }

        const duplicateBtn = blockEl.querySelector('.block-action-btn.duplicate');

        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(blockEl.dataset.index);
            const sectionBlocks = getBlocksData(section);
            state.clipboard = JSON.parse(JSON.stringify(sectionBlocks[idx]));
            showToast('Block copied to clipboard', 'success');
            updatePasteButtonsVisibility();
        });

        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pushToHistory();
                const index = parseInt(blockEl.dataset.index);
                const sectionBlocks = getBlocksData(section);
                const clone = JSON.parse(JSON.stringify(sectionBlocks[index]));
                sectionBlocks.splice(index + 1, 0, clone);
                updateSectionBlocks(section, sectionBlocks);
                checkDirty();
                updateYamlView();
                renderBlocks(section, sectionBlocks);
            });
        }

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pushToHistory();
            const idx = parseInt(blockEl.dataset.index);
            const sectionBlocks = getBlocksData(section);
            sectionBlocks.splice(idx, 1);
            updateSectionBlocks(section, sectionBlocks);
            checkDirty();
            updateYamlView();
            renderBlocks(section, sectionBlocks);
        });

        // Initialize drag and drop
        initBlockDragAndDrop(blockEl, section, header);

        // Initialize Context Menu
        initBlockContextMenu(blockEl);
    });

    if (section === 'actions') {
        applyActionSelectionStyles(container);
        updateRunSelectedButton();
    }

    // Initialize history tracking for block inputs
    container.querySelectorAll('input, textarea, select').forEach(input => {
        if (input.classList.contains('block-title-input')) return;

        input.addEventListener('input', () => {
            checkDirty();
            updateYamlView();
            const blockEl = input.closest('.action-block');
            if (blockEl) refreshBlockTitle(blockEl);
        });
    });

    // Initialize nested blocks (if any)
    container.querySelectorAll('.action-block .nested-block-wrapper .action-block').forEach(nestedBlock => {
        initializeBlockComponents(nestedBlock);
    });

    container.querySelectorAll('.action-block').forEach(blockEl => {
        applyFieldValidation(blockEl);
    });
}

function initializeBlockComponents(blockEl) {
    if (!blockEl || blockEl.dataset.initialized === 'true') return;
    blockEl.dataset.initialized = 'true';

    const header = blockEl.querySelector('.block-header');
    const deleteBtn = blockEl.querySelector('.block-action-btn.delete');
    const copyBtn = blockEl.querySelector('.block-action-btn.copy');
    const aliasText = blockEl.querySelector('.block-alias-text');
    const aliasInput = blockEl.querySelector('.block-title-input');

    if (aliasText) {
        renderBlockTags(blockEl, aliasText.textContent);
    }

    if (header) {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.block-action-btn') || e.target.closest('.block-menu-trigger') || e.target.closest('.block-title-input')) return;
            blockEl.classList.toggle('collapsed');
        });
    }

    if (aliasText && aliasInput) {
        aliasText.addEventListener('click', (e) => {
            e.stopPropagation();
            aliasText.style.display = 'none';
            aliasInput.style.display = 'block';
            aliasInput.focus();
        });

        aliasInput.addEventListener('blur', () => {
            const newValue = aliasInput.value.trim();
            const defaultTitle = aliasInput.getAttribute('placeholder');
            aliasText.textContent = newValue || defaultTitle;
            if (!newValue) aliasText.classList.add('is-placeholder');
            else aliasText.classList.remove('is-placeholder');
            aliasInput.style.display = 'none';
            aliasText.style.display = 'block';

            renderBlockTags(blockEl, aliasText.textContent);
            checkDirty();
            updateYamlView();
        });

        aliasInput.addEventListener('input', () => {
            checkDirty();
            updateYamlView();
        });

        aliasInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') aliasInput.blur();
        });

        // Initialize auto-resize for title input
        autoResizeInput(aliasInput);

        aliasInput.addEventListener('click', (e) => e.stopPropagation());
    }

    const duplicateBtn = blockEl.querySelector('.block-action-btn.duplicate');

    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const data = parseBlockElement(blockEl);
            state.clipboard = JSON.parse(JSON.stringify(data));
            showToast('Block copied to clipboard', 'success');
            updatePasteButtonsVisibility();
        });
    }

    if (duplicateBtn) {
        duplicateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pushToHistory();
            const wrapper = blockEl.closest('.nested-block-wrapper');
            const parentContainer = wrapper.parentElement;
            const parentPath = wrapper.dataset.parentPath;
            const type = blockEl.classList.contains('trigger') ? 'trigger' : (blockEl.classList.contains('condition') ? 'condition' : 'action');

            const blockData = parseBlockElement(blockEl);
            const clone = JSON.parse(JSON.stringify(blockData));

            const newIndex = parseInt(wrapper.dataset.index) + 1;
            const html = renderNestedBlockInline(clone, newIndex, parentPath, type);
            wrapper.insertAdjacentHTML('afterend', html);

            const nextWrapper = wrapper.nextElementSibling;
            const nextBlockEl = nextWrapper.querySelector('.action-block');
            if (nextBlockEl) {
                initializeBlockComponents(nextBlockEl);
            }

            updateNestedWrapperIndices(parentContainer);
            syncNestedEmpty(parentContainer);
            checkDirty();
            updateYamlView();
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrapper = blockEl.closest('.nested-block-wrapper');
            if (wrapper) {
                const container = wrapper.parentElement;
                wrapper.remove();
                updateNestedWrapperIndices(container);
                syncNestedEmpty(container);
            } else {
                blockEl.remove();
            }
            checkDirty();
            updateYamlView();
        });
    }

    blockEl.querySelectorAll('input, textarea, select').forEach(input => {
        if (input.classList.contains('block-title-input')) return;
        input.addEventListener('input', () => {
            checkDirty();
            updateYamlView();
            applyFieldValidation(blockEl);
            refreshBlockTitle(blockEl);
        });
        input.addEventListener('change', () => {
            checkDirty();
            updateYamlView();
            applyFieldValidation(blockEl);
            refreshBlockTitle(blockEl);
        });
    });

    const repeatMode = blockEl.querySelector('[data-role="repeat-mode"]');
    if (repeatMode) {
        repeatMode.addEventListener('change', () => {
            updateRepeatVisibility(blockEl);
            checkDirty();
            updateYamlView();
            applyFieldValidation(blockEl);
        });
        updateRepeatVisibility(blockEl);
    }

    applyFieldValidation(blockEl);

    blockEl.addEventListener('picker-change', (e) => {
        // picker-change bubbles from entity/service/target pickers
        checkDirty();
        updateYamlView();
        applyFieldValidation(blockEl);
        refreshBlockTitle(blockEl);
    });

    const nestedWrapper = blockEl.closest('.nested-block-wrapper');
    if (nestedWrapper && header) {
        initNestedDragAndDrop(blockEl, header);
    }
}

function initBlockDragAndDrop(blockEl, section, header) {
    header.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.block-action-btn') || e.target.closest('.block-menu-trigger') || e.target.closest('.block-title-input')) return;

        e.preventDefault();
        e.stopPropagation();

        const container = document.getElementById(`${section}-container`);
        const startX = e.clientX;
        const startY = e.clientY;
        let isDragging = false;
        let placeholder = null;
        let currentBlocks = null;
        let rect = null;
        let lastScrollY = window.scrollY;

        let lastClientY = 0;
        const onMouseMove = (moveEvent) => {
            const clientY = moveEvent ? moveEvent.clientY : lastClientY;
            const clientX = moveEvent ? moveEvent.clientX : startX;
            if (moveEvent) lastClientY = moveEvent.clientY;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            if (!isDragging) {
                if (Math.hypot(deltaX, deltaY) > 3) {
                    startDrag();
                } else return;
            }

            if (isDragging) {
                blockEl.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

                // Fix: Only look at direct children to avoid picking up nested actions
                const siblings = Array.from(container.children).filter(el =>
                    el.classList.contains('action-block') && !el.classList.contains('dragging-active')
                );

                const nextSibling = siblings.find(sibling => {
                    const box = sibling.getBoundingClientRect();
                    return clientY < (box.top + box.height / 2);
                });

                if (nextSibling) {
                    if (nextSibling.previousElementSibling !== placeholder) container.insertBefore(placeholder, nextSibling);
                } else {
                    // Check if it's already at the end
                    if (placeholder.nextElementSibling !== null || container.lastElementChild !== placeholder) {
                        container.appendChild(placeholder);
                    }
                }
            }
        };

        const startDrag = () => {
            pushToHistory();
            isDragging = true;
            currentBlocks = getBlocksData(section);
            rect = blockEl.getBoundingClientRect();
            placeholder = document.createElement('div');
            placeholder.className = 'action-block-placeholder';
            placeholder.style.height = `${rect.height}px`;
            blockEl.parentNode.insertBefore(placeholder, blockEl);
            blockEl.style.width = `${rect.width}px`;
            blockEl.style.height = `${rect.height}px`;
            blockEl.style.position = 'fixed';
            blockEl.style.left = `${rect.left}px`;
            blockEl.style.top = `${rect.top}px`;
            blockEl.style.zIndex = '1000';
            blockEl.classList.add('dragging-active');
            document.body.classList.add('dragging-active-global');
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // Stop scroll tracking
            document.removeEventListener('scroll', updateScrollDelta);

            if (isDragging) {
                blockEl.classList.remove('dragging-active');
                document.body.classList.remove('dragging-active-global');
                blockEl.style.cssText = '';
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.insertBefore(blockEl, placeholder);
                    placeholder.remove();
                }

                // Fix: Only look at direct children for reordering
                const directBlocks = Array.from(container.children)
                    .filter(el => el.classList.contains('action-block'));
                const newOrderIndices = directBlocks.map(el => parseInt(el.dataset.index));

                const reorderedData = newOrderIndices.map(index => currentBlocks[index]).filter(Boolean);
                if (reorderedData.length === currentBlocks.length) {
                    if (section === 'actions') {
                        state.selectedActionIndices = new Set(
                            directBlocks
                                .map((el, idx) => (el.classList.contains('is-selected') ? idx : null))
                                .filter(v => v !== null)
                        );
                        state.actionSelectionAnchor = null;
                    }
                    updateSectionBlocks(section, reorderedData);
                    checkDirty();
                    renderBlocks(section, reorderedData);
                    updateYamlView();
                } else renderBlocks(section, currentBlocks);
            }
        };

        const updateScrollDelta = () => {
            if (isDragging) {
                onMouseMove(); // Re-calculate placeholder position on scroll
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        window.addEventListener('scroll', updateScrollDelta, true);
    });
}

function initNestedDragAndDrop(blockEl, header) {
    header.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.block-action-btn') || e.target.closest('.block-menu-trigger') || e.target.closest('.block-title-input')) return;

        const wrapper = blockEl.closest('.nested-block-wrapper');
        if (!wrapper) return;
        const container = wrapper.parentElement;
        if (!container) return;

        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        let isDragging = false;
        let placeholder = null;
        let rect = null;
        let lastScrollY = window.scrollY;

        let lastClientY = 0;
        const onMouseMove = (moveEvent) => {
            const clientY = moveEvent ? moveEvent.clientY : lastClientY;
            const clientX = moveEvent ? moveEvent.clientX : startX;
            if (moveEvent) lastClientY = moveEvent.clientY;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            if (!isDragging) {
                if (Math.hypot(deltaX, deltaY) > 3) {
                    startDrag();
                } else return;
            }

            if (isDragging) {
                wrapper.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

                // Fix: Only look at direct children
                const siblings = Array.from(container.children).filter(el =>
                    el.classList.contains('nested-block-wrapper') && !el.classList.contains('dragging-active')
                );

                const nextSibling = siblings.find(sibling => {
                    const box = sibling.getBoundingClientRect();
                    return clientY < (box.top + box.height / 2);
                });

                if (nextSibling) {
                    if (nextSibling.previousElementSibling !== placeholder) container.insertBefore(placeholder, nextSibling);
                } else {
                    if (placeholder.nextElementSibling !== null || container.lastElementChild !== placeholder) {
                        container.appendChild(placeholder);
                    }
                }
            }
        };

        const startDrag = () => {
            isDragging = true;
            rect = wrapper.getBoundingClientRect();
            placeholder = document.createElement('div');
            placeholder.className = 'action-block-placeholder';
            placeholder.style.height = `${rect.height}px`;
            wrapper.parentNode.insertBefore(placeholder, wrapper);
            wrapper.style.width = `${rect.width}px`;
            wrapper.style.height = `${rect.height}px`;
            wrapper.style.position = 'fixed';
            wrapper.style.left = `${rect.left}px`;
            wrapper.style.top = `${rect.top}px`;
            wrapper.style.zIndex = '1000';
            wrapper.classList.add('dragging-active');
            document.body.classList.add('dragging-active-global');
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('scroll', updateScrollDelta, true);

            if (isDragging) {
                wrapper.classList.remove('dragging-active');
                document.body.classList.remove('dragging-active-global');
                wrapper.style.cssText = '';
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.insertBefore(wrapper, placeholder);
                    placeholder.remove();
                }
                updateNestedWrapperIndices(container);
                checkDirty();
                updateYamlView();
            }
        };

        const updateScrollDelta = () => {
            if (isDragging) {
                onMouseMove();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        window.addEventListener('scroll', updateScrollDelta, true);
    });
}
function initBlockContextMenu(blockEl) {
    const menuTrigger = blockEl.querySelector('.block-menu-trigger');

    const openMenu = (e, isRightClick = false) => {
        e.preventDefault();
        e.stopPropagation();

        // Close any other open menus
        document.querySelectorAll('.block-context-menu').forEach(m => m.remove());

        // Create menu
        const isItemEnabled = !blockEl.classList.contains('is-disabled');
        const menu = document.createElement('div');
        menu.className = 'block-context-menu show';
        menu.innerHTML = `
            <div class="block-menu-item toggle-enabled">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${isItemEnabled ? '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>' : '<polyline points="20 6 9 17 4 12"/>'}
                </svg>
                <span>${isItemEnabled ? 'Disable' : 'Enable'}</span>
            </div>
            <div class="block-menu-item duplicate-block">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Duplicate</span>
            </div>
            <div class="block-menu-item show-yaml">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                </svg>
                <span>Show YAML</span>
            </div>
            <div class="block-menu-item run-block">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Run</span>
            </div>
            <div class="block-menu-item danger delete-block">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                <span>Delete</span>
            </div>
        `;

        document.body.appendChild(menu);

        if (isRightClick) {
            // Position at cursor
            menu.style.top = `${e.clientY}px`;
            menu.style.left = `${e.clientX}px`;

            // Adjust if near edge
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth - 10) {
                menu.style.left = `${window.innerWidth - rect.width - 10}px`;
            }
            if (rect.bottom > window.innerHeight - 10) {
                menu.style.top = `${window.innerHeight - rect.height - 10}px`;
            }
        } else if (menuTrigger) {
            // Position relative to trigger
            const rect = menuTrigger.getBoundingClientRect();
            menu.style.top = `${rect.bottom + 5}px`;
            menu.style.left = `${rect.right - 140}px`;
        }

        // Action Handlers
        menu.querySelector('.toggle-enabled').addEventListener('click', (me) => {
            me.stopPropagation();
            blockEl.classList.toggle('is-disabled');
            checkDirty();
            menu.remove();
            updateYamlView();
        });

        menu.querySelector('.duplicate-block').addEventListener('click', (me) => {
            me.stopPropagation();
            menu.remove();

            const container = blockEl.parentElement;
            const nestedWrapper = blockEl.closest('.nested-block-wrapper');
            const sectionId = nestedWrapper ? null : container.id.replace('-container', '');
            const sectionName = sectionId === 'triggers' ? 'triggers' : (sectionId === 'conditions' ? 'conditions' : 'actions');

            pushToHistory();

            if (nestedWrapper) {
                // Duplicate nested block
                const parentContainer = nestedWrapper.parentElement;
                const parentPath = nestedWrapper.dataset.parentPath;
                const type = blockEl.classList.contains('trigger') ? 'trigger' : (blockEl.classList.contains('condition') ? 'condition' : 'action');

                // Parse and copy data
                const blockData = parseBlockElement(blockEl);
                const clone = JSON.parse(JSON.stringify(blockData));

                // Render and insert
                const newIndex = parseInt(nestedWrapper.dataset.index) + 1;
                const html = renderNestedBlockInline(clone, newIndex, parentPath, type);
                nestedWrapper.insertAdjacentHTML('afterend', html);

                // Initialize
                const nextWrapper = nestedWrapper.nextElementSibling;
                const nextBlockEl = nextWrapper.querySelector('.action-block');
                if (nextBlockEl) {
                    initializeBlockComponents(nextBlockEl);
                }

                updateNestedWrapperIndices(parentContainer);
                syncNestedEmpty(parentContainer);
            } else {
                // Duplicate top-level block
                const index = Array.from(container.children).indexOf(blockEl);
                const sectionBlocks = getBlocksData(sectionName);
                const clone = JSON.parse(JSON.stringify(sectionBlocks[index]));

                sectionBlocks.splice(index + 1, 0, clone);
                updateSectionBlocks(sectionName, sectionBlocks);
                renderBlocks(sectionName, sectionBlocks);
            }

            checkDirty();
            updateYamlView();
        });

        menu.querySelector('.show-yaml').addEventListener('click', (me) => {
            me.stopPropagation();
            const container = blockEl.parentElement;
            const index = Array.from(container.children).indexOf(blockEl);
            const sectionId = container.id.replace('-container', '');
            let sectionName = sectionId === 'triggers' ? 'triggers' : (sectionId === 'conditions' ? 'conditions' : 'actions');

            let blockData = null;
            if (state.selectedItem) {
                if (sectionName === 'triggers') blockData = state.selectedItem.triggers[index];
                else if (sectionName === 'conditions') blockData = state.selectedItem.conditions[index];
                else {
                    const actionsList = state.currentGroup === 'automations' ? state.selectedItem.actions : state.selectedItem.sequence;
                    blockData = actionsList[index];
                }
            }

            if (blockData) {
                openBlockYamlModal(blockData, (newYaml) => {
                    try {
                        updateBlockFromYaml(index, sectionName, newYaml);
                    } catch (e) {
                        showToast('Error updating block', 'error');
                    }
                });
            }
            menu.remove();
        });

        menu.querySelector('.run-block').addEventListener('click', (me) => {
            me.stopPropagation();
            const container = blockEl.parentElement;
            const directBlocks = Array.from(container.children).filter(el => el.classList.contains('action-block'));
            const index = directBlocks.indexOf(blockEl);

            if (container.id === 'actions-container') {
                if (state.selectedActionIndices.size > 0 && state.selectedActionIndices.has(index)) {
                    runActionIndices(Array.from(state.selectedActionIndices));
                } else {
                    runActionIndices([index]);
                }
            } else {
                showToast('Run is only available for Action blocks', 'warning');
            }
            menu.remove();
        });

        menu.querySelector('.delete-block').addEventListener('click', (me) => {
            me.stopPropagation();
            menu.remove();

            const container = blockEl.parentElement;
            const nestedWrapper = blockEl.closest('.nested-block-wrapper');
            const sectionId = nestedWrapper ? null : container.id.replace('-container', '');
            const sectionName = sectionId === 'triggers' ? 'triggers' : (sectionId === 'conditions' ? 'conditions' : 'actions');

            pushToHistory();

            if (nestedWrapper) {
                const parentContainer = nestedWrapper.parentElement;
                nestedWrapper.remove();
                updateNestedWrapperIndices(parentContainer);
                syncNestedEmpty(parentContainer);
            } else {
                const index = Array.from(container.children).indexOf(blockEl);
                const sectionBlocks = getBlocksData(sectionName);
                sectionBlocks.splice(index, 1);
                updateSectionBlocks(sectionName, sectionBlocks);
                renderBlocks(sectionName, sectionBlocks);
            }

            checkDirty();
            updateYamlView();
        });

        const closeMenu = (clickEvent) => {
            if (!menu.contains(clickEvent.target) && (!menuTrigger || clickEvent.target !== menuTrigger)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    };

    if (menuTrigger) {
        menuTrigger.addEventListener('click', (e) => openMenu(e, false));
    }
    blockEl.addEventListener('contextmenu', (e) => openMenu(e, true));
}

function findItemById(id, typeHint = null) {
    if (typeHint === 'automation') {
        return state.automations.find(i => String(i.id) === String(id)) || null;
    }
    if (typeHint === 'script') {
        return state.scripts.find(i => String(i.id) === String(id)) || null;
    }
    return state.automations.find(i => String(i.id) === String(id))
        || state.scripts.find(i => String(i.id) === String(id))
        || null;
}

function openItemContextMenu(card, event) {
    const itemId = card.dataset.id;
    const itemType = card.dataset.type;
    const item = findItemById(itemId, itemType);
    if (!item) return;
    if (!item._type) item._type = itemType;

    // Sync selection so actions behave consistently
    selectItem(itemId, itemType);

    // Close any other open menus
    document.querySelectorAll('.block-context-menu').forEach(m => m.remove());

    const isAutomation = item._type === 'automation';
    const isEnabled = item.enabled !== false;
    const menu = document.createElement('div');
    menu.className = 'block-context-menu item-context-menu show';
    menu.innerHTML = `
        <div class="block-menu-item toggle-enabled ${isAutomation ? '' : 'is-disabled'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${isEnabled ? '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>' : '<polyline points="20 6 9 17 4 12"/>'}
            </svg>
            <span>${isEnabled ? 'Disable' : 'Enable'}</span>
        </div>
        <div class="block-menu-item run-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>Run</span>
        </div>
        <div class="block-menu-item duplicate-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>Duplicate</span>
        </div>
        <div class="block-menu-item danger delete-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            <span>Delete</span>
        </div>
    `;

    document.body.appendChild(menu);
    menu.style.top = `${event.clientY}px`;
    menu.style.left = `${event.clientX}px`;

    const rect = menu.getBoundingClientRect();
    const padding = 8;
    if (rect.right > window.innerWidth - padding) {
        menu.style.left = `${Math.max(padding, window.innerWidth - rect.width - padding)}px`;
    }
    if (rect.bottom > window.innerHeight - padding) {
        menu.style.top = `${Math.max(padding, window.innerHeight - rect.height - padding)}px`;
    }

    const toggleBtn = menu.querySelector('.toggle-enabled');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (me) => {
            me.stopPropagation();
            toggleItemEnabled(item, !isEnabled);
            menu.remove();
        });
    }

    menu.querySelector('.run-item').addEventListener('click', (me) => {
        me.stopPropagation();
        runSelectedItem();
        menu.remove();
    });

    menu.querySelector('.duplicate-item').addEventListener('click', (me) => {
        me.stopPropagation();
        duplicateItem();
        menu.remove();
    });

    menu.querySelector('.delete-item').addEventListener('click', (me) => {
        me.stopPropagation();
        deleteItem();
        menu.remove();
    });

    const closeMenu = (clickEvent) => {
        if (!menu.contains(clickEvent.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}


function updateSectionBlocks(section, newBlocks) {
    if (!state.selectedItem) return;

    if (section === 'triggers') state.selectedItem.triggers = newBlocks;
    else if (section === 'conditions') state.selectedItem.conditions = newBlocks;
    else if (section === 'actions') {
        if (state.currentGroup === 'automations') state.selectedItem.actions = newBlocks;
        else state.selectedItem.sequence = newBlocks;
    }
}

function handlePasteBlock(section) {
    if (!state.clipboard) {
        showToast('Clipboard is empty', 'warning');
        return;
    }

    pushToHistory(); // Save state before pasting

    const sectionBlocks = getBlocksData(section);
    sectionBlocks.push(JSON.parse(JSON.stringify(state.clipboard)));

    updateSectionBlocks(section, sectionBlocks);
    renderBlocks(section, sectionBlocks); // Render first so DOM is updated
    updateYamlView();
    checkDirty(); // Check dirty after DOM is updated

    // Ensure dirty state is set since we added a block
    state.isDirty = true;

    showToast('Block pasted', 'success');
}

function updatePasteButtonsVisibility() {
    const hasClipboard = !!state.clipboard;
    document.querySelectorAll('.btn-paste-item').forEach(btn => {
        btn.style.display = hasClipboard ? 'flex' : 'none';
    });
}

function createBlockHtml(block, type, index, options = {}) {
    const blockClass = type;
    const blockNoAlias = { ...block, alias: undefined };
    const defaultTitle = getBlockTitle(blockNoAlias, type);
    const typeBadge = getBlockTypeBadge(block);
    const fields = getBlockFields(block, type);

    const isEnabled = block.enabled !== false;
    const shouldCollapse = options.forceCollapsed === true;

    const blockTypeKey = getBlockTypeKey(block, type);

    return `
    <div class="action-block ${blockClass} ${!isEnabled ? 'is-disabled' : ''} ${shouldCollapse ? 'collapsed' : ''}" data-index="${index}" data-block-type="${escapeHtml(blockTypeKey)}">
      <div class="block-header">
        <svg class="block-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 6 15 12 9 18"/>
        </svg>

        <div class="block-icon">
          ${getBlockIcon(block, type)}
        </div>
        
        <div class="block-title-wrapper">
          <span class="block-alias-text ${!block.alias ? 'is-placeholder' : ''}">${escapeHtml(block.alias || defaultTitle)}</span>
          <input type="text" name="block-alias" class="block-title-input" value="${escapeHtml(block.alias || '')}" placeholder="${escapeHtml(defaultTitle)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other" style="display: none;">
        </div>
        
        <div class="block-tags"></div>
        
        <div class="block-actions">
          <button class="block-action-btn copy" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="block-action-btn duplicate" title="Duplicate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button class="block-action-btn delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>

        <span class="block-type-badge">${typeBadge}</span>

        <div class="block-menu-trigger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="1"/>
            <circle cx="12" cy="5" r="1"/>
            <circle cx="12" cy="19" r="1"/>
          </svg>
        </div>
      </div>
      <div class="block-body">
        ${fields}
      </div>
    </div>
  `;
}

// ============================================
// Nested Block Rendering (If/Then/Else, Choose, Repeat)
// ============================================

/**
 * Renders an If/Then/Else block with fully editable nested blocks
 */
function renderNestedIfThenBlock(block) {
    const conditions = Array.isArray(block.if) ? block.if : [block.if];
    const thenActions = Array.isArray(block.then) ? block.then : [block.then];
    const elseActions = block.else ? (Array.isArray(block.else) ? block.else : [block.else]) : null;
    const hasIf = conditions.length > 0;
    const hasThen = thenActions.length > 0;
    const hasElse = elseActions ? elseActions.length > 0 : false;

    let html = '<div class="nested-block-container">';

    // Alias field (if exists)
    if (block.alias) {
        html += createFieldHtml('Alias', 'alias', block.alias);
    }

    // IF SECTION
    html += `
        <div class="nested-section if-section" data-section-type="if">
            <div class="section-header">
                <button type="button" class="section-toggle" onclick="toggleNestedSection(this)">
                    <svg viewBox="0 0 24 24" width="12" height="12">
                        <path fill="currentColor" d="M7 10l5 5 5-5z"/>
                    </svg>
                </button>
                <span class="section-label">If:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-path="if" data-role="if" data-empty-text="No conditions yet.">
                    ${conditions.map((cond, idx) =>
        renderNestedBlockInline(cond, idx, 'if', 'condition')
    ).join('')}
                </div>
                ${hasIf ? '' : '<div class="nested-empty">No conditions yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'condition')">
                    + Add condition
                </button>
            </div>
        </div>
    `;

    // THEN SECTION
    html += `
        <div class="nested-section then-section" data-section-type="then">
            <div class="section-header">
                <span class="section-label">Then:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-path="then" data-role="then" data-empty-text="No actions yet.">
                    ${thenActions.map((action, idx) =>
        renderNestedBlockInline(action, idx, 'then', 'action')
    ).join('')}
                </div>
                ${hasThen ? '' : '<div class="nested-empty">No actions yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                    + Add action
                </button>
            </div>
        </div>
    `;

    // ELSE SECTION (optional)
    if (elseActions) {
        html += `
            <div class="nested-section else-section" data-section-type="else">
                <div class="section-header">
                    <span class="section-label">Else:</span>
                </div>
                <div class="section-content">
                    <div class="nested-blocks" data-path="else" data-role="else" data-empty-text="No actions yet.">
                        ${elseActions.map((action, idx) =>
            renderNestedBlockInline(action, idx, 'else', 'action')
        ).join('')}
                    </div>
                    ${hasElse ? '' : '<div class="nested-empty">No actions yet.</div>'}
                    <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                        + Add action
                    </button>
                </div>
            </div>
        `;
    } else {
        html += `
            <button type="button" class="add-else-button" onclick="addElseSection(this)">
                + Add else
            </button>
        `;
    }

    html += '</div>';
    return html;
}

/**
 * Render AND/OR/NOT condition groups with editable nested conditions
 */
function renderConditionGroupBlock(block) {
    const conditions = Array.isArray(block.conditions) ? block.conditions : (block.conditions ? [block.conditions] : []);
    const hasConditions = conditions.length > 0;

    let html = '<div class="nested-block-container">';

    if (block.alias) {
        html += createFieldHtml('Alias', 'alias', block.alias);
    }

    html += `
        <div class="nested-section condition-group" data-section-type="conditions">
            <div class="section-header">
                <span class="section-label">Conditions:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-role="conditions" data-empty-text="No conditions yet.">
                    ${conditions.map((cond, idx) =>
        renderNestedBlockInline(cond, idx, 'conditions', 'condition')
    ).join('')}
                </div>
                ${hasConditions ? '' : '<div class="nested-empty">No conditions yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'condition')">
                    + Add condition
                </button>
            </div>
        </div>
    `;

    html += '</div>';
    return html;
}

/**
 * Render choose block with editable options and default
 */
function renderChooseBlock(block) {
    const options = Array.isArray(block.choose) ? block.choose : (block.choose ? [block.choose] : []);
    const hasDefault = !!block.default;
    const defaultActions = Array.isArray(block.default) ? block.default : (block.default ? [block.default] : []);
    const hasDefaultActions = defaultActions.length > 0;
    const hasOptions = options.length > 0;

    let html = '<div class="nested-block-container choose-block-layout">';

    if (block.alias) {
        html += createFieldHtml('Alias', 'alias', block.alias);
    }

    html += `
        <div class="choose-options" data-choose-options="true">
            ${options.map((opt, idx) => renderChooseOption(opt, idx)).join('')}
        </div>
        ${hasOptions ? '' : '<div class="nested-empty">No options yet.</div>'}
        <button type="button" class="add-nested-button" onclick="addChooseOption(this)">
            + Add option
        </button>
    `;

    if (hasDefault) {
        html += `
            <div class="nested-section default-section" data-section-type="default">
                <div class="section-header">
                    <span class="section-label">Default:</span>
                </div>
                <div class="section-content">
                    <div class="nested-blocks" data-role="choose-default" data-empty-text="No actions yet.">
                        ${defaultActions.map((action, idx) =>
            renderNestedBlockInline(action, idx, 'default', 'action')
        ).join('')}
                    </div>
                    ${hasDefaultActions ? '' : '<div class="nested-empty">No actions yet.</div>'}
                    <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                        + Add action
                    </button>
                </div>
            </div>
        `;
    } else {
        html += `
            <button type="button" class="add-else-button" onclick="addChooseDefault(this)">
                + Add default
            </button>
        `;
    }

    html += '</div>';
    return html;
}

function renderChooseOption(option, index) {
    const conditions = Array.isArray(option.conditions) ? option.conditions : (option.conditions ? [option.conditions] : []);
    const sequence = Array.isArray(option.sequence) ? option.sequence : (option.sequence ? [option.sequence] : []);
    const hasConditions = conditions.length > 0;
    const hasActions = sequence.length > 0;
    const alias = option.alias || '';

    return `
        <div class="choose-option" data-index="${index}">
            <div class="choose-option-header">
                <span>Option ${index + 1}</span>
                <div class="choose-option-actions">
                    <button type="button" class="choose-option-remove" onclick="removeChooseOption(this)">Remove</button>
                </div>
            </div>
            <div class="block-field">
                <label>Alias</label>
                <input type="text" data-role="choose-option-alias" value="${escapeHtml(alias)}" placeholder="Optional">
            </div>
            <div class="nested-section">
                <div class="section-header">
                    <span class="section-label">Conditions:</span>
                </div>
                <div class="section-content">
                    <div class="nested-blocks" data-role="choose-conditions" data-empty-text="No conditions yet.">
                        ${conditions.map((cond, idx) =>
        renderNestedBlockInline(cond, idx, 'choose.conditions', 'condition')
    ).join('')}
                    </div>
                    ${hasConditions ? '' : '<div class="nested-empty">No conditions yet.</div>'}
                    <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'condition')">
                        + Add condition
                    </button>
                </div>
            </div>
            <div class="nested-section">
                <div class="section-header">
                    <span class="section-label">Actions:</span>
                </div>
                <div class="section-content">
                    <div class="nested-blocks" data-role="choose-sequence" data-empty-text="No actions yet.">
                        ${sequence.map((action, idx) =>
        renderNestedBlockInline(action, idx, 'choose.sequence', 'action')
    ).join('')}
                    </div>
                    ${hasActions ? '' : '<div class="nested-empty">No actions yet.</div>'}
                    <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                        + Add action
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render wait_for_trigger with nested triggers
 */
function renderWaitForTriggerBlock(block) {
    const triggers = Array.isArray(block.wait_for_trigger) ? block.wait_for_trigger : (block.wait_for_trigger ? [block.wait_for_trigger] : []);
    const hasTriggers = triggers.length > 0;
    let html = '<div class="nested-block-container">';

    if (block.alias) {
        html += createFieldHtml('Alias', 'alias', block.alias);
    }

    html += `
        <div class="nested-section wait-for-trigger-section" data-section-type="wait_for_trigger">
            <div class="section-header">
                <span class="section-label">Triggers:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-role="wait-for-trigger" data-empty-text="No triggers yet.">
                    ${triggers.map((t, idx) =>
        renderNestedBlockInline(t, idx, 'wait_for_trigger', 'trigger')
    ).join('')}
                </div>
                ${hasTriggers ? '' : '<div class="nested-empty">No triggers yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'trigger')">
                    + Add trigger
                </button>
            </div>
        </div>
    `;

    const timeoutStr = typeof block.timeout === 'object' ? formatDuration(block.timeout) : (block.timeout || '');
    html += createFieldHtml('Timeout (optional)', 'timeout', timeoutStr, 'duration');
    html += createFieldHtml('Continue on Timeout', 'continue_on_timeout', !!block.continue_on_timeout, 'checkbox');

    html += '</div>';
    return html;
}

/**
 * Render parallel/sequence blocks with nested actions
 */
function renderActionListBlock(block, listKey, label) {
    const actions = Array.isArray(block[listKey]) ? block[listKey] : (block[listKey] ? [block[listKey]] : []);
    const hasActions = actions.length > 0;
    let html = '<div class="nested-block-container">';

    if (block.alias) {
        html += createFieldHtml('Alias', 'alias', block.alias);
    }

    html += `
        <div class="nested-section">
            <div class="section-header">
                <span class="section-label">${label}:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-role="${listKey}" data-empty-text="No actions yet.">
                    ${actions.map((action, idx) =>
        renderNestedBlockInline(action, idx, listKey, 'action')
    ).join('')}
                </div>
                ${hasActions ? '' : '<div class="nested-empty">No actions yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                    + Add action
                </button>
            </div>
        </div>
    `;

    html += '</div>';
    return html;
}

/**
 * Render repeat block with editable mode, conditions, and sequence
 */
function renderRepeatBlock(block) {
    const repeat = block.repeat || {};
    const mode = repeat.count !== undefined ? 'count' :
        repeat.while ? 'while' :
            repeat.until ? 'until' :
                repeat.for_each ? 'for_each' : 'count';

    const whileConds = Array.isArray(repeat.while) ? repeat.while : (repeat.while ? [repeat.while] : []);
    const untilConds = Array.isArray(repeat.until) ? repeat.until : (repeat.until ? [repeat.until] : []);
    const sequence = Array.isArray(repeat.sequence) ? repeat.sequence : (repeat.sequence ? [repeat.sequence] : []);
    const hasWhile = whileConds.length > 0;
    const hasUntil = untilConds.length > 0;
    const hasSeq = sequence.length > 0;

    let html = '<div class="nested-block-container repeat-block-layout">';

    if (block.alias) {
        html += createFieldHtml('Alias', 'alias', block.alias);
    }

    const countHidden = mode !== 'count' ? 'hidden' : '';
    const forEachHidden = mode !== 'for_each' ? 'hidden' : '';
    const whileHidden = mode !== 'while' ? 'hidden' : '';
    const untilHidden = mode !== 'until' ? 'hidden' : '';

    html += `
        <div class="block-field">
            <label>Repeat Type</label>
            <div class="select-wrapper">
                <select data-role="repeat-mode">
                    <option value="count" ${mode === 'count' ? 'selected' : ''}>Count</option>
                    <option value="while" ${mode === 'while' ? 'selected' : ''}>While</option>
                    <option value="until" ${mode === 'until' ? 'selected' : ''}>Until</option>
                    <option value="for_each" ${mode === 'for_each' ? 'selected' : ''}>For Each</option>
                </select>
                <svg class="select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
        </div>
        <div class="block-field ${countHidden}" data-role="repeat-count-row">
            <label>Count</label>
            <input type="number" data-role="repeat-count" value="${repeat.count !== undefined ? escapeHtml(String(repeat.count)) : ''}" min="1" step="1">
        </div>
        <div class="block-field ${forEachHidden}" data-role="repeat-for-each-row">
            <label>For Each</label>
            <input type="text" data-role="repeat-for-each" value="${repeat.for_each !== undefined ? escapeHtml(String(repeat.for_each)) : ''}" placeholder="list or template">
        </div>
        <div class="nested-section ${whileHidden}" data-role="repeat-while-section">
            <div class="section-header">
                <span class="section-label">While:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-role="repeat-while" data-empty-text="No conditions yet.">
                    ${whileConds.map((cond, idx) =>
        renderNestedBlockInline(cond, idx, 'repeat.while', 'condition')
    ).join('')}
                </div>
                ${hasWhile ? '' : '<div class="nested-empty">No conditions yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'condition')">
                    + Add condition
                </button>
            </div>
        </div>
        <div class="nested-section ${untilHidden}" data-role="repeat-until-section">
            <div class="section-header">
                <span class="section-label">Until:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-role="repeat-until" data-empty-text="No conditions yet.">
                    ${untilConds.map((cond, idx) =>
        renderNestedBlockInline(cond, idx, 'repeat.until', 'condition')
    ).join('')}
                </div>
                ${hasUntil ? '' : '<div class="nested-empty">No conditions yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'condition')">
                    + Add condition
                </button>
            </div>
        </div>
        <div class="nested-section">
            <div class="section-header">
                <span class="section-label">Sequence:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-role="repeat-sequence" data-empty-text="No actions yet.">
                    ${sequence.map((action, idx) =>
        renderNestedBlockInline(action, idx, 'repeat.sequence', 'action')
    ).join('')}
                </div>
                ${hasSeq ? '' : '<div class="nested-empty">No actions yet.</div>'}
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                    + Add action
                </button>
            </div>
        </div>
    `;

    html += '</div>';
    return html;
}

/**
 * Renders a specialized Notification block
 */
function renderNotificationBlock(block) {
    let html = '<div class="nested-block-container notification-block-layout">';

    // SERVICE SECTION
    const serviceId = block.service || block.action || '';

    // We treat the service picker essentially the same, but maybe filter it later?
    // For now, standard service picker is fine, user can search 'notify'.
    // ideally createServicePicker should support domain filter
    html += `
        <div class="nested-section">
            <div class="section-header">
                <span class="section-label">Service</span>
            </div>
            <div class="section-content">
                ${createFieldHtml('', 'service', serviceId, 'service')} 
            </div>
        </div>
    `;

    // DATA SECTION (Composer)
    const dataObj = block.data || {};

    html += `
        <div class="nested-section">
            <div class="section-header">
                <span class="section-label">Message</span>
            </div>
            <div class="section-content">
                 ${window.fieldComponents.createNotificationComposer(serviceId, dataObj, { name: 'data' })}
            </div>
        </div>
    `;

    html += '</div>';
    return html;
}

/**
 * Renders a Service/Action block with nested-section styling
 */
function renderServiceBlock(block) {
    let html = '<div class="nested-block-container service-block-layout">';

    // SERVICE SECTION
    const serviceId = block.service || block.action || '';

    html += `
        <div class="nested-section">
            <div class="section-header">
                <span class="section-label">Service</span>
            </div>
            <div class="section-content">
                ${createFieldHtml('', 'service', serviceId, 'service')}
            </div>
        </div>
    `;

    // TARGET SECTION
    // Only show if there are targets or it's relevant (always show for now as it's a primary field)
    let targetVal = {};
    if (block.target && typeof block.target === 'object') {
        targetVal = block.target;
    } else if (block.target) {
        targetVal = { entity_id: block.target };
    }

    html += `
        <div class="nested-section">
            <div class="section-header">
                <span class="section-label">Target</span>
            </div>
            <div class="section-content">
                ${createFieldHtml('', 'target', targetVal, 'target', { placeholder: 'Pick entities...' })}
            </div>
        </div>
    `;

    // OPTIONS SECTION (Schema Driven)
    // We pass the raw data object to the new editor
    const dataObj = block.data || {};

    html += `
        <div class="nested-section">
            <div class="section-header">
                <span class="section-label">Options</span>
            </div>
            <div class="section-content">
                 ${window.fieldComponents.createServiceArgsEditor(serviceId, dataObj, { name: 'data' })}
            </div>
        </div>
    `;

    html += '</div>';
    return html;
}

/**
 * Renders a nested block inline (recursively handles nested if/then, choose, etc.)
 */
function renderNestedBlockInline(blockData, index, parentPath, type) {
    // Create a mini block element for this nested item
    // We reuse createBlockHtml but with an index relative to its parent container if needed
    // IMPORTANT: createBlockHtml expects (block, type, index)
    const blockHtml = createBlockHtml(blockData, type, index, { forceCollapsed: state.settings.collapseBlocksByDefault });
    return `
        <div class="nested-block-wrapper" data-index="${index}" data-parent-path="${parentPath}">
            ${blockHtml}
        </div>
    `;
}

/**
 * Toggle expand/collapse of a nested section
 */
function toggleNestedSection(toggleButton) {
    toggleButton.classList.toggle('collapsed');
    const content = toggleButton.closest('.section-header').nextElementSibling;
    content.classList.toggle('hidden');
}

/**
 * Add a new nested block to a section
 */
function addNestedBlockToSection(button, type) {
    const section = button.closest('.nested-section');
    const container = section.querySelector('.nested-blocks');
    const parentPath = container.dataset.path;
    const modalSection = type === 'trigger' ? 'triggers' : (type === 'condition' ? 'conditions' : 'actions');

    // Show modal to select block type
    showAddBlockModal(modalSection, (selectedBlockType) => {
        // Create empty block
        const newBlock = createEmptyBlock(selectedBlockType, type);
        const index = container.querySelectorAll('.nested-block-wrapper').length;

        // Render and append
        const html = renderNestedBlockInline(newBlock, index, parentPath, type);
        container.insertAdjacentHTML('beforeend', html);

        // Initialize the new block's components
        const newWrapper = container.lastElementChild;
        const newBlockEl = newWrapper.querySelector('.action-block');
        if (newBlockEl) {
            initializeBlockComponents(newBlockEl);
        }

        checkDirty();
        updateYamlView();
        syncNestedEmpty(container);
    });
}

/**
 * Add else section to if/then block
 */
function addElseSection(button) {
    const container = button.parentElement;
    const elseHtml = `
        <div class="nested-section else-section" data-section-type="else">
            <div class="section-header">
                <span class="section-label">Else:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-path="else" data-role="else" data-empty-text="No actions yet.">
                </div>
                <div class="nested-empty">No actions yet.</div>
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                    + Add action
                </button>
            </div>
        </div>
    `;
    button.outerHTML = elseHtml;
    checkDirty();
    updateYamlView();
}

function addChooseOption(button) {
    const container = button.parentElement.querySelector('.choose-options');
    if (!container) return;

    const index = container.querySelectorAll('.choose-option').length;
    const optionHtml = renderChooseOption({ conditions: [], sequence: [] }, index);
    container.insertAdjacentHTML('beforeend', optionHtml);

    updateChooseOptionLabels(container);
    // Initialize nested blocks in the new option (none yet)
    checkDirty();
    updateYamlView();
    syncChooseOptionsEmpty(container);
}

function removeChooseOption(button) {
    const optionEl = button.closest('.choose-option');
    if (!optionEl) return;
    const container = optionEl.parentElement;
    optionEl.remove();
    updateChooseOptionLabels(container);
    checkDirty();
    updateYamlView();
    syncChooseOptionsEmpty(container);
}

function addChooseDefault(button) {
    const container = button.parentElement;
    const defaultHtml = `
        <div class="nested-section default-section" data-section-type="default">
            <div class="section-header">
                <span class="section-label">Default:</span>
            </div>
            <div class="section-content">
                <div class="nested-blocks" data-role="choose-default" data-empty-text="No actions yet.">
                </div>
                <div class="nested-empty">No actions yet.</div>
                <button type="button" class="add-nested-button" onclick="addNestedBlockToSection(this, 'action')">
                    + Add action
                </button>
            </div>
        </div>
    `;
    button.outerHTML = defaultHtml;
    checkDirty();
    updateYamlView();
}

function updateChooseOptionLabels(container) {
    if (!container) return;
    const options = Array.from(container.querySelectorAll('.choose-option'));
    options.forEach((opt, idx) => {
        opt.dataset.index = String(idx);
        const title = opt.querySelector('.choose-option-header span');
        if (title) title.textContent = `Option ${idx + 1}`;
    });
}

function updateNestedWrapperIndices(container) {
    if (!container) return;
    const wrappers = Array.from(container.querySelectorAll('.nested-block-wrapper'));
    wrappers.forEach((wrap, idx) => {
        wrap.dataset.index = String(idx);
    });
}

function syncNestedEmpty(container) {
    if (!container) return;
    const text = container.dataset.emptyText;
    if (!text) return;

    let emptyEl = container.parentElement.querySelector('.nested-empty');
    const hasChildren = container.querySelectorAll('.nested-block-wrapper').length > 0;

    if (hasChildren) {
        if (emptyEl) emptyEl.remove();
        return;
    }

    if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'nested-empty';
        emptyEl.textContent = text;
        container.insertAdjacentElement('afterend', emptyEl);
    }
}

function syncChooseOptionsEmpty(container) {
    if (!container) return;
    let emptyEl = container.parentElement.querySelector('.nested-empty');
    const hasOptions = container.querySelectorAll('.choose-option').length > 0;

    if (hasOptions) {
        if (emptyEl) emptyEl.remove();
        return;
    }

    if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'nested-empty';
        emptyEl.textContent = 'No options yet.';
        container.insertAdjacentElement('afterend', emptyEl);
    }
}

// Refresh a block's placeholder title based on its current field values
function refreshBlockTitle(blockEl) {
    const aliasTextEl = blockEl.querySelector('.block-alias-text');
    if (!aliasTextEl || !aliasTextEl.classList.contains('is-placeholder')) return;

    // Harvest current values from all inputs in the block
    const blockData = {};
    const inputs = blockEl.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        if (!input.name) return;

        let value = input.value;
        if (input.type === 'number') value = parseFloat(value);
        if (input.type === 'checkbox') value = input.checked;

        // Handle nested paths (though usually simpler for titles)
        blockData[input.name] = value;
    });

    // Determine type (trigger, condition, or action)
    let type = 'action';
    if (blockEl.classList.contains('trigger')) type = 'trigger';
    else if (blockEl.classList.contains('condition')) type = 'condition';

    // Preserve the trigger/condition platform type from data attribute 
    // (set when block was created - needed for correct title generation)
    const blockType = blockEl.dataset.blockType;
    if (blockType) {
        if (type === 'trigger') {
            blockData.platform = blockType;
            blockData.trigger = blockType;
        } else if (type === 'condition') {
            blockData.condition = blockType;
        }
    }

    // Get the updated title
    const newTitle = getBlockTitle(blockData, type);
    aliasTextEl.textContent = newTitle;
    renderBlockTags(blockEl, newTitle);
}

function renderBlockTags(blockEl, text) {
    const tagsContainer = blockEl.querySelector('.block-tags');
    if (!tagsContainer) return;

    tagsContainer.innerHTML = ''; // Clear existing
    if (!text) return;

    // Match hashtags
    const match = text.match(/#[\w-]+/g);
    if (!match) return;

    match.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'block-tag';
        span.textContent = tag;
        tagsContainer.appendChild(span);
    });

    // Optional: Remove tags from the title text?
    // User didn't ask for this explicitly, but usually better UX.
    // However, if we change textContent, we might mess up the input value sync.
    // Let's keep the tags in the text for now, but style them in the tags container.
    // Or we could hide them in the aliasText via CSS or logic. 
    // Given "we dont have anymore teh #tags", simply displaying them in a separate container is a safe first step.
    // If the user wants them stripped from the main title, we can add that later.
}

function getBlockTitle(block, type) {
    if (block.alias) return truncateEntityName(block.alias, 40);

    const formatDisplayName = (raw) => {
        if (!raw) return '';
        let name = String(raw).trim();
        if (!name) return '';

        // Replace separators with spaces
        name = name.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();

        // Remove trailing "detected" (common noisy suffix)
        const parts = name.split(' ');
        if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'detected') {
            parts.pop();
        }
        name = parts.join(' ');

        // Title-case only if original is all-lowercase (avoid mangling acronyms)
        const isAllLower = name === name.toLowerCase();

        const tokenMap = {
            ha: 'HA',
            aqara: 'Aqara',
            tv: 'TV',
            usb: 'USB',
            wifi: 'WiFi'
        };

        if (isAllLower) {
            name = name
                .split(' ')
                .map((word) => {
                    if (!word) return word;
                    const lower = word.toLowerCase();
                    if (tokenMap[lower]) return tokenMap[lower];
                    if (word === word.toUpperCase() && word.length <= 4) return word;
                    return word.charAt(0).toUpperCase() + word.slice(1);
                })
                .join(' ');
        }

        return name;
    };

    const formatStateValue = (val) => {
        if (val === undefined || val === null) return '';
        if (typeof val === 'boolean') return val ? 'On' : 'Off';
        const raw = String(val).trim();
        if (!raw) return raw;
        const lower = raw.toLowerCase();
        if (lower === 'on') return 'On';
        if (lower === 'off') return 'Off';
        if (lower === 'true') return 'True';
        if (lower === 'false') return 'False';
        if (raw.includes('_') || raw.includes('-')) return formatDisplayName(raw);
        if (raw === raw.toLowerCase()) {
            return raw.charAt(0).toUpperCase() + raw.slice(1);
        }
        return raw;
    };

    // Helper to safely get entity name, prioritizing friendly name from cache
    const getEntityName = (entityId) => {
        if (!entityId) return 'entity';
        const id = Array.isArray(entityId) ? entityId[0] : entityId;

        // Try to find friendly name in cache
        const cache = window.fieldComponents?.entityCache?.entities;
        if (cache) {
            const entity = cache.find(e => e.entity_id === id);
            if (entity && entity.friendly_name) {
                return truncateEntityName(formatDisplayName(entity.friendly_name), 35);
            }
        }

        return truncateEntityName(formatDisplayName(id.split('.').pop()), 25);
    };
    const getDeviceName = (deviceId) => {
        if (!deviceId) return 'device';
        const id = Array.isArray(deviceId) ? deviceId[0] : deviceId;
        const cache = window.fieldComponents?.deviceCache?.devices;
        if (cache) {
            const device = cache.find(d => d.device_id === id);
            if (device && device.name) {
                return truncateEntityName(formatDisplayName(device.name), 35);
            }
        }
        return truncateEntityName(formatDisplayName(id), 25);
    };
    const getAreaName = (areaId) => {
        if (!areaId) return 'area';
        const id = Array.isArray(areaId) ? areaId[0] : areaId;
        const cache = window.fieldComponents?.areaCache?.areas;
        if (cache) {
            const area = cache.find(a => a.area_id === id);
            if (area && area.name) {
                return truncateEntityName(formatDisplayName(area.name), 35);
            }
        }
        return truncateEntityName(formatDisplayName(id), 25);
    };

    // Triggers
    if (block.platform === 'state' || block.trigger === 'state') {
        const entity = getEntityName(block.entity_id);
        const from = formatStateValue(block.from);
        const to = formatStateValue(block.to);

        if (to !== undefined && to !== '' && from !== undefined && from !== '') {
            return `${entity}: ${from} → ${to}`;
        } else if (to !== undefined && to !== '') {
            return `${entity} → ${to}`;
        } else if (from !== undefined && from !== '') {
            return `${entity}: from ${from}`;
        }
        return `When ${entity} changes`;
    }
    if (block.platform === 'time' || block.trigger === 'time') {
        return `At ${block.at || 'time'}`;
    }
    if (block.platform === 'sun' || block.trigger === 'sun') {
        const offset = block.offset ? ` (${block.offset})` : '';
        return `At ${block.event || 'sun event'}${offset}`;
    }
    if (block.platform === 'event' || block.trigger === 'event') {
        return `Event: ${block.event_type || 'event'}`;
    }
    if (block.platform === 'persistent_notification' || block.trigger === 'persistent_notification') {
        const updateType = block.update_type || 'added';
        const notifId = block.notification_id || '';
        return notifId ? `Notification ${notifId} ${updateType}` : `Notification ${updateType}`;
    }
    if (block.platform === 'template' || block.trigger === 'template') {
        return 'Template trigger';
    }
    if (block.platform === 'device' || block.trigger === 'device') {
        return `Device: ${getDeviceName(block.device_id)}`;
    }
    if (block.platform === 'homeassistant' || block.trigger === 'homeassistant') {
        return `Home Assistant: ${block.event || 'start'}`;
    }
    if (block.platform === 'mqtt' || block.trigger === 'mqtt') {
        return `MQTT: ${block.topic || 'topic'}`;
    }
    if (block.platform === 'webhook' || block.trigger === 'webhook') {
        return `Webhook: ${block.webhook_id || 'webhook'}`;
    }
    if (block.platform === 'zone' || block.trigger === 'zone') {
        const entity = getEntityName(block.entity_id);
        return `${entity} ${block.event || 'enters'} zone`;
    }
    if (block.platform === 'time_pattern' || block.trigger === 'time_pattern') {
        const h = block.hours || '*';
        const m = block.minutes || '*';
        let s = block.seconds || '0';
        if (/^\d+$/.test(String(s))) {
            s = String(s).padStart(2, '0');
        }
        return `Time pattern ${h}:${m}:${s}`;
    }
    if (block.platform === 'numeric_state' || block.trigger === 'numeric_state') {
        const entity = getEntityName(block.entity_id);
        if (block.above !== undefined && block.below !== undefined) {
            return `${entity}: ${block.above} < x < ${block.below}`;
        } else if (block.above !== undefined) {
            return `${entity} > ${block.above}`;
        } else if (block.below !== undefined) {
            return `${entity} < ${block.below}`;
        }
        return `${entity} numeric change`;
    }

    // If/Then/Else blocks
    if (block.if && block.then) {
        const condCount = Array.isArray(block.if) ? block.if.length : 1;
        const thenCount = Array.isArray(block.then) ? block.then.length : 1;
        return `If (${condCount} condition${condCount > 1 ? 's' : ''}) → ${thenCount} action${thenCount > 1 ? 's' : ''}`;
    }

    // Choose blocks
    if (block.choose) {
        const optionCount = Array.isArray(block.choose) ? block.choose.length : 1;
        return `Choose (${optionCount} option${optionCount > 1 ? 's' : ''})`;
    }

    // Repeat blocks
    if (block.repeat) {
        if (block.repeat.count) {
            return `Repeat ${block.repeat.count} times`;
        } else if (block.repeat.until) {
            return `Repeat until condition`;
        } else if (block.repeat.while) {
            return `Repeat while condition`;
        } else if (block.repeat.for_each) {
            return `Repeat for each item`;
        }
        return 'Repeat';
    }

    // Parallel blocks
    if (block.parallel) {
        const count = Array.isArray(block.parallel) ? block.parallel.length : 1;
        return `Parallel (${count} action${count > 1 ? 's' : ''})`;
    }

    // Sequence blocks
    if (block.sequence) {
        const count = Array.isArray(block.sequence) ? block.sequence.length : 1;
        return `Sequence (${count} action${count > 1 ? 's' : ''})`;
    }

    // Wait for trigger
    if (block.wait_for_trigger) {
        const triggers = Array.isArray(block.wait_for_trigger) ? block.wait_for_trigger : [block.wait_for_trigger];
        if (triggers.length > 0 && triggers[0].entity_id) {
            return `Wait for ${getEntityName(triggers[0].entity_id)}`;
        }
        return 'Wait for trigger';
    }

    // Actions
    if (block.service || block.action) {
        const service = block.service || block.action;
        const parts = service.split('.');
        const actionName = parts.length > 1 ? parts[1] : service;
        const actionLabel = formatDisplayName(actionName);
        if (block.target?.entity_id) {
            const target = getEntityName(block.target.entity_id);
            return `${actionLabel}: ${target}`;
        }
        if (block.target?.device_id) {
            const target = getDeviceName(block.target.device_id);
            return `${actionLabel}: ${target}`;
        }
        if (block.target?.area_id) {
            const target = getAreaName(block.target.area_id);
            return `${actionLabel}: ${target}`;
        }
        return service;
    }

    if (block.delay) {
        return `Wait ${typeof block.delay === 'object' ? formatDuration(block.delay) : block.delay}`;
    }
    if (block.wait_template) {
        return 'Wait for template';
    }
    if (block.scene) {
        return `Scene: ${block.scene}`;
    }
    if (block.event) {
        return `Fire event: ${block.event}`;
    }
    if (block.variables) {
        return 'Set variables';
    }
    if (block.stop !== undefined) {
        return `Stop${block.stop ? `: ${block.stop}` : ''}`;
    }

    // Conditions
    if (block.condition === 'state') {
        const entity = getEntityName(block.entity_id);
        const stateLabel = block.state ? formatStateValue(block.state) : '...';
        return `${entity} is ${stateLabel}`;
    }
    if (block.condition === 'numeric_state') {
        const entity = getEntityName(block.entity_id);
        if (block.above !== undefined && block.below !== undefined) {
            return `${entity}: ${block.above} < x < ${block.below}`;
        } else if (block.above !== undefined) {
            return `${entity} > ${block.above}`;
        } else if (block.below !== undefined) {
            return `${entity} < ${block.below}`;
        }
        return `${entity} numeric`;
    }
    if (block.condition === 'time') {
        let timeDesc = 'Time';
        if (block.after && block.before) {
            timeDesc = `${block.after} - ${block.before}`;
        } else if (block.after) {
            timeDesc = `After ${block.after}`;
        } else if (block.before) {
            timeDesc = `Before ${block.before}`;
        }
        return timeDesc;
    }
    if (block.condition === 'trigger') {
        const ids = Array.isArray(block.id) ? block.id.join(', ') : block.id;
        return `Trigger: ${ids || 'any'}`;
    }
    if (block.condition === 'template') {
        return 'Template condition';
    }
    if (block.condition === 'zone') {
        const entity = getEntityName(block.entity_id);
        return `${entity} in zone`;
    }
    if (block.condition === 'and') {
        const count = Array.isArray(block.conditions) ? block.conditions.length : 0;
        return `All (${count} conditions)`;
    }
    if (block.condition === 'or') {
        const count = Array.isArray(block.conditions) ? block.conditions.length : 0;
        return `Any (${count} conditions)`;
    }
    if (block.condition === 'not') {
        const count = Array.isArray(block.conditions) ? block.conditions.length : 0;
        return `Not (${count} conditions)`;
    }

    return type.charAt(0).toUpperCase() + type.slice(1);
}

// Helper to truncate long entity names
function truncateEntityName(name, maxLength = 25) {
    if (!name) return '';
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 3) + '...';
}


function getBlockTypeBadge(block) {
    if (block.platform) return block.platform;
    if (block.trigger) return block.trigger;
    if (block.condition) return block.condition;
    if (block.if && block.then) return 'if/then';
    if (block.choose) return 'choose';
    if (block.repeat) return 'repeat';
    if (block.parallel) return 'parallel';
    if (block.sequence) return 'sequence';
    if (block.wait_for_trigger) return 'wait';
    if (block.service || block.action) {
        const svc = block.service || block.action;
        return svc.split('.')[0] || 'service';
    }
    if (block.delay) return 'delay';
    if (block.wait_template) return 'wait';
    return 'custom';
}

function getBlockTypeKey(block, type) {
    if (type === 'trigger') {
        return block.trigger || block.platform || '';
    }
    if (type === 'condition') {
        return block.condition || '';
    }

    // Actions
    if (block.if && block.then) return 'if';
    if (block.choose) return 'choose';
    if (block.repeat) return 'repeat';
    if (block.parallel) return 'parallel';
    if (block.sequence) return 'sequence';
    if (block.wait_for_trigger) return 'wait_for_trigger';
    if (block.wait_template) return 'wait_template';
    if (block.delay) return 'delay';
    if (block.scene) return 'scene';
    if (block.event) return 'event';
    if (block.variables) return 'variables';
    if (block.stop !== undefined) return 'stop';
    if (block.device_id && block.type && !block.condition && !block.trigger && !block.platform) return 'device';
    if (block.service || block.action) return 'service';
    if (block.condition) return block.condition;
    return '';
}

function getBlockIcon(block, type) {
    // Default icons by type
    const icons = {
        trigger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        condition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        action: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>'
    };

    return icons[type] || icons.action;
}

function getBlockFields(block, type) {
    const fields = [];
    const coerceObject = (val) => {
        if (val && typeof val === 'object') return val;
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                return (parsed && typeof parsed === 'object') ? parsed : null;
            } catch (e) {
                return null;
            }
        }
        return null;
    };

    // Trigger fields
    if (block.trigger === 'state' || block.platform === 'state') {
        const entityId = Array.isArray(block.entity_id) ? block.entity_id.join(', ') : block.entity_id;
        // Use entity picker with multi-select support
        fields.push(createFieldHtml('Entity', 'entity_id', entityId, 'entity', { multiple: true }));
        // Always show common state trigger fields
        fields.push(createFieldHtml('From State', 'from', block.from || ''));
        fields.push(createFieldHtml('To State', 'to', block.to || ''));
        fields.push(createFieldHtml('For Duration', 'for', block.for || '', 'duration'));
        if (block.attribute !== undefined) fields.push(createFieldHtml('Attribute', 'attribute', block.attribute));
    }

    // Time trigger fields
    if (block.trigger === 'time' || block.platform === 'time') {
        fields.push(createFieldHtml('At', 'at', block.at || '', 'time'));
    }

    // Numeric state trigger fields
    if (block.trigger === 'numeric_state' || block.platform === 'numeric_state') {
        const entityId = Array.isArray(block.entity_id) ? block.entity_id.join(', ') : block.entity_id;
        fields.push(createFieldHtml('Entity', 'entity_id', entityId, 'entity', { multiple: true }));
        fields.push(createFieldHtml('Above', 'above', block.above !== undefined ? String(block.above) : '', 'number'));
        fields.push(createFieldHtml('Below', 'below', block.below !== undefined ? String(block.below) : '', 'number'));
        fields.push(createFieldHtml('Attribute', 'attribute', block.attribute || ''));
        fields.push(createFieldHtml('For Duration', 'for', block.for || '', 'duration'));
        if (block.value_template !== undefined) {
            fields.push(createFieldHtml('Value Template', 'value_template', block.value_template, 'textarea'));
        }
    }

    // Sun trigger fields
    if (block.trigger === 'sun' || block.platform === 'sun') {
        fields.push(createFieldHtml('Event', 'event', block.event || 'sunrise', 'select', {
            options: [
                { value: 'sunrise', label: 'Sunrise' },
                { value: 'sunset', label: 'Sunset' }
            ]
        }));
        fields.push(createFieldHtml('Offset', 'offset', block.offset || '', 'duration'));
    }

    // Template trigger fields
    if (block.trigger === 'template' || block.platform === 'template') {
        fields.push(createFieldHtml('Value Template', 'value_template', block.value_template || '', 'textarea'));
        fields.push(createFieldHtml('For Duration', 'for', block.for || '', 'duration'));
    }

    // Zone trigger fields
    if (block.trigger === 'zone' || block.platform === 'zone') {
        const entityId = Array.isArray(block.entity_id) ? block.entity_id.join(', ') : block.entity_id;
        fields.push(createFieldHtml('Person/Device', 'entity_id', entityId, 'entity', { multiple: true, domainFilter: 'person' }));
        fields.push(createFieldHtml('Zone', 'zone', block.zone || '', 'entity', { domainFilter: 'zone' }));
        fields.push(createFieldHtml('Event', 'event', block.event || 'enter', 'select', {
            options: [
                { value: 'enter', label: 'Enter' },
                { value: 'leave', label: 'Leave' }
            ]
        }));
    }

    // Event trigger fields
    if (block.trigger === 'event' || block.platform === 'event') {
        fields.push(createFieldHtml('Event Type', 'event_type', block.event_type || ''));
        if (block.event_data) {
            const eventObj = coerceObject(block.event_data);
            if (eventObj) {
                fields.push(createFieldHtml('Event Data', 'event_data', eventObj, 'data'));
            } else {
                const dataStr = typeof block.event_data === 'string' ? block.event_data : JSON.stringify(block.event_data, null, 2);
                fields.push(createFieldHtml('Event Data', 'event_data', dataStr, 'textarea'));
            }
        } else {
            fields.push(createFieldHtml('Event Data (optional)', 'event_data', '', 'data'));
        }
        if (block._invalid_event_data) {
            fields.push(`<div class="block-field invalid-json">Event Data must be valid JSON.</div>`);
        }
    }

    // Persistent notification trigger fields
    if (block.trigger === 'persistent_notification' || block.platform === 'persistent_notification') {
        fields.push(createFieldHtml('Update Type', 'update_type', block.update_type || 'added', 'select', {
            options: [
                { value: 'added', label: 'Added' },
                { value: 'updated', label: 'Updated' },
                { value: 'removed', label: 'Removed' }
            ]
        }));
        fields.push(createFieldHtml('Notification ID (optional)', 'notification_id', block.notification_id || ''));
    }

    // Homeassistant trigger fields (start, shutdown, update)
    if (block.trigger === 'homeassistant' || block.platform === 'homeassistant') {
        fields.push(createFieldHtml('Event', 'event', block.event || 'start', 'select', {
            options: [
                { value: 'start', label: 'Start' },
                { value: 'shutdown', label: 'Shutdown' },
                { value: 'update', label: 'Update' }
            ]
        }));
    }

    // MQTT trigger fields
    if (block.trigger === 'mqtt' || block.platform === 'mqtt') {
        fields.push(createFieldHtml('Topic', 'topic', block.topic || ''));
        fields.push(createFieldHtml('Payload (optional)', 'payload', block.payload || ''));
        if (block.value_template) {
            fields.push(createFieldHtml('Value Template', 'value_template', block.value_template, 'textarea'));
        }
    }

    // Webhook trigger fields
    if (block.trigger === 'webhook' || block.platform === 'webhook') {
        fields.push(createFieldHtml('Webhook ID', 'webhook_id', block.webhook_id || ''));
        const methodsValue = Array.isArray(block.allowed_methods) ? block.allowed_methods.join(', ') : (block.allowed_methods || '');
        fields.push(createFieldHtml('Allowed Methods', 'allowed_methods', methodsValue, 'input', { placeholder: 'GET, POST, PUT...' }));
    }

    // Device trigger fields
    if (block.trigger === 'device' || block.platform === 'device') {
        fields.push(createFieldHtml('Device', 'device_id', block.device_id || '', 'device', { placeholder: 'Search devices...' }));
        fields.push(createFieldHtml('Domain', 'domain', block.domain || '', 'input', { placeholder: 'light, switch, climate...' }));
        fields.push(createFieldHtml('Type', 'type', block.type || '', 'input', { placeholder: 'trigger/type' }));
        const extra = {};
        const skipKeys = ['device_id', 'domain', 'type', 'trigger', 'platform', 'alias', 'enabled'];
        Object.keys(block).filter(k => !skipKeys.includes(k)).forEach(k => {
            extra[k] = block[k];
        });
        fields.push(createFieldHtml('Extra (JSON)', 'device_extra', Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '', 'data'));
        if (block._invalid_device_extra) {
            fields.push(`<div class="block-field invalid-json">Device Extra must be valid JSON.</div>`);
        }
    }

    // Time pattern trigger (cron-like)
    if (block.trigger === 'time_pattern' || block.platform === 'time_pattern') {
        fields.push(createFieldHtml('Hours', 'hours', block.hours || '*'));
        fields.push(createFieldHtml('Minutes', 'minutes', block.minutes || '*'));
        fields.push(createFieldHtml('Seconds', 'seconds', block.seconds || '0'));
    }

    // If/Then blocks - NESTED RENDERING (not summary)
    if (block.if && block.then) {
        // Return the nested rendering instead of summary fields
        return renderNestedIfThenBlock(block);
    }

    // Choose blocks
    if (block.choose) {
        return renderChooseBlock(block);
    }

    // Wait for trigger
    if (block.wait_for_trigger) {
        return renderWaitForTriggerBlock(block);
    }

    // Parallel/Sequence blocks
    if (block.parallel || block.sequence) {
        if (block.parallel) return renderActionListBlock(block, 'parallel', 'Parallel');
        return renderActionListBlock(block, 'sequence', 'Sequence');
    }

    // Repeat blocks
    if (block.repeat) {
        return renderRepeatBlock(block);
    }

    // Service/Action blocks
    if (block.service !== undefined || block.action !== undefined) {
        const svc = block.service || block.action || '';
        // Specialized renderers
        if (svc.startsWith('notify.')) {
            return renderNotificationBlock(block);
        }
        return renderServiceBlock(block);
    }

    // Delay
    // Delay
    if (block.delay !== undefined) {
        // block.delay might be a string "00:01:00" or object { "minutes": 1 }
        // createDurationPicker handles both wrapped in a container
        fields.push(`
            <div class="block-field">
                <label>Duration</label>
                ${window.fieldComponents.createDurationPicker('delay', block.delay)}
            </div>
        `);
    }

    // Stop action
    if (block.stop !== undefined) {
        fields.push(createFieldHtml('Stop Reason', 'stop', block.stop || ''));
        if (block.response_variable) {
            fields.push(createFieldHtml('Response Variable', 'response_variable', block.response_variable));
        }
        if (block.error !== undefined) {
            fields.push(createFieldHtml('Is Error', 'error', !!block.error, 'checkbox'));
        } else {
            fields.push(createFieldHtml('Is Error', 'error', false, 'checkbox'));
        }
    }

    // Fire event action
    if (block.event) {
        fields.push(createFieldHtml('Event', 'event', block.event));
        if (block.event_data) {
            const eventObj = coerceObject(block.event_data);
            if (eventObj) {
                fields.push(createFieldHtml('Event Data', 'event_data', eventObj, 'data'));
            } else {
                const dataStr = typeof block.event_data === 'string' ? block.event_data : JSON.stringify(block.event_data, null, 2);
                fields.push(createFieldHtml('Event Data', 'event_data', dataStr, 'textarea'));
            }
        } else {
            fields.push(createFieldHtml('Event Data (optional)', 'event_data', '', 'data'));
        }
        if (block._invalid_event_data) {
            fields.push(`<div class="block-field invalid-json">Event Data must be valid JSON.</div>`);
        }
    }

    // Variables / Set variable
    if (block.variables) {
        const varsObj = coerceObject(block.variables);
        if (varsObj) {
            fields.push(createFieldHtml('Variables', 'variables', varsObj, 'data'));
        } else {
            const varsStr = typeof block.variables === 'string' ? block.variables : JSON.stringify(block.variables, null, 2);
            fields.push(createFieldHtml('Variables', 'variables', varsStr, 'textarea'));
        }
        if (block._invalid_variables) {
            fields.push(`<div class="block-field invalid-json">Variables must be valid JSON.</div>`);
        }
    }

    // Scene action
    if (block.scene) {
        fields.push(createFieldHtml('Scene', 'scene', block.scene, 'entity', { domainFilter: 'scene' }));
    }

    // Wait template action
    if (block.wait_template) {
        fields.push(createFieldHtml('Template', 'wait_template', block.wait_template, 'textarea'));
        const timeoutStr = typeof block.timeout === 'object' ? formatDuration(block.timeout) : (block.timeout || '');
        fields.push(createFieldHtml('Timeout (optional)', 'timeout', timeoutStr, 'duration'));
        fields.push(createFieldHtml('Continue on Timeout', 'continue_on_timeout', !!block.continue_on_timeout, 'checkbox'));
    }

    // Device action
    if (block.device_id && block.type && !block.condition && !block.trigger && !block.platform) {
        fields.push(createFieldHtml('Device', 'device_id', block.device_id || '', 'device', { placeholder: 'Search devices...' }));
        fields.push(createFieldHtml('Domain', 'domain', block.domain || '', 'input', { placeholder: 'light, switch, climate...' }));
        fields.push(createFieldHtml('Type', 'type', block.type || '', 'input', { placeholder: 'action/type' }));
        const extra = {};
        const skipKeys = ['device_id', 'domain', 'type', 'alias', 'enabled'];
        Object.keys(block).filter(k => !skipKeys.includes(k)).forEach(k => {
            extra[k] = block[k];
        });
        fields.push(createFieldHtml('Extra (JSON)', 'device_extra', Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '', 'data'));
        if (block._invalid_device_extra) {
            fields.push(`<div class="block-field invalid-json">Device Extra must be valid JSON.</div>`);
        }
    }

    // Condition blocks
    if (block.condition === 'and' || block.condition === 'or' || block.condition === 'not') {
        return renderConditionGroupBlock(block);
    }
    if (block.condition === 'state') {
        fields.push(createFieldHtml('Entity', 'entity_id', block.entity_id || '', 'entity'));
        fields.push(createFieldHtml('State', 'state', block.state || ''));
        if (block.attribute !== undefined) fields.push(createFieldHtml('Attribute', 'attribute', block.attribute));
        fields.push(createFieldHtml('For Duration', 'for', block.for || '', 'duration'));
    }
    if (block.condition === 'trigger') {
        const ids = Array.isArray(block.id) ? block.id.join(', ') : block.id;
        fields.push(createFieldHtml('Trigger IDs', 'id', ids || ''));
    }
    if (block.condition === 'template') {
        fields.push(createFieldHtml('Template', 'value_template', block.value_template || '', 'textarea'));
    }
    if (block.condition === 'numeric_state') {
        fields.push(createFieldHtml('Entity', 'entity_id', block.entity_id || '', 'entity'));
        fields.push(createFieldHtml('Above', 'above', block.above !== undefined ? String(block.above) : '', 'number'));
        fields.push(createFieldHtml('Below', 'below', block.below !== undefined ? String(block.below) : '', 'number'));
        if (block.attribute !== undefined) fields.push(createFieldHtml('Attribute', 'attribute', block.attribute));
        fields.push(createFieldHtml('For Duration', 'for', block.for || '', 'duration'));
        if (block.value_template !== undefined) {
            fields.push(createFieldHtml('Value Template', 'value_template', block.value_template, 'textarea'));
        }
    }
    if (block.condition === 'time') {
        fields.push(createFieldHtml('After', 'after', block.after || '', 'time'));
        fields.push(createFieldHtml('Before', 'before', block.before || '', 'time'));
        const weekdayStr = Array.isArray(block.weekday) ? block.weekday.join(', ') : (block.weekday || '');
        fields.push(createFieldHtml('Weekday', 'weekday', weekdayStr, 'weekday'));
    }
    if (block.condition === 'sun') {
        fields.push(createFieldHtml('After', 'after', block.after || '', 'select', {
            options: [
                { value: '', label: 'Any' },
                { value: 'sunrise', label: 'Sunrise' },
                { value: 'sunset', label: 'Sunset' }
            ]
        }));
        fields.push(createFieldHtml('After Offset', 'after_offset', block.after_offset || '', 'duration'));
        fields.push(createFieldHtml('Before', 'before', block.before || '', 'select', {
            options: [
                { value: '', label: 'Any' },
                { value: 'sunrise', label: 'Sunrise' },
                { value: 'sunset', label: 'Sunset' }
            ]
        }));
        fields.push(createFieldHtml('Before Offset', 'before_offset', block.before_offset || '', 'duration'));
    }
    if (block.condition === 'zone') {
        const entityId = Array.isArray(block.entity_id) ? block.entity_id.join(', ') : block.entity_id;
        fields.push(createFieldHtml('Person/Device', 'entity_id', entityId, 'entity', { multiple: true }));
        fields.push(createFieldHtml('Zone', 'zone', block.zone || '', 'entity', { domainFilter: 'zone' }));
    }
    if (block.condition === 'device') {
        fields.push(createFieldHtml('Device', 'device_id', block.device_id || '', 'device', { placeholder: 'Search devices...' }));
        fields.push(createFieldHtml('Domain', 'domain', block.domain || '', 'input', { placeholder: 'light, switch, climate...' }));
        fields.push(createFieldHtml('Type', 'type', block.type || '', 'input', { placeholder: 'condition/type' }));
        const extra = {};
        const skipKeys = ['device_id', 'domain', 'type', 'condition', 'alias', 'enabled'];
        Object.keys(block).filter(k => !skipKeys.includes(k)).forEach(k => {
            extra[k] = block[k];
        });
        fields.push(createFieldHtml('Extra (JSON)', 'device_extra', Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '', 'data'));
        if (block._invalid_device_extra) {
            fields.push(`<div class="block-field invalid-json">Device Extra must be valid JSON.</div>`);
        }
    }

    // Fallback: Time trigger (for blocks with just 'at' property)
    if (block.at && !block.trigger && !block.platform) {
        fields.push(createFieldHtml('At', 'at', block.at, 'time'));
    }

    // Templates
    if (block.wait_template) {
        fields.push(createFieldHtml('Template', 'wait_template', block.wait_template, 'textarea'));
    }
    if (block.value_template && !block.condition) {
        fields.push(createFieldHtml('Template', 'value_template', block.value_template, 'textarea'));
    }

    // If still no fields, show a compact summary
    if (fields.length === 0) {
        const summary = Object.keys(block).slice(0, 3).map(k => `${k}: ${JSON.stringify(block[k]).substring(0, 50)}`).join('\\n');
        fields.push(createFieldHtml('Details', 'raw', summary, 'summary'));
    }

    return fields.join('');
}

// Helper function to create a one-line summary of a block
function summarizeBlock(block) {
    if (!block) return '';

    // Service calls
    if (block.service || block.action) {
        const service = block.service || block.action;
        if (block.target?.entity_id) {
            const target = Array.isArray(block.target.entity_id) ? block.target.entity_id[0] : block.target.entity_id;
            return `${service} → ${target.split('.').pop()}`;
        }
        return service;
    }

    // Conditions
    if (block.condition === 'state') {
        return `${(block.entity_id || '').split('.').pop()} is ${block.state}`;
    }
    if (block.condition === 'trigger') {
        const ids = Array.isArray(block.id) ? block.id.join(', ') : block.id;
        return `Trigger: ${ids}`;
    }
    if (block.condition === 'template') {
        return 'Template condition';
    }

    // Triggers
    if (block.trigger === 'state') {
        const entityId = Array.isArray(block.entity_id) ? block.entity_id[0] : block.entity_id;
        return `${entityId?.split('.').pop()} ${block.from ? block.from + ' → ' : '→ '}${block.to || 'changes'}`;
    }

    // Control flow
    if (block.delay) return `Wait ${typeof block.delay === 'object' ? formatDuration(block.delay) : block.delay}`;
    if (block.wait_for_trigger) return 'Wait for trigger';
    if (block.if) return `If/Then (${Array.isArray(block.then) ? block.then.length : 1} actions)`;
    if (block.parallel) return `Parallel (${Array.isArray(block.parallel) ? block.parallel.length : 1} actions)`;
    if (block.choose) return 'Choose';
    if (block.repeat) return 'Repeat';
    if (block.alias) return block.alias;

    return 'Action';
}

function createFieldHtml(label, name, value, type = 'input', options = {}) {
    const escaped = escapeHtml(value || '');

    if (type === 'textarea') {
        return `
      <div class="block-field">
        <label>${label}</label>
        <textarea name="${name}" rows="3">${escaped}</textarea>
      </div>
    `;
    }

    if (type === 'select') {
        const selectOptions = options.options || [];
        const optionsHtml = selectOptions.map(opt =>
            `<option value="${escapeHtml(opt.value)}" ${opt.value === value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`
        ).join('');

        return `
      <div class="block-field">
        <label>${label}</label>
        <div class="select-wrapper">
             <select name="${name}">
                ${optionsHtml}
             </select>
             <svg class="select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
    `;
    }

    if (type === 'checkbox') {
        return `
      <div class="block-field checkbox-field">
        <label>
          <input type="checkbox" name="${name}" ${value ? 'checked' : ''}>
          <span>${label}</span>
        </label>
      </div>
    `;
    }

    if (type === 'weekday') {
        const days = [
            { value: 'mon', label: 'Mon' },
            { value: 'tue', label: 'Tue' },
            { value: 'wed', label: 'Wed' },
            { value: 'thu', label: 'Thu' },
            { value: 'fri', label: 'Fri' },
            { value: 'sat', label: 'Sat' },
            { value: 'sun', label: 'Sun' }
        ];
        const selected = (value || '').split(',').map(v => v.trim()).filter(Boolean);
        return `
      <div class="block-field weekday-field">
        <label>${label}</label>
        <div class="weekday-options">
          ${days.map(day => `
            <label class="weekday-option">
              <input type="checkbox" name="${name}" value="${day.value}" ${selected.includes(day.value) ? 'checked' : ''}>
              <span>${day.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
    }

    if (type === 'summary') {
        // Display as a list of items
        const items = (value || '').split('\\n').filter(Boolean);
        const itemsHtml = items.map(item => `<div class="summary-item">• ${escapeHtml(item)}</div>`).join('');
        return `
      <div class="block-field summary-field">
        <label>${label}</label>
        <div class="summary-list">${itemsHtml || '<div class="summary-item empty">None</div>'}</div>
      </div>
    `;
    }

    // Entity picker field type
    if (type === 'entity' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createEntityPicker(name, value, {
            domainFilter: options.domainFilter || null,
            multiple: options.multiple || false,
            placeholder: options.placeholder || 'Search entities...'
        })}
      </div>
    `;
    }

    // Device picker field type
    if (type === 'device' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createDevicePicker(name, value, {
            multiple: options.multiple || false,
            placeholder: options.placeholder || 'Search devices...'
        })}
      </div>
    `;
    }

    // Area picker field type
    if (type === 'area' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createAreaPicker(name, value, {
            multiple: options.multiple || false,
            placeholder: options.placeholder || 'Search areas...'
        })}
      </div>
    `;
    }

    // Service picker field type
    if (type === 'service' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createServicePicker(name, value, {
            placeholder: options.placeholder || 'Search services...'
        })}
      </div>
    `;
    }

    // Target selector field type
    if (type === 'target' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createTargetSelector(name, value, { showDeviceArea: false })}
      </div>
    `;
    }

    // Data editor field type
    if (type === 'data' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createDataEditor(name, value)}
      </div>
    `;
    }

    // Duration picker field type
    if (type === 'duration' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createDurationPicker(name, value, {
            showMilliseconds: options.showMilliseconds || false
        })}
      </div>
    `;
    }

    // Time picker field type (for time of day)
    if (type === 'time' && window.fieldComponents) {
        return `
      <div class="block-field">
        <label>${label}</label>
        ${window.fieldComponents.createTimePicker(name, value)}
      </div>
    `;
    }

    // Number input field type
    if (type === 'number') {
        return `
      <div class="block-field">
        <label>${label}</label>
        <input type="number" name="${name}" value="${escaped}" step="any" class="number-input">
      </div>
    `;
    }

    const placeholder = options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : '';

    return `
    <div class="block-field">
      <label>${label}</label>
      <input type="text" name="${name}" value="${escaped}" ${placeholder}>
    </div>
  `;
}

function formatDuration(delay) {
    if (typeof delay === 'string') return delay;
    const h = String(delay.hours || 0).padStart(2, '0');
    const m = String(delay.minutes || 0).padStart(2, '0');
    const s = String(delay.seconds || 0).padStart(2, '0');
    const ms = delay.milliseconds ? `.${delay.milliseconds} ` : '';
    return `${h}:${m}:${s}${ms} `;
}

function parseDelayValue(value) {
    if (!value || typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed.startsWith('{{') || trimmed.startsWith('{%')) return trimmed;

    // Handle shorthands: 3s, 10m, 1h
    const match = trimmed.toLowerCase().match(/^(\d+)([hms])$/);
    if (match) {
        const num = parseInt(match[1]);
        const unit = match[2];
        if (unit === 's') return `00:00:${String(num).padStart(2, '0')} `;
        if (unit === 'm') return `00:${String(num).padStart(2, '0')}:00`;
        if (unit === 'h') return `${String(num).padStart(2, '0')}:00:00`;
    }

    return trimmed;
}

// Flag for YAML listeners is now managed via dataset on the element
/**
 * Updates the YAML editor view with the latest content
 * @param {Object} itemOverride - Optional item to generate YAML from (used for preview)
 */
async function updateYamlView(itemOverride = null) {
    console.log('>>> [updateYamlView] START');
    const item = itemOverride || (state.versionControl?.previewMode ? state.versionControl.previewData : state.selectedItem);
    if (!item) {
        console.warn('>>> [updateYamlView] No item to render');
        return;
    }

    const textarea = document.getElementById('yaml-content');
    const yamlEditor = document.getElementById('yaml-editor');
    if (!textarea) return;
    if (yamlEditor) yamlEditor.classList.add('plain');

    // If in version preview mode or explicit item provided, generate YAML from object
    if ((state.versionControl?.previewMode) || itemOverride) {
        textarea.value = generateYamlFromItem(item);
        updateYamlHighlighter();
        updateLineNumbers();
        setupYamlEditorListeners();
        return;
    }

    const type = item._type || (state.currentGroup === 'automations' ? 'automation' : 'script');
    const itemId = item.id;

    try {
        const response = await fetch(`./api/${type}/${itemId}/raw-yaml`);
        const data = await response.json();

        if (data.success) {
            textarea.value = data.yaml;
        } else {
            console.warn('[updateYamlView] API failed, falling back to generated YAML');
            textarea.value = generateYamlFromItem(item);
        }
    } catch (err) {
        console.error('[updateYamlView] Error fetching raw YAML:', err);
        textarea.value = generateYamlFromItem(item);
    }

    updateYamlHighlighter();
    updateLineNumbers();
    setupYamlEditorListeners();
}

// Generate YAML from the current visual editor data (fallback)
function generateYamlFromEditor() {
    const item = getEditorData();

    // Helper to quote strings only when necessary (matches HA YAML style)
    const smartQuote = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str === '' || /[\n\t"':#\[\]\{\}\(\)\*&!|,>]/.test(str) || !isNaN(Number(str)) || /^(true|false|on|off|yes|no)$/i.test(str)) {
            return `'${str.replace(/'/g, "''")}'`;
        }
        return str;
    };

    if (state.currentGroup === 'automations') {
        return `id: ${smartQuote(item.id || '')}
alias: ${smartQuote(item.alias || '')}
description: ${smartQuote(item.description || '')}
mode: ${smartQuote(item.mode || 'single')}
triggers:
${formatArrayAsYaml(item.triggers, 2)}
conditions:
${formatArrayAsYaml(item.conditions, 2)}
actions:
${formatArrayAsYaml(item.actions, 2)}`;
    } else {
        return `${item.id}:
  alias: ${smartQuote(item.alias || '')}
  description: ${smartQuote(item.description || '')}
  mode: ${smartQuote(item.mode || 'single')}
  sequence:
${formatArrayAsYaml(item.sequence, 4)}`;
    }
}

// Generate YAML directly from an item object (for version preview mode)
function generateYamlFromItem(item) {
    if (!item) return '';

    // Helper to quote strings only when necessary (matches HA YAML style)
    const smartQuote = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str === '' || /[\n\t"':#\[\]\{\}\(\)\*&!|,>]/.test(str) || !isNaN(Number(str)) || /^(true|false|on|off|yes|no)$/i.test(str)) {
            return `'${str.replace(/'/g, "''")}'`;
        }
        return str;
    };

    const isAutomation = item._type === 'automation' || state.currentGroup === 'automations';

    if (isAutomation) {
        return `id: ${smartQuote(item.id || '')}
alias: ${smartQuote(item.alias || '')}
description: ${smartQuote(item.description || '')}
mode: ${smartQuote(item.mode || 'single')}
triggers:
${formatArrayAsYaml(item.triggers || item.trigger || [], 2)}
conditions:
${formatArrayAsYaml(item.conditions || item.condition || [], 2)}
actions:
${formatArrayAsYaml(item.actions || item.action || [], 2)}`;
    } else {
        return `${item.id}:
  alias: ${smartQuote(item.alias || '')}
  description: ${smartQuote(item.description || '')}
  mode: ${smartQuote(item.mode || 'single')}
  sequence:
${formatArrayAsYaml(item.sequence || [], 4)}`;
    }
}

function formatArrayAsYaml(arr, indent = 2) {
    if (!arr || arr.length === 0) return `${' '.repeat(indent)}[]`;

    const formatValue = (val, level) => {
        const pfx = ' '.repeat(level);
        if (val === null) return 'null';
        if (typeof val === 'undefined') return '';

        if (Array.isArray(val)) {
            if (val.length === 0) return '[]';
            return '\n' + val.map(v => {
                const vStr = formatValue(v, level + 2);
                if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                    const lines = vStr.split('\n');
                    const first = lines[0].trimStart();
                    const rest = lines.slice(1).map(l => pfx + '  ' + l.trimStart()).join('\n'); // Maintain alignment
                    // Actually, helper returns fully indented block. 
                    // vStr lines are already indented to level+2.
                    // lines[0] is level+2 spaces + key.
                    // We want level spaces + "- " + key.
                    // subsequent lines should keep level+2 spaces.

                    return `${pfx}- ${first}\n${lines.slice(1).join('\n')}`;
                }
                return `${pfx}- ${vStr.trimStart()}`;
            }).join('\n');
        }

        if (typeof val === 'object') {
            const keys = Object.keys(val);
            if (keys.length === 0) return '{}';

            return keys.map(k => {
                let keyStr = k;
                // Quote key if needed
                if (!/^[a-zA-Z0-9_\-]+$/.test(k)) keyStr = JSON.stringify(k);

                const v = val[k];
                const vRes = formatValue(v, level + 2);

                // If value is a nested block (array or object), ensure it starts on new line
                if (Array.isArray(v) || (typeof v === 'object' && v !== null && Object.keys(v).length > 0)) {
                    // Check if vRes already starts with \n (which happens for arrays)
                    const separator = vRes.startsWith('\n') ? '' : '\n';
                    return `${pfx}${keyStr}:${separator}${vRes}`;
                } else {
                    return `${pfx}${keyStr}: ${vRes.trimStart()}`;
                }
            }).join('\n');
        }

        // Primitive string
        if (typeof val === 'string') {
            // Heuristic for quoting
            // Empty, multiline, special chars, numbers, booleans
            if (val === '' || /[\n\t"':#\[\]\{\}\(\)\*&!|,>]/.test(val) || !isNaN(Number(val)) || /^(true|false|on|off|yes|no)$/i.test(val)) {
                // Use single quotes for YAML (escape single quotes by doubling)
                return `'${val.replace(/'/g, "''")}'`;
            }
            return val;
        }
        return String(val);
    };

    const spaces = ' '.repeat(indent);

    return arr.map(item => {
        const valStr = formatValue(item, indent + 2);

        // Handle block alignment for array item
        const idx = valStr.indexOf('\n');
        if (idx === -1) {
            return `${spaces}- ${valStr.trimStart()}`;
        }

        const firstLine = valStr.substring(0, idx);
        const rest = valStr.substring(idx + 1);
        return `${spaces}- ${firstLine.trimStart()}\n${rest}`;
    }).join('\n');
}

function highlightYaml(code) {
    if (!code) return '';

    // Basic HTML escape first
    let html = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    return html.split('\n').map(line => {
        // Comment - return early with full line highlighted
        if (line.trim().startsWith('#')) {
            return `<span class="token comment">${line}</span>`;
        }

        // Use placeholders to avoid regex matching inside HTML tags
        // \u0001 = Start Token, \u0002 = End Token
        let processedLine = line;

        // YAML Anchors (&anchor) and Aliases (*alias)
        processedLine = processedLine.replace(/(&\w+)/g, '\u0001a\u0002$1\u0001/a\u0002');
        processedLine = processedLine.replace(/(\*\w+)/g, '\u0001a\u0002$1\u0001/a\u0002');

        // YAML Tags (!!str, !!int, etc.)
        processedLine = processedLine.replace(/(!\S+)/g, '\u0001t\u0002$1\u0001/t\u0002');

        // Keys (key:) at start of line or after leading whitespace
        processedLine = processedLine.replace(/^(\s*)([\w\d_\-\.]+)(:)/g, '$1\u0001k\u0002$2\u0001/k\u0002\u0001c\u0002$3\u0001/c\u0002');

        // Keys in list items (- key:)
        processedLine = processedLine.replace(/^(\s*)(-)(\s+)([\w\d_\-\.]+)(:)/g,
            '$1\u0001d\u0002$2\u0001/d\u0002$3\u0001k\u0002$4\u0001/k\u0002\u0001c\u0002$5\u0001/c\u0002');

        // Standalone list dashes at start of line (- without key after)
        processedLine = processedLine.replace(/^(\s*)(-)(\s+)(?!\u0001)/g, '$1\u0001d\u0002$2\u0001/d\u0002$3');

        // Quoted Keys ("key":)
        processedLine = processedLine.replace(/^(\s*)("[^"]+")(:)/g, '$1\u0001k\u0002$2\u0001/k\u0002\u0001c\u0002$3\u0001/c\u0002');

        // Double-quoted strings
        processedLine = processedLine.replace(/("[^"]*")/g, '\u0001s\u0002$1\u0001/s\u0002');

        // Single-quoted strings (slightly different color)
        processedLine = processedLine.replace(/('[^']*')/g, '\u0001sq\u0002$1\u0001/sq\u0002');

        // Null values
        processedLine = processedLine.replace(/(:\s*)(null|~)\b/gi, '$1\u0001nl\u0002$2\u0001/nl\u0002');

        // Numbers (integers, floats, scientific notation) - only after colon
        processedLine = processedLine.replace(/(:\s*)(-?(\d+\.?\d*|\d*\.?\d+)(e[+-]?\d+)?)\b/gi, '$1\u0001n\u0002$2\u0001/n\u0002');

        // Booleans - only after colon or as standalone values
        processedLine = processedLine.replace(/(:\s*)(true|false|on|off|yes|no)\b/gi, '$1\u0001b\u0002$2\u0001/b\u0002');

        // Brackets and braces
        processedLine = processedLine.replace(/([\[\]\{\}])/g, '\u0001br\u0002$1\u0001/br\u0002');

        // Replace placeholders with actual HTML spans
        processedLine = processedLine
            .replace(/\u0001k\u0002/g, '<span class="token key">')
            .replace(/\u0001\/k\u0002/g, '</span>')
            .replace(/\u0001c\u0002/g, '<span class="token colon">')
            .replace(/\u0001\/c\u0002/g, '</span>')
            .replace(/\u0001d\u0002/g, '<span class="token dash">')
            .replace(/\u0001\/d\u0002/g, '</span>')
            .replace(/\u0001s\u0002/g, '<span class="token string">')
            .replace(/\u0001\/s\u0002/g, '</span>')
            .replace(/\u0001sq\u0002/g, '<span class="token string-single">')
            .replace(/\u0001\/sq\u0002/g, '</span>')
            .replace(/\u0001n\u0002/g, '<span class="token number">')
            .replace(/\u0001\/n\u0002/g, '</span>')
            .replace(/\u0001b\u0002/g, '<span class="token boolean">')
            .replace(/\u0001\/b\u0002/g, '</span>')
            .replace(/\u0001nl\u0002/g, '<span class="token null">')
            .replace(/\u0001\/nl\u0002/g, '</span>')
            .replace(/\u0001br\u0002/g, '<span class="token bracket">')
            .replace(/\u0001\/br\u0002/g, '</span>')
            .replace(/\u0001a\u0002/g, '<span class="token anchor">')
            .replace(/\u0001\/a\u0002/g, '</span>')
            .replace(/\u0001t\u0002/g, '<span class="token tag">')
            .replace(/\u0001\/t\u0002/g, '</span>')
            .replace(/\u0001p\u0002/g, '<span class="token punctuation">')
            .replace(/\u0001\/p\u0002/g, '</span>');

        return processedLine;
    }).join('\n');
}

function updateYamlHighlighter() {
    const textarea = document.getElementById('yaml-content');
    const highlight = document.getElementById('highlight-content');
    if (!textarea || !highlight) return;

    // Get value, highlight it
    const highlighted = highlightYaml(textarea.value);

    // Update highlight layer
    // Add <br> at end to ensure last empty line renders if present
    highlight.innerHTML = highlighted + '<br>';

    // Update line numbers
    updateLineNumbers(textarea.value);
}

function updateLineNumbers(text) {
    const lineNumbers = document.getElementById('line-numbers');
    if (!lineNumbers) return;

    // Get start line from state or default to 1
    // Note: If lineNumber is 0 or undefined, defaults to 1
    const startLine = state.selectedItem?.lineNumber || 1;

    const lines = text.split('\n').length;
    lineNumbers.innerHTML = Array(lines).fill(0).map((_, i) => i + startLine).join('\n');
}



function setupYamlEditorListeners() {
    const textarea = document.getElementById('yaml-content');
    if (!textarea || textarea.dataset.listenersAttached) return;

    const highlight = document.getElementById('highlight-content');
    const highlightPre = highlight?.parentElement; // pre.highlight-layer inside scroll container?
    // Wait, structure is:
    // .code-editor-wrapper
    //   .line-numbers
    //   .code-area (scrolls)
    //     textarea
    //     pre.highlight-layer

    // The textarea and pre both scroll? Or parent scrolls?
    // CSS check: 
    // .code-area { position: relative; overflow: auto; ... }
    // textarea, pre { position: absolute; top:0; left:0; ... }
    // If .code-area scrolls, then we don't need to sync textarea scroll, 
    // but textarea must be sized to content? 
    // Usually textarea and pre share a container.
    // Let's assume textarea handles scrolling if it has overflow:auto (it usually does for input).
    // Or if container handles scrolling.

    // IF textarea has overflow: scroll/auto, we sync pre.
    // Inspecting CSS would confirm. assuming textarea drives scroll.

    if (!textarea || !highlight) return;

    const syncScroll = () => {
        // Sync highlight scrolling to textarea
        if (highlight.parentElement) {
            highlight.parentElement.scrollTop = textarea.scrollTop;
            highlight.parentElement.scrollLeft = textarea.scrollLeft;
        }

        const lineNumbers = document.getElementById('line-numbers');
        if (lineNumbers) {
            lineNumbers.scrollTop = textarea.scrollTop;
        }
    };

    textarea.addEventListener('scroll', syncScroll);

    // Input handling
    textarea.addEventListener('input', () => {
        updateYamlHighlighter();
        state.isDirty = true;
        updateSaveButtonStatus(true);
    });

    // Tab support (indentation)
    YamlEditor.enableIndentation(textarea);

    textarea.dataset.listenersAttached = 'true';
}

function getEditorData() {
    const isAutomation = state.currentGroup === 'automations';

    const tags = elements.editorTags ? normalizeTagsInput(elements.editorTags.value) : [];
    const tagsForVars = tags.map(tag => tag.replace(/^#/, '').toLowerCase());
    const data = {
        id: state.selectedItem?.id || `new_${Date.now()}`,
        alias: elements.editorAlias.value,
        description: buildDescriptionWithTags(elements.editorDescription.value),
        mode: state.selectedItem?.mode || 'single'
    };

    const variables = { ...(state.selectedItem?.variables || {}) };
    if (tagsForVars.length) {
        variables.__tags = tagsForVars;
    } else {
        delete variables.__tags;
    }
    if (Object.keys(variables).length > 0) {
        data.variables = variables;
    }

    if (isAutomation) {
        data.enabled = elements.editorEnabled.checked;
        data.triggers = getBlocksData('triggers');
        data.conditions = getBlocksData('conditions');
        data.actions = getBlocksData('actions');
    } else {
        data.sequence = getBlocksData('actions');
    }

    return data;
}

function getBlocksData(section) {
    const container = document.getElementById(`${section}-container`);
    // Fix: Only select direct children to avoid flattening nested blocks
    const blocks = Array.from(container.children).filter(el => el.classList.contains('action-block'));

    // If no blocks, return empty array
    if (blocks.length === 0) return [];

    const result = [];

    blocks.forEach((blockEl, index) => {
        // Get the original block data as a base
        const originalBlocks = section === 'triggers'
            ? normalizeArray(state.selectedItem?.triggers)
            : section === 'conditions'
                ? normalizeArray(state.selectedItem?.conditions)
                : normalizeArray(state.selectedItem?.actions || state.selectedItem?.sequence);

        // Use data-index to match with original block (handles reordering)
        const originalIndex = parseInt(blockEl.dataset.index, 10);

        let baseData = null;
        if (!isNaN(originalIndex) && originalIndex < originalBlocks.length) {
            baseData = JSON.parse(JSON.stringify(originalBlocks[originalIndex]));
        }

        const parsed = parseBlockElement(blockEl, section, baseData);
        result.push(parsed);
    });

    return result;
}

function getDirectNestedBlockEls(containerEl) {
    if (!containerEl) return [];
    const wrappers = Array.from(containerEl.children).filter(el => el.classList.contains('nested-block-wrapper'));
    return wrappers.map(w => w.querySelector('.action-block')).filter(Boolean);
}

function parseNestedBlocks(containerEl, sectionType) {
    return getDirectNestedBlockEls(containerEl).map(el => parseBlockElement(el, sectionType));
}

function parseBlockElement(blockEl, section, baseData = null) {
    const blockData = baseData ? JSON.parse(JSON.stringify(baseData)) : {};
    const isTrigger = blockEl.classList.contains('trigger') || section === 'triggers' || section === 'trigger';
    const isCondition = blockEl.classList.contains('condition') || section === 'conditions' || section === 'condition';
    const isAction = !isTrigger && !isCondition;
    const blockType = blockEl.dataset.blockType || '';

    if (isTrigger && blockType && !blockData.trigger && !blockData.platform) {
        blockData.trigger = blockType;
    }
    if (isCondition && blockType && !blockData.condition) {
        blockData.condition = blockType;
    }
    if (isAction && blockType) {
        if (blockType === 'if' && !blockData.if) blockData.if = [];
        if (blockType === 'choose' && !blockData.choose) blockData.choose = [];
        if (blockType === 'repeat' && !blockData.repeat) blockData.repeat = {};
        if (blockType === 'parallel' && !blockData.parallel) blockData.parallel = [];
        if (blockType === 'sequence' && !blockData.sequence) blockData.sequence = [];
        if (blockType === 'wait_for_trigger' && !blockData.wait_for_trigger) blockData.wait_for_trigger = [];
        if (blockType === 'wait_template' && blockData.wait_template === undefined) blockData.wait_template = '';
        if (blockType === 'delay' && blockData.delay === undefined) blockData.delay = '';
        if (blockType === 'scene' && blockData.scene === undefined) blockData.scene = '';
        if (blockType === 'event' && blockData.event === undefined) blockData.event = '';
        if (blockType === 'variables' && blockData.variables === undefined) blockData.variables = {};
        if (blockType === 'stop' && blockData.stop === undefined) blockData.stop = '';
        if (blockType === 'device' && blockData.device_id === undefined) blockData.device_id = '';
        if (blockType === 'service' && blockData.action === undefined && blockData.service === undefined) blockData.action = '';

        // Fallback for condition-based actions (state, numeric_state, etc.)
        const knownActionTypes = ['if', 'choose', 'repeat', 'parallel', 'sequence', 'wait_for_trigger', 'wait_template', 'delay', 'scene', 'event', 'variables', 'stop', 'device', 'service'];
        if (!knownActionTypes.includes(blockType) && !blockData.condition && blockType !== '') {
            blockData.condition = blockType;
        }
    }

    // Capture enabled state
    if (blockEl.classList.contains('is-disabled')) {
        blockData.enabled = false;
    } else {
        delete blockData.enabled;
    }

    // Only parse inputs that belong to this block (avoid nested block inputs)
    const inputs = Array.from(blockEl.querySelectorAll('input, textarea, select'))
        .filter(input => input.closest('.action-block') === blockEl);

    inputs.forEach(input => {
        const name = input.getAttribute('name');
        if (!name || name === 'raw') return;

        // Skip weekday individual checkboxes (handled as a group)
        if (name === 'weekday' && input.type === 'checkbox') return;
        if (name === 'advanced_args' || name === 'advanced-data') return;

        // Skip service args editor inputs except the hidden data payload
        if (input.closest('.service-args-editor') && name !== 'data') return;
        if (input.closest('.notification-composer') && name !== 'data') return;

        let value = input.value;

        if (name === 'entity_id') {
            if (value.includes(',')) {
                value = value.split(',').map(v => v.trim());
            }
            blockData.entity_id = value;
        } else if (name === 'from') {
            if (value && value.trim() !== '') {
                blockData.from = value;
            } else {
                delete blockData.from;
            }
        } else if (name === 'to') {
            if (value && value.trim() !== '') {
                blockData.to = value;
            } else {
                delete blockData.to;
            }
        } else if (name === 'state') {
            blockData.state = value;
        } else if (name === 'id') {
            if (value && value.trim() !== '') {
                blockData.id = value;
            } else {
                delete blockData.id;
            }
        } else if (name === 'alias' || name === 'block-alias') {
            if (value) blockData.alias = value;
            else delete blockData.alias;
        } else if (name === 'service') {
            if (blockData.service !== undefined) {
                blockData.service = value;
            } else if (blockData.action !== undefined) {
                blockData.action = value;
            } else {
                blockData.action = value;
            }
        } else if (name === 'target') {
            const trimmed = value.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    blockData.target = JSON.parse(trimmed);
                } catch (e) {
                    // Fallback to entity list parsing
                    if (value.includes(',')) {
                        blockData.target = { entity_id: value.split(',').map(v => v.trim()) };
                    } else if (value) {
                        blockData.target = { entity_id: value };
                    }
                }
            } else if (value.includes(',')) {
                blockData.target = { entity_id: value.split(',').map(v => v.trim()) };
            } else if (value) {
                blockData.target = { entity_id: value };
            }
        } else if (name === 'delay') {
            blockData.delay = parseDelayValue(value);
        } else if (name === 'at') {
            blockData.at = value;
        } else if (name === 'data') {
            try {
                if (value.trim()) {
                    blockData.data = JSON.parse(value);
                }
            } catch (e) {
                // Keep original if invalid JSON
            }
        } else if (name === 'value_template' || name === 'wait_template') {
            blockData[name] = value;
        } else if (name === 'below') {
            if (value === '' || value === null || value === undefined) {
                delete blockData.below;
            } else {
                const numVal = parseFloat(value);
                blockData.below = isNaN(numVal) ? value : numVal;
            }
        } else if (name === 'above') {
            if (value === '' || value === null || value === undefined) {
                delete blockData.above;
            } else {
                const numVal = parseFloat(value);
                blockData.above = isNaN(numVal) ? value : numVal;
            }
        } else if (name === 'for') {
            if (value && value !== '00:00:00' && value.trim() !== '') {
                blockData.for = value;
            } else {
                delete blockData.for;
            }
        } else if (name === 'attribute') {
            if (value && value.trim() !== '') {
                blockData.attribute = value;
            } else {
                delete blockData.attribute;
            }
        } else if (name === 'mode') {
            if (value) blockData.mode = value;
        } else if (name === 'zone') {
            blockData.zone = value;
        } else if (name === 'event') {
            blockData.event = value;
        } else if (name === 'weekday') {
            const group = input.closest('.weekday-options');
            if (group) {
                const selected = Array.from(group.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(cb => cb.value);
                if (selected.length > 0) {
                    blockData.weekday = selected;
                } else {
                    delete blockData.weekday;
                }
            } else if (value) {
                blockData.weekday = value.split(',').map(v => v.trim()).filter(Boolean);
            }
        } else if (name === 'event_type') {
            blockData.event_type = value;
        } else if (name === 'event_data') {
            try {
                if (value.trim()) {
                    blockData.event_data = JSON.parse(value);
                } else {
                    delete blockData.event_data;
                }
                delete blockData._invalid_event_data;
            } catch (e) {
                blockData._invalid_event_data = true;
            }
        } else if (name === 'variables') {
            try {
                if (value.trim()) {
                    blockData.variables = JSON.parse(value);
                } else {
                    delete blockData.variables;
                }
                delete blockData._invalid_variables;
            } catch (e) {
                blockData._invalid_variables = true;
            }
        } else if (name === 'allowed_methods') {
            if (value && value.trim() !== '') {
                const list = value.split(',').map(v => v.trim()).filter(Boolean);
                blockData.allowed_methods = list;
            } else {
                delete blockData.allowed_methods;
            }
        } else if (name === 'device_extra') {
            const isDeviceBlock = blockData.trigger === 'device' ||
                blockData.platform === 'device' ||
                blockData.condition === 'device' ||
                (blockData.device_id && blockData.type && !blockData.condition && !blockData.trigger && !blockData.platform);
            if (!isDeviceBlock) return;
            try {
                const reserved = new Set(['device_id', 'domain', 'type', 'trigger', 'platform', 'condition', 'alias', 'enabled', '_invalid_device_extra']);
                if (value.trim()) {
                    const extra = JSON.parse(value);
                    Object.keys(blockData).forEach(k => {
                        if (!reserved.has(k)) delete blockData[k];
                    });
                    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
                        Object.assign(blockData, extra);
                    }
                    delete blockData._invalid_device_extra;
                } else {
                    Object.keys(blockData).forEach(k => {
                        if (!reserved.has(k)) delete blockData[k];
                    });
                    delete blockData._invalid_device_extra;
                }
            } catch (e) {
                blockData._invalid_device_extra = true;
            }
        } else if (name === 'offset') {
            blockData.offset = value;
        } else if (name === 'after_offset') {
            blockData.after_offset = value;
        } else if (name === 'before_offset') {
            blockData.before_offset = value;
        } else if (name === 'timeout') {
            if (value && value !== '00:00:00' && value.trim() !== '') {
                blockData.timeout = value;
            } else {
                delete blockData.timeout;
            }
        } else if (name === 'continue_on_timeout') {
            blockData.continue_on_timeout = input.checked;
        } else if (name === 'error') {
            blockData.error = input.checked;
        } else {
            const internalFields = ['block-alias'];
            if (internalFields.includes(name)) return;
            if (name.startsWith('target.')) return;
            if (value !== '' && value !== undefined) {
                blockData[name] = value;
            }
        }
    });

    // Nested block parsing
    if (blockData.if !== undefined || blockType === 'if') {
        const ifContainer = blockEl.querySelector('.nested-blocks[data-role="if"]');
        const thenContainer = blockEl.querySelector('.nested-blocks[data-role="then"]');
        const elseContainer = blockEl.querySelector('.nested-blocks[data-role="else"]');
        blockData.if = parseNestedBlocks(ifContainer, 'condition');
        blockData.then = parseNestedBlocks(thenContainer, 'action');
        const elseActions = parseNestedBlocks(elseContainer, 'action');
        if (elseActions.length > 0) blockData.else = elseActions;
        else delete blockData.else;
    }

    if (blockData.choose !== undefined || blockType === 'choose') {
        const optionEls = Array.from(blockEl.querySelectorAll('.choose-option'));
        const chooseArr = optionEls.map(optEl => {
            const opt = {};
            const aliasInput = optEl.querySelector('[data-role="choose-option-alias"]');
            const aliasVal = aliasInput ? aliasInput.value.trim() : '';
            if (aliasVal) opt.alias = aliasVal;

            const condContainer = optEl.querySelector('.nested-blocks[data-role="choose-conditions"]');
            const seqContainer = optEl.querySelector('.nested-blocks[data-role="choose-sequence"]');
            const conds = parseNestedBlocks(condContainer, 'condition');
            const seq = parseNestedBlocks(seqContainer, 'action');
            if (conds.length > 0) opt.conditions = conds;
            if (seq.length > 0) opt.sequence = seq;
            return opt;
        });
        blockData.choose = chooseArr;

        const defaultContainer = blockEl.querySelector('.nested-blocks[data-role="choose-default"]');
        const defaultActions = parseNestedBlocks(defaultContainer, 'action');
        if (defaultActions.length > 0) blockData.default = defaultActions;
        else delete blockData.default;
    }

    if (blockData.wait_for_trigger !== undefined || blockType === 'wait_for_trigger') {
        const triggerContainer = blockEl.querySelector('.nested-blocks[data-role="wait-for-trigger"]');
        blockData.wait_for_trigger = parseNestedBlocks(triggerContainer, 'trigger');
    }

    if (blockData.repeat !== undefined || blockType === 'repeat') {
        const modeEl = blockEl.querySelector('[data-role="repeat-mode"]');
        const mode = modeEl ? modeEl.value : null;
        const countEl = blockEl.querySelector('[data-role="repeat-count"]');
        const forEachEl = blockEl.querySelector('[data-role="repeat-for-each"]');
        const whileContainer = blockEl.querySelector('.nested-blocks[data-role="repeat-while"]');
        const untilContainer = blockEl.querySelector('.nested-blocks[data-role="repeat-until"]');
        const sequenceContainer = blockEl.querySelector('.nested-blocks[data-role="repeat-sequence"]');

        const repeatObj = {};

        if (mode === 'count') {
            const val = countEl ? countEl.value : '';
            const num = parseInt(val, 10);
            repeatObj.count = isNaN(num) ? 1 : num;
        } else if (mode === 'while') {
            repeatObj.while = parseNestedBlocks(whileContainer, 'condition');
        } else if (mode === 'until') {
            repeatObj.until = parseNestedBlocks(untilContainer, 'condition');
        } else if (mode === 'for_each') {
            const val = forEachEl ? forEachEl.value.trim() : '';
            if (val) repeatObj.for_each = val;
        } else {
            const val = countEl ? countEl.value : '';
            const num = parseInt(val, 10);
            repeatObj.count = isNaN(num) ? 1 : num;
        }

        const seq = parseNestedBlocks(sequenceContainer, 'action');
        if (seq.length > 0) repeatObj.sequence = seq;

        blockData.repeat = repeatObj;
    }

    if (blockData.parallel !== undefined || blockType === 'parallel') {
        const parallelContainer = blockEl.querySelector('.nested-blocks[data-role="parallel"]');
        blockData.parallel = parseNestedBlocks(parallelContainer, 'action');
    }

    if (blockData.sequence !== undefined || blockType === 'sequence') {
        const sequenceContainer = blockEl.querySelector('.nested-blocks[data-role="sequence"]');
        blockData.sequence = parseNestedBlocks(sequenceContainer, 'action');
    }

    if (blockData.condition === 'and' || blockData.condition === 'or' || blockData.condition === 'not') {
        const condContainer = blockEl.querySelector('.nested-blocks[data-role="conditions"]');
        blockData.conditions = parseNestedBlocks(condContainer, 'condition');
    }

    // Fix: Remove event_data from homeassistant triggers to prevent "extra keys not allowed" errors
    if ((blockData.trigger === 'homeassistant' || blockData.platform === 'homeassistant') && blockData.event_data) {
        delete blockData.event_data;
    }

    // Fix: event_data is only valid for event triggers. Remove it elsewhere (and if null).
    if (isTrigger) {
        const triggerType = blockData.trigger || blockData.platform;
        if (blockData.event_data === null || triggerType !== 'event') {
            delete blockData.event_data;
        }
    }

    return blockData;
}

function updateRepeatVisibility(blockEl) {
    const modeEl = blockEl.querySelector('[data-role="repeat-mode"]');
    if (!modeEl) return;
    const mode = modeEl.value;

    const countRow = blockEl.querySelector('[data-role="repeat-count-row"]');
    const forEachRow = blockEl.querySelector('[data-role="repeat-for-each-row"]');
    const whileSection = blockEl.querySelector('[data-role="repeat-while-section"]');
    const untilSection = blockEl.querySelector('[data-role="repeat-until-section"]');

    const toggle = (el, show) => {
        if (!el) return;
        if (show) el.classList.remove('hidden');
        else el.classList.add('hidden');
    };

    toggle(countRow, mode === 'count');
    toggle(forEachRow, mode === 'for_each');
    toggle(whileSection, mode === 'while');
    toggle(untilSection, mode === 'until');
}

function applyFieldValidation(blockEl) {
    if (!blockEl) return;
    if (state.settings && state.settings.showRequiredBadges === false) {
        blockEl.querySelectorAll('.block-field.invalid').forEach(field => {
            field.classList.remove('invalid');
            const badge = field.querySelector('.required-badge');
            if (badge) badge.remove();
        });
        return;
    }
    const typeKey = blockEl.dataset.blockType || '';
    const isTrigger = blockEl.classList.contains('trigger');
    const isCondition = blockEl.classList.contains('condition');
    const isAction = blockEl.classList.contains('action') || (!isTrigger && !isCondition);

    let required = [];

    if (isTrigger) {
        if (typeKey === 'state') required = ['entity_id'];
        else if (typeKey === 'time') required = ['at'];
        else if (typeKey === 'numeric_state') required = ['entity_id'];
        else if (typeKey === 'event') required = ['event_type'];
        else if (typeKey === 'device') required = ['device_id', 'domain', 'type'];
        else if (typeKey === 'template') required = ['value_template'];
        else if (typeKey === 'zone') required = ['entity_id', 'zone'];
        else if (typeKey === 'mqtt') required = ['topic'];
        else if (typeKey === 'webhook') required = ['webhook_id'];
    } else if (isCondition) {
        if (typeKey === 'state') required = ['entity_id', 'state'];
        else if (typeKey === 'numeric_state') required = ['entity_id'];
        else if (typeKey === 'template') required = ['value_template'];
        else if (typeKey === 'zone') required = ['entity_id', 'zone'];
        else if (typeKey === 'device') required = ['device_id', 'domain', 'type'];
        else if (typeKey === 'trigger') required = ['id'];
    } else if (isAction) {
        if (typeKey === 'service' || typeKey === 'notification') required = ['service'];
        else if (typeKey === 'scene') required = ['scene'];
        else if (typeKey === 'event') required = ['event'];
        else if (typeKey === 'wait_template') required = ['wait_template'];
        else if (typeKey === 'device') required = ['device_id', 'domain', 'type'];
    }

    // Clear old invalid state
    blockEl.querySelectorAll('.block-field.invalid').forEach(field => {
        field.classList.remove('invalid');
        const badge = field.querySelector('.required-badge');
        if (badge) badge.remove();
    });

    required.forEach(name => {
        const input = blockEl.querySelector(`[name="${name}"]`);
        if (!input) return;
        const value = (input.value || '').trim();
        const isEmpty = value === '';
        if (isEmpty) {
            const field = input.closest('.block-field');
            if (field) {
                field.classList.add('invalid');
                if (!field.querySelector('.required-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'required-badge';
                    badge.textContent = 'Required';
                    const label = field.querySelector('label');
                    if (label) label.appendChild(badge);
                }
            }
        }
    });
}

function validateEditorFields() {
    const blocks = document.querySelectorAll('.action-block');
    blocks.forEach(block => applyFieldValidation(block));
    const firstInvalid = document.querySelector('.block-field.invalid');
    return { valid: !firstInvalid, firstInvalid };
}

function createNewItem() {
    const isAutomation = state.currentGroup === 'automations';

    const newItem = {
        id: `new_${Date.now()}`,
        alias: isAutomation ? 'New Automation' : 'New Script',
        description: '',
        mode: 'single',
        enabled: true,
        _type: isAutomation ? 'automation' : 'script'
    };

    if (isAutomation) {
        newItem.triggers = [];
        newItem.conditions = [];
        newItem.actions = [];
    } else {
        newItem.sequence = [];
    }

    state.selectedItem = newItem;
    state.isNewItem = true;
    checkDirty();

    populateEditor(newItem);
    showEditor();

    // Focus on the name field
    elements.editorAlias.focus();
    elements.editorAlias.select();

    // Snapshot for new item
    state.originalItemSnapshot = JSON.stringify(getEditorData());
}

function duplicateItem() {
    if (!state.selectedItem) return;

    const duplicate = JSON.parse(JSON.stringify(state.selectedItem));
    duplicate.id = `${duplicate.id}_copy_${Date.now()}`;
    duplicate.alias = `${duplicate.alias} (Copy)`;

    state.selectedItem = duplicate;
    state.isNewItem = true;
    checkDirty();

    populateEditor(duplicate);
    state.originalItemSnapshot = JSON.stringify(getEditorData());
    showToast('Item duplicated. Save to create the copy.', 'info');
}

// ============================================
// Modal Functions
// ============================================

let currentModalSection = null;
let modalSelectHandler = null;

function getBlockTypeList(section) {
    if (section === 'triggers' || section === 'trigger') return TRIGGER_TYPES;
    if (section === 'conditions' || section === 'condition') return CONDITION_TYPES;
    return ACTION_TYPES;
}

function openAddBlockModal(section) {
    showAddBlockModal(section, (selectedType) => {
        addBlock(section, selectedType);
    });
}

function showAddBlockModal(section, onSelect) {
    currentModalSection = section;
    modalSelectHandler = onSelect;

    const types = getBlockTypeList(section);
    const label = (section === 'triggers' || section === 'trigger') ? 'Trigger' :
        (section === 'conditions' || section === 'condition') ? 'Condition' : 'Action';

    elements.modalSectionType.textContent = label;

    elements.blockTypesGrid.innerHTML = types.map(type => `
        <div class="block-type-option" data-type="${type.id}">
          ${getTypeIcon(type.icon)}
          <span>${type.name}</span>
        </div>
      `).join('');

    elements.blockTypesGrid.querySelectorAll('.block-type-option').forEach(option => {
        option.addEventListener('click', () => {
            if (modalSelectHandler) modalSelectHandler(option.dataset.type);
            closeModal();
        });
    });

    elements.addBlockModal.classList.add('active');
}

function closeModal() {
    elements.addBlockModal.classList.remove('active');
    currentModalSection = null;
    modalSelectHandler = null;
}

function addBlock(section, type) {
    pushToHistory(); // Save state before adding block

    const container = document.getElementById(`${section}-container`);

    // Remove empty state if present
    const emptyState = container.querySelector('.blocks-empty');
    if (emptyState) emptyState.remove();

    // Create new block based on type
    const block = createNewBlock(section, type);
    const blockClass = section === 'triggers' ? 'trigger' :
        section === 'conditions' ? 'condition' : 'action';

    const blockHtml = createBlockHtml(block, blockClass, container.children.length);
    container.insertAdjacentHTML('beforeend', blockHtml);

    // Add event listeners to new block
    const newBlock = container.lastElementChild;
    const header = newBlock.querySelector('.block-header');
    const deleteBtn = newBlock.querySelector('.block-action-btn.delete');

    header.addEventListener('click', (e) => {
        if (!e.target.closest('.block-action-btn')) {
            newBlock.classList.toggle('collapsed');
        }
    });

    deleteBtn.addEventListener('click', () => {
        newBlock.remove();
        checkDirty();
        if (container.children.length === 0) {
            container.innerHTML = `<div class="blocks-empty">No ${section} configured. Click + to add one.</div>`;
        }
        updateYamlView();
    });

    initBlockContextMenu(newBlock);

    checkDirty();
}

function createEmptyBlock(blockType, type) {
    const section = type === 'trigger' ? 'triggers' :
        type === 'condition' ? 'conditions' : 'actions';
    return createNewBlock(section, blockType);
}

function createNewBlock(section, type) {
    // Create template blocks based on type
    if (section === 'triggers') {
        switch (type) {
            case 'state':
                return { trigger: 'state', entity_id: '', to: '' };
            case 'time':
                return { trigger: 'time', at: '00:00:00' };
            case 'sun':
                return { trigger: 'sun', event: 'sunset', offset: '00:00:00' };
            case 'numeric_state':
                return { trigger: 'numeric_state', entity_id: '', above: '', below: '' };
            case 'event':
                return { trigger: 'event', event_type: '' };
            case 'device':
                return { trigger: 'device', device_id: '', domain: '', type: '' };
            case 'template':
                return { trigger: 'template', value_template: '' };
            case 'zone':
                return { trigger: 'zone', entity_id: '', zone: '', event: 'enter' };
            case 'homeassistant':
                return { trigger: 'homeassistant', event: 'start' };
            case 'mqtt':
                return { trigger: 'mqtt', topic: '', payload: '' };
            case 'webhook':
                return { trigger: 'webhook', webhook_id: '' };
            case 'time_pattern':
                return { trigger: 'time_pattern', hours: '*', minutes: '*', seconds: '0' };
            default:
                return { trigger: type };
        }
    }

    if (section === 'conditions') {
        switch (type) {
            case 'state':
                return { condition: 'state', entity_id: '', state: '' };
            case 'numeric_state':
                return { condition: 'numeric_state', entity_id: '', above: '', below: '' };
            case 'time':
                return { condition: 'time', after: '', before: '' };
            case 'sun':
                return { condition: 'sun', after: 'sunrise', before: 'sunset' };
            case 'template':
                return { condition: 'template', value_template: '' };
            case 'zone':
                return { condition: 'zone', entity_id: '', zone: '' };
            case 'device':
                return { condition: 'device', device_id: '', domain: '', type: '' };
            case 'trigger':
                return { condition: 'trigger', id: '' };
            case 'and':
                return { condition: 'and', conditions: [] };
            case 'or':
                return { condition: 'or', conditions: [] };
            case 'not':
                return { condition: 'not', conditions: [] };
            default:
                return { condition: type };
        }
    }

    // Actions
    switch (type) {
        case 'service':
            return { action: '', target: { entity_id: '' } };
        case 'notification':
            return { action: 'notify.notify', data: { message: 'Notification message' } };
        case 'delay':
            return { delay: { seconds: 5 } };
        case 'wait_template':
            return { wait_template: '' };
        case 'wait_for_trigger':
            return { wait_for_trigger: [] };
        case 'condition':
            return { condition: 'state', entity_id: '', state: '' };
        case 'choose':
            return { choose: [] };
        case 'if':
            return { if: [], then: [] };
        case 'repeat':
            return { repeat: { count: 1, sequence: [] } };
        case 'parallel':
            return { parallel: [] };
        case 'sequence':
            return { sequence: [] };
        case 'scene':
            return { scene: '' };
        case 'event':
            return { event: '' };
        case 'variables':
            return { variables: {} };
        case 'stop':
            return { stop: '' };
        case 'device':
            return { device_id: '', domain: '', type: '' };
        default:
            return { action: type };
    }
}

function getTypeIcon(iconName) {
    const icons = {
        toggle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3"/></svg>',
        clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
        zap: '<svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>',
        smartphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
        code: '<svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>',
        hash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
        layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
        'git-branch': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
        play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
        filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
        repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
        'map-pin': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 5-9 12-9 12s-9-7-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7"/><path d="M9 22V12h6v10"/></svg>',
        rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
        link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 1 0-7l2-2a5 5 0 0 1 7 7l-1 1"/><path d="M14 11a5 5 0 0 1 0 7l-2 2a5 5 0 0 1-7-7l1-1"/></svg>',
        target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
        list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
        sunset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v2"/><path d="M4.22 7.22l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M18.36 8.64l1.42-1.42"/><path d="M4 16h16"/><path d="M8 20h8"/><path d="M6 16a6 6 0 0 1 12 0"/></svg>',
        'edit-3': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
        square: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
        bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
        'help-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.82 1c0 2-3 2-3 4"/><line x1="12" y1="17" x2="12" y2="17"/></svg>'
    };

    return icons[iconName] || icons.play;
}

// ============================================
// Utility Functions
// ============================================

// ============================================
// Folder Functions
// ============================================

async function fetchFolders() {
    try {
        const response = await fetch('./api/folders');
        const data = await response.json();
        if (data.success) {
            state.folders = data.folders || [];
            renderFolders();
        }
    } catch (error) {
        console.error('Error fetching folders:', error);
    }
}

async function saveFolders() {
    try {
        const response = await fetch('./api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.folders)
        });
        const data = await response.json();
        if (!data.success) {
            showToast('Error saving folders', 'error');
        }
    } catch (error) {
        console.error('Error saving folders:', error);
    }
}

function renderFolders() {
    if (!elements.folderList) return;

    elements.folderList.innerHTML = state.folders.map(folder => {
        const isActive = String(state.selectedFolder) === String(folder.id);
        return `
            <div class="group-item folder-item ${isActive ? 'active' : ''}" data-folder-id="${folder.id}" role="button" tabindex="0">
                <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <span class="folder-name">${escapeHtml(folder.name)}</span>
                <div class="folder-actions">
                    <button class="folder-action-btn edit-folder" title="Edit Folder" type="button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    elements.folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.folder-action-btn')) return;
            selectFolder(item.dataset.folderId);
        });

        const btnEdit = item.querySelector('.edit-folder');
        btnEdit.addEventListener('click', (e) => {
            e.stopPropagation();
            openFolderEditPopup(item.dataset.folderId);
        });

        // Drag over handler for dropping items into folders
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            item.classList.add('folder-drop-target');
        });
        item.addEventListener('dragleave', () => {
            item.classList.remove('folder-drop-target');
        });
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('folder-drop-target');
            const itemId = e.dataTransfer.getData('item-id') || e.dataTransfer.getData('text/plain');
            console.log('[Drag] Dropped item:', itemId, 'into folder:', item.dataset.folderId);
            if (itemId) {
                addItemToFolder(itemId, item.dataset.folderId);
            }
        });
    });
}

// ============================================
// Tag Group Functions
// ============================================

function loadTagGroups() {
    try {
        const raw = localStorage.getItem('ha-editor-tag-groups');
        state.tagGroups = raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.warn('Failed to load tag groups:', e);
        state.tagGroups = [];
    }
    renderTagGroups();
}

function saveTagGroups() {
    localStorage.setItem('ha-editor-tag-groups', JSON.stringify(state.tagGroups));
}

function renderTagGroups() {
    if (!elements.tagGroupList) return;

    if (!state.tagGroups.length) {
        elements.tagGroupList.innerHTML = '';
        return;
    }

    elements.tagGroupList.innerHTML = state.tagGroups.map(group => {
        const isActive = String(state.selectedTagGroup) === String(group.id);
        return `
            <div class="group-item folder-item tag-group-item ${isActive ? 'active' : ''}" data-tag-group-id="${group.id}" role="button" tabindex="0">
                <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 12V8a2 2 0 0 0-2-2h-4l-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6" />
                    <circle cx="16" cy="16" r="4" />
                </svg>
                <span class="folder-name">${escapeHtml(group.name)}</span>
                <div class="folder-actions">
                    <button class="folder-action-btn edit-tag-group" title="Edit Tag Section" type="button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    elements.tagGroupList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.folder-action-btn')) return;
            selectTagGroup(item.dataset.tagGroupId);
        });

        const btnEdit = item.querySelector('.edit-tag-group');
        btnEdit.addEventListener('click', (e) => {
            e.stopPropagation();
            openTagGroupModal(item.dataset.tagGroupId);
        });
    });
}

function setSearchFilter(text, tags) {
    const uniqueTags = Array.from(new Set(tags.filter(Boolean)));
    const tokens = [];
    if (text) tokens.push(text);
    uniqueTags.forEach(tag => tokens.push(`#${tag}`));
    elements.searchInput.value = tokens.join(' ').trim();
    updateSearchClear();
    loadItems();
    renderTagGroups();
}

function updateSearchClear() {
    if (!elements.searchBox) return;
    const hasValue = (elements.searchInput?.value || '').trim().length > 0;
    elements.searchBox.classList.toggle('has-value', hasValue);
}

function selectTagGroup(groupId) {
    if (!groupId) return;
    if (String(state.selectedTagGroup) === String(groupId)) {
        state.selectedTagGroup = null;
    } else {
        state.selectedTagGroup = groupId;
        state.selectedFolder = null;
        state.selectedItem = null;
    }

    // Update active state in sidebar
    elements.groupItems.forEach(i => i.classList.remove('active'));
    renderFolders();
    renderTagGroups();

    showEmptyState();
    loadItems();
}

let currentEditTagGroupId = null;

function openTagGroupModal(groupId) {
    const modal = document.getElementById('tag-group-modal');
    const nameInput = document.getElementById('tag-group-name');
    const tagsInput = document.getElementById('tag-group-tags');
    const titleEl = document.getElementById('tag-group-title');
    const deleteBtn = document.getElementById('tag-group-delete');

    if (!modal || !nameInput || !tagsInput) return;

    if (groupId === null) {
        currentEditTagGroupId = 'new';
        titleEl.textContent = 'New Tag Section';
        nameInput.value = '';
        tagsInput.value = '';
        deleteBtn.style.display = 'none';
    } else {
        const group = state.tagGroups.find(g => String(g.id) === String(groupId));
        if (!group) return;
        currentEditTagGroupId = groupId;
        titleEl.textContent = 'Edit Tag Section';
        nameInput.value = group.name || '';
        tagsInput.value = (group.tags || []).map(t => `#${t}`).join(' ');
        deleteBtn.style.display = 'inline-flex';
    }

    modal.classList.add('active');
    nameInput.focus();
    nameInput.select();
}

function closeTagGroupModal() {
    currentEditTagGroupId = null;
    const modal = document.getElementById('tag-group-modal');
    if (modal) modal.classList.remove('active');
}

function saveTagGroupFromModal() {
    if (!currentEditTagGroupId) return;

    const nameInput = document.getElementById('tag-group-name');
    const tagsInput = document.getElementById('tag-group-tags');
    const name = nameInput.value.trim();
    const tags = normalizeTagsInput(tagsInput.value).map(t => t.replace(/^#/, '').toLowerCase());

    if (!name) {
        showToast('Tag section name is required', 'error');
        return;
    }
    if (!tags.length) {
        showToast('Add at least one tag', 'error');
        return;
    }

    if (currentEditTagGroupId === 'new') {
        const id = 'tag_group_' + Date.now();
        state.tagGroups.push({ id, name, tags });
        showToast('Tag section created');
    } else {
        const group = state.tagGroups.find(g => String(g.id) === String(currentEditTagGroupId));
        if (group) {
            group.name = name;
            group.tags = tags;
            showToast('Tag section updated');
        }
    }

    saveTagGroups();
    renderTagGroups();
    closeTagGroupModal();
}

function deleteTagGroupFromModal() {
    if (!currentEditTagGroupId || currentEditTagGroupId === 'new') return;

    showConfirm('Are you sure you want to delete this tag section?', () => {
        state.tagGroups = state.tagGroups.filter(g => String(g.id) !== String(currentEditTagGroupId));
        if (String(state.selectedTagGroup) === String(currentEditTagGroupId)) {
            state.selectedTagGroup = null;
        }
        saveTagGroups();
        renderTagGroups();
        closeTagGroupModal();
        showToast('Tag section deleted');
    });
}

function selectFolder(folderId) {
    console.log('[Folders] Selecting folder:', folderId);
    if (String(state.selectedFolder) === String(folderId)) {
        state.selectedFolder = null;
    } else {
        state.selectedFolder = folderId;
        state.selectedTagGroup = null;
    }
    state.selectedItem = null;

    // Update active state in sidebar
    elements.groupItems.forEach(i => i.classList.remove('active'));
    renderFolders();
    renderTagGroups();

    showEmptyState();
    loadItems();
}

function promptCreateFolder() {
    openFolderEditPopup(null); // null = create mode
}

function deleteFolder(folderId) {
    state.folders = state.folders.filter(f => String(f.id) !== String(folderId));
    if (String(state.selectedFolder) === String(folderId)) {
        state.selectedFolder = null;
        state.currentGroup = 'automations';
        const homeBtn = Array.from(elements.groupItems).find(i => i.dataset.group === 'automations');
        if (homeBtn) homeBtn.classList.add('active');
        loadItems();
    }

    saveFolders();
    renderFolders();
    closeFolderEditPopup();
    showToast('Folder deleted');
}

// Folder Edit Popup
let currentEditFolderId = null;

function openFolderEditPopup(folderId) {
    const modal = document.getElementById('folder-edit-modal');
    const nameInput = document.getElementById('folder-edit-name');
    const titleEl = document.getElementById('folder-edit-title');
    const deleteBtn = document.getElementById('folder-edit-delete');

    if (folderId === null) {
        // Create mode
        currentEditFolderId = 'new';
        titleEl.textContent = 'New Folder';
        nameInput.value = '';
        deleteBtn.style.display = 'none';
    } else {
        // Edit mode
        const folder = state.folders.find(f => String(f.id) === String(folderId));
        if (!folder) return;
        currentEditFolderId = folderId;
        titleEl.textContent = 'Edit Folder';
        nameInput.value = folder.name;
        deleteBtn.style.display = 'inline-flex';
    }

    modal.classList.add('active');
    nameInput.focus();
    nameInput.select();
}

function closeFolderEditPopup() {
    currentEditFolderId = null;
    const modal = document.getElementById('folder-edit-modal');
    modal.classList.remove('active');
}

function saveFolderFromPopup() {
    if (!currentEditFolderId) return;

    const nameInput = document.getElementById('folder-edit-name');
    const newName = nameInput.value.trim();
    if (!newName) {
        closeFolderEditPopup();
        return;
    }

    if (currentEditFolderId === 'new') {
        // Create new folder
        const id = 'folder_' + Date.now();
        state.folders.push({ id, name: newName, items: [] });
        saveFolders();
        renderFolders();
        showToast('Folder created');
    } else {
        // Edit existing folder
        const folder = state.folders.find(f => String(f.id) === String(currentEditFolderId));
        if (folder && newName !== folder.name) {
            folder.name = newName;
            saveFolders();
            renderFolders();
            showToast('Folder renamed');
        }
    }

    closeFolderEditPopup();
}

function deleteFolderFromPopup() {
    if (!currentEditFolderId || currentEditFolderId === 'new') return;

    showConfirm('Are you sure you want to delete this folder? Items in the folder will NOT be deleted.', () => {
        deleteFolder(currentEditFolderId);
    });
}

// Custom Confirm Modal
let confirmCallback = null;

function showConfirm(message, onConfirm) {
    confirmCallback = onConfirm;
    document.getElementById('confirm-modal-message').textContent = message;
    document.getElementById('confirm-modal').classList.add('active');
}

function hideConfirm() {
    confirmCallback = null;
    document.getElementById('confirm-modal').classList.remove('active');
}

function handleConfirm() {
    if (confirmCallback) {
        confirmCallback();
    }
    hideConfirm();
}

function addItemToFolder(itemId, folderId) {
    // Remove from other folders first
    state.folders.forEach(f => {
        f.items = f.items.filter(id => String(id) !== String(itemId));
    });

    const folder = state.folders.find(f => String(f.id) === String(folderId));
    if (folder) {
        if (!folder.items.includes(itemId)) {
            folder.items.push(itemId);
        }
        saveFolders();
        showToast(`Moved to ${folder.name}`);

        if (state.selectedFolder) {
            loadItems();
        }
    }
}

function removeItemFromFolders(itemId) {
    let removed = false;
    state.folders.forEach(f => {
        const originalCount = f.items.length;
        f.items = f.items.filter(id => String(id) !== String(itemId));
        if (f.items.length !== originalCount) {
            removed = true;
        }
    });

    if (removed) {
        saveFolders();
        showToast('Removed from folder');
        if (state.selectedFolder) {
            loadItems();
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ============================================
// Undo/Redo Functions
// ============================================

function pushToHistory() {
    if (!state.selectedItem) return;

    // Capture current state from DOM/Model
    const currentData = getEditorData();
    const snapshot = {
        item: JSON.parse(JSON.stringify(currentData)),
        isNewItem: state.isNewItem
    };

    state.history.push(snapshot);
    state.future = []; // Clear redo stack on new change

    // Limit history size
    if (state.history.length > 50) state.history.shift();

    console.log('[History] Pushed state. History size:', state.history.length);
}

function undo() {
    if (state.history.length === 0) {
        showToast('Nothing to undo', 'info');
        return;
    }

    // Save current state to future before undoing
    const currentData = getEditorData();
    const currentSnapshot = {
        item: JSON.parse(JSON.stringify(currentData)),
        isNewItem: state.isNewItem
    };
    state.future.push(currentSnapshot);

    // Restore previous state
    const previous = state.history.pop();
    applyState(previous);

    console.log('[History] Undo performed. History:', state.history.length, 'Future:', state.future.length);
}

function redo() {
    if (state.future.length === 0) {
        showToast('Nothing to redo', 'info');
        return;
    }

    // Save current state to history before redoing
    const currentData = getEditorData();
    const currentSnapshot = {
        item: JSON.parse(JSON.stringify(currentData)),
        isNewItem: state.isNewItem
    };
    state.history.push(currentSnapshot);

    // Restore next state
    const next = state.future.pop();
    applyState(next);

    console.log('[History] Redo performed. History:', state.history.length, 'Future:', state.future.length);
}

function applyState(snapshot) {
    state.selectedItem = snapshot.item;
    state.isNewItem = snapshot.isNewItem;
    checkDirty();

    populateEditor(state.selectedItem);
    showToast('Restored', 'info');
}

// ============================================
// Event Listeners
// ============================================

function initEventListeners() {
    // Editor Alias Auto-Resize
    if (elements.editorAlias) {
        elements.editorAlias.addEventListener('input', () => {
            autoResizeInput(elements.editorAlias);
        });
    }

    // Delegated listeners for Item List
    elements.itemsList.addEventListener('click', (e) => {
        const card = e.target.closest('.item-card');
        if (!card) return;

        // Ignore clicks on buttons inside the card (if any)
        if (e.target.closest('button')) return;

        selectItem(card.dataset.id);
    });

    elements.itemsList.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('.item-card');
        if (!card) return;
        e.preventDefault();
        openItemContextMenu(card, e);
    });

    elements.itemsList.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.item-card');
        if (!card) return;

        console.log('>>> [DRAG START] Item:', card.dataset.id);
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.setData('item-id', card.dataset.id);
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('dragging');
    });

    elements.itemsList.addEventListener('dragend', (e) => {
        const card = e.target.closest('.item-card');
        if (card) card.classList.remove('dragging');
    });

    // Group toggle
    elements.groupItems.forEach(item => {
        item.addEventListener('click', () => {
            elements.groupItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            state.selectedFolder = null;
            state.selectedTagGroup = null;
            state.currentGroup = item.dataset.group;
            renderFolders(); // Update folder active states
            showEmptyState();
            loadItems();
        });

        // Add drop handler to remove items from folders
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            item.classList.add('folder-drop-target');
        });
        item.addEventListener('dragleave', () => {
            item.classList.remove('folder-drop-target');
        });
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('folder-drop-target');
            const itemId = e.dataTransfer.getData('item-id') || e.dataTransfer.getData('text/plain');
            console.log('[Drag] Dropped item:', itemId, 'onto group button:', item.dataset.group);
            if (itemId) {
                removeItemFromFolders(itemId);
            }
        });
    });

    // btnAddFolder handler
    elements.btnAddFolder.addEventListener('click', () => {
        promptCreateFolder();
    });

    // Tag group add handler
    if (elements.btnAddTag) {
        elements.btnAddTag.addEventListener('click', () => {
            openTagGroupModal(null);
        });
    }

    // Tag group modal handlers
    const tagGroupClose = document.getElementById('tag-group-close');
    const tagGroupSave = document.getElementById('tag-group-save');
    const tagGroupDelete = document.getElementById('tag-group-delete');
    const tagGroupName = document.getElementById('tag-group-name');
    const tagGroupTags = document.getElementById('tag-group-tags');
    const tagGroupModal = document.getElementById('tag-group-modal');

    if (tagGroupClose) tagGroupClose.addEventListener('click', closeTagGroupModal);
    if (tagGroupSave) tagGroupSave.addEventListener('click', saveTagGroupFromModal);
    if (tagGroupDelete) tagGroupDelete.addEventListener('click', deleteTagGroupFromModal);
    if (tagGroupModal) {
        tagGroupModal.addEventListener('click', (e) => {
            if (e.target.id === 'tag-group-modal') closeTagGroupModal();
        });
    }
    if (tagGroupName) {
        tagGroupName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveTagGroupFromModal();
            if (e.key === 'Escape') closeTagGroupModal();
        });
    }
    if (tagGroupTags) {
        tagGroupTags.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveTagGroupFromModal();
            if (e.key === 'Escape') closeTagGroupModal();
        });
    }

    // Folder Edit Popup handlers
    document.getElementById('folder-edit-close').addEventListener('click', closeFolderEditPopup);
    document.getElementById('folder-edit-save').addEventListener('click', saveFolderFromPopup);
    document.getElementById('folder-edit-delete').addEventListener('click', deleteFolderFromPopup);
    document.getElementById('folder-edit-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveFolderFromPopup();
        if (e.key === 'Escape') closeFolderEditPopup();
    });
    document.getElementById('folder-edit-modal').addEventListener('click', (e) => {
        if (e.target.id === 'folder-edit-modal') closeFolderEditPopup();
    });

    // Sidebar toggle
    if (elements.btnSidebarToggle) {
        elements.btnSidebarToggle.addEventListener('click', toggleSidebar);
    }

    // History Toggle
    if (elements.btnHistoryToggle) {
        elements.btnHistoryToggle.addEventListener('click', () => {
            state.historyCollapsed = !state.historyCollapsed;
            localStorage.setItem('ha-editor-history-collapsed', state.historyCollapsed);

            // Apply visibility
            const isVisible = !state.historyCollapsed;
            if (elements.panelTrace) elements.panelTrace.style.display = isVisible ? 'flex' : 'none';
            if (elements.dividerTrace) elements.dividerTrace.style.display = isVisible ? 'block' : 'none';

            // Trigger resize to fix layout
            handleResize();

            // If opening and item selected, load traces (if not loaded)
            if (isVisible && state.selectedItem) {
                loadTracesForItem();
            }
        });
    }

    // Confirm Modal handlers
    document.getElementById('confirm-modal-cancel').addEventListener('click', hideConfirm);
    document.getElementById('confirm-modal-confirm').addEventListener('click', handleConfirm);
    document.getElementById('confirm-modal').addEventListener('click', (e) => {
        if (e.target.id === 'confirm-modal') hideConfirm();
    });

    // View toggle
    elements.toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentView = btn.dataset.view;

            if (state.selectedItem) {
                showEditor();
                if (state.currentView === 'yaml') {
                    updateYamlView();
                }
            }
        });
    });

    // Search
    elements.searchInput.addEventListener('input', () => {
        state.selectedTagGroup = null;
        updateSearchClear();
        loadItems();
        renderTagGroups();
    });
    if (elements.searchClear) {
        elements.searchClear.addEventListener('click', () => {
            elements.searchInput.value = '';
            updateSearchClear();
            elements.searchInput.focus();
            elements.searchInput.dispatchEvent(new Event('input'));
        });
    }

    // New button
    elements.btnNew.addEventListener('click', createNewItem);

    // Save button
    elements.btnSave.addEventListener('click', saveItem);

    // Delete button
    elements.btnDelete.addEventListener('click', deleteItem);

    // Run button
    elements.btnRun.addEventListener('click', runSelectedItem);

    if (elements.btnRunSelected) {
        elements.btnRunSelected.addEventListener('click', async () => {
            if (state.selectedActionIndices.size === 0) return;
            await runActionIndices(Array.from(state.selectedActionIndices));
        });
    }

    // Duplicate button
    elements.btnDuplicate.addEventListener('click', duplicateItem);

    // Add block buttons
    document.querySelectorAll('.btn-add-item').forEach(btn => {
        btn.addEventListener('click', () => {
            openAddBlockModal(btn.dataset.section);
        });
    });

    // Paste block buttons
    document.querySelectorAll('.btn-paste-item').forEach(btn => {
        btn.addEventListener('click', () => {
            handlePasteBlock(btn.dataset.section);
        });
    });



    // Modal close
    elements.addBlockModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    elements.addBlockModal.querySelector('.modal-close').addEventListener('click', closeModal);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        const isTextInput = activeEl && (
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'INPUT' ||
            activeEl.isContentEditable
        );

        // List navigation (automations/scripts)
        if (!isTextInput && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveListSelection(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveListSelection(-1);
                return;
            }
        }

        // Escape to close modals
        if (e.key === 'Escape') {
            if (elements.addBlockModal.classList.contains('active')) {
                closeModal();
            }
            if (elements.settingsModal.classList.contains('active')) {
                closeSettingsModal();
            }
        }

        // Cmd/Ctrl+S to save
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            if (state.selectedItem) {
                saveItem();
            }
        }

        // Undo/Redo - allow native behavior in textareas and inputs
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            // If focused on a text input, let native undo/redo work
            if (isTextInput) {
                // Don't prevent default - let browser handle it
                return;
            }

            // Otherwise use custom undo/redo for visual editor
            e.preventDefault();
            if (e.shiftKey) {
                redo();
            } else {
                undo();
            }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
            // If focused on a text input, let native redo work
            if (isTextInput) {
                return;
            }

            e.preventDefault();
            redo();
        }
    });

    // Track changes
    elements.editorAlias.addEventListener('input', () => { checkDirty(); });
    elements.editorDescription.addEventListener('input', () => { checkDirty(); });
    if (elements.editorTags) {
        elements.editorTags.addEventListener('input', () => {
            updateEditorTagsPreview();
            checkDirty();
            scheduleTagsAutosave();
        });
    }
    if (elements.editorTagsInline) {
        elements.editorTagsInline.addEventListener('click', (e) => {
            if (!elements.editorTags) return;
            const removeBtn = e.target.closest('.editor-tag-remove');
            if (removeBtn) {
                const tag = removeBtn.dataset.tag;
                if (!tag) return;
                const current = normalizeTagsInput(elements.editorTags.value);
                const next = current.filter(t => t !== tag);
                elements.editorTags.value = next.join(' ');
                updateEditorTagsPreview();
                checkDirty();
                scheduleTagsAutosave();
                return;
            }

            const tagText = e.target.closest('.editor-tag-text');
            const tagEl = e.target.closest('.editor-tag');
            if (tagText && tagEl) {
                const tagValue = tagEl.dataset.tag || '';
                startInlineTagEdit(tagEl, tagValue);
            }
        });
    }
    if (elements.editorTagsAdd && elements.editorTagsInput) {
        elements.editorTagsAdd.addEventListener('click', () => {
            elements.editorTagsInput.style.display = 'block';
            elements.editorTagsInput.focus();
        });
        elements.editorTagsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTagsFromInput();
                elements.editorTagsInput.value = '';
                elements.editorTagsInput.style.display = 'none';
                checkDirty();
            }
            if (e.key === 'Escape') {
                elements.editorTagsInput.value = '';
                elements.editorTagsInput.style.display = 'none';
            }
        });
        elements.editorTagsInput.addEventListener('blur', () => {
            addTagsFromInput();
            elements.editorTagsInput.value = '';
            elements.editorTagsInput.style.display = 'none';
            checkDirty();
        });
    }
    // Live toggle state (on change, immediately call API)
    elements.editorEnabled.addEventListener('change', async () => {
        checkDirty();

        // Update toggle label
        const toggleLabel = elements.editorEnabled.closest('.enabled-toggle').querySelector('.toggle-label');
        if (toggleLabel) {
            toggleLabel.textContent = elements.editorEnabled.checked ? 'Enabled' : 'Disabled';
        }

        if (!state.selectedItem || state.isNewItem) return;

        const domain = state.currentGroup === 'automations' ? 'automation' : 'script';
        const itemId = state.selectedItem.id;
        const entityId = state.selectedItem.entity_id;
        const enabled = elements.editorEnabled.checked;

        try {
            const response = await fetch(`./api/run/${domain}/${encodeURIComponent(itemId)}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity_id: entityId, enabled: enabled })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server returned ${response.status}`);
            }

            const result = await response.json();
            if (result.success) {
                showToast(`${state.currentGroup === 'automations' ? 'Automation' : 'Script'} ${enabled ? 'enabled' : 'disabled'}`, 'success');
                // Update local list state
                const currentItem = (state.currentGroup === 'automations' ? state.automations : state.scripts)
                    .find(i => String(i.id) === String(itemId));
                if (currentItem) {
                    currentItem.enabled = enabled;
                    renderItemsList(state.currentGroup === 'automations' ? state.automations : state.scripts);
                }
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            console.error('[Toggle] Error:', error);
            showToast(`Failed to toggle: ${error.message || 'Check logs'}`, 'error');
            // Revert UI toggle if failed
            elements.editorEnabled.checked = !enabled;
            const toggleLabel = elements.editorEnabled.closest('.enabled-toggle').querySelector('.toggle-label');
            if (toggleLabel) toggleLabel.textContent = !enabled ? 'Enabled' : 'Disabled';
        }
    });

    // Track changes with history
    const mainInputs = [elements.editorAlias, elements.editorDescription, elements.yamlContent];
    mainInputs.forEach(input => {
        let snapshot = null;
        input.addEventListener('focus', () => {
            snapshot = {
                item: JSON.parse(JSON.stringify(getEditorData())),
                isNewItem: state.isNewItem
            };
        });
        input.addEventListener('blur', () => {
            if (snapshot && state.isDirty) { // Simple check if dirty
                // Better check: compare value? 
                // state.isDirty is set on 'input', so if true, likely changed.
                // But we want to be sure we don't push duplicate states if user focused but didn't type.
                // Actually, getEditorData() inside snapshot has the OLD value.
                // So we can just push it if current value != snapshot value?
                // But getEditorData() is complex.

                // Let's rely on a simpler 'changed' flag
            }
        });

        // Simpler approach: Use the same pattern as alias
        let startVal = '';
        input.addEventListener('focus', () => {
            startVal = input.value;
            snapshot = {
                item: JSON.parse(JSON.stringify(getEditorData())),
                isNewItem: state.isNewItem
            };
        });

        input.addEventListener('blur', () => {
            if (input.value !== startVal && snapshot) {
                state.history.push(snapshot);
                state.future = [];
                if (state.history.length > 50) state.history.shift();
                console.log('[History] Pushed state (main input)');
            }
        });

        input.addEventListener('input', () => { checkDirty(); });
    });

    // Listen for custom picker-change events from EntityPicker and DurationPicker components
    document.addEventListener('picker-change', (e) => {
        state.isDirty = true;
        updateSaveButtonStatus(true);
        const block = e.target.closest('.action-block');
        if (block) refreshBlockTitle(block);
    });

    // Global listener for regular input changes within blocks to update titles live
    document.addEventListener('input', (e) => {
        const block = e.target.closest('.action-block');
        if (block && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
            refreshBlockTitle(block);
        }
    });

    // Live toggle state (on change, immediately call API)

    // Settings button
    elements.btnSettings.addEventListener('click', openSettingsModal);

    // Theme toggle checkbox
    if (elements.settingDarkMode) {
        elements.settingDarkMode.addEventListener('change', toggleTheme);
    }

    // Settings modal close
    elements.settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettingsModal);
    elements.settingsModal.querySelector('.modal-close').addEventListener('click', closeSettingsModal);

    // Settings - Collapse blocks toggle
    elements.settingCollapseBlocks.checked = state.settings.collapseBlocksByDefault;
    elements.settingCollapseBlocks.addEventListener('change', (e) => {
        state.settings.collapseBlocksByDefault = e.target.checked;
        localStorage.setItem('ha-editor-collapse-blocks', e.target.checked);
    });

    // Settings - Color Mode toggle
    if (elements.settingColorMode) {
        elements.settingColorMode.checked = state.settings.colorModeEnabled;
        // Apply initial state
        if (state.settings.colorModeEnabled) {
            document.body.classList.add('color-mode');
        } else {
            document.body.classList.remove('color-mode');
        }
        elements.settingColorMode.addEventListener('change', (e) => {
            state.settings.colorModeEnabled = e.target.checked;
            localStorage.setItem('ha-editor-color-mode', e.target.checked);
            if (e.target.checked) {
                document.body.classList.add('color-mode');
            } else {
                document.body.classList.remove('color-mode');
            }
        });
    }

    // Settings - Mini list mode toggle
    if (elements.settingMiniList) {
        elements.settingMiniList.checked = state.settings.miniListMode;
        elements.panelMiddle.classList.toggle('mini-list', state.settings.miniListMode);
        elements.settingMiniList.addEventListener('change', (e) => {
            state.settings.miniListMode = e.target.checked;
            localStorage.setItem('ha-editor-mini-list', e.target.checked);
            elements.panelMiddle.classList.toggle('mini-list', e.target.checked);
        });
    }

    // Replay controls
    if (elements.replayPrev) {
        elements.replayPrev.addEventListener('click', () => navigateReplayStep(-1));
    }
    if (elements.replayNext) {
        elements.replayNext.addEventListener('click', () => navigateReplayStep(1));
    }
    if (elements.replayExit) {
        elements.replayExit.addEventListener('click', exitReplayMode);
    }

    updatePasteButtonsVisibility();

    // Global click listener for deselection
    document.addEventListener('click', (e) => {
        // Only trigger if we have a selection
        if (state.selectedActionIndices.size === 0) return;

        // Don't deselect if clicking on:
        // 1. An action block
        // 2. A block menu trigger or context menu
        // 3. Various interactive UI components
        const isActionBlock = e.target.closest('.action-block');
        const isMenuTrigger = e.target.closest('.block-menu-trigger');
        const isContextMenuItem = e.target.closest('.block-context-menu');
        const isHistoryPanel = e.target.closest('.trace-panel');
        const isVersionNav = e.target.closest('.version-nav');
        const isModal = e.target.closest('.modal-content, .settings-content, .folder-edit-popup, #confirm-modal, #block-yaml-modal');

        if (!isActionBlock && !isMenuTrigger && !isContextMenuItem && !isHistoryPanel && !isVersionNav && !isModal) {
            clearActionSelection();
        }
    });
}

// ============================================
// Block Context Menu Actions
// ============================================

async function openBlockYamlModal(blockData, onSave) {
    const modal = document.getElementById('block-yaml-modal');
    const textarea = document.getElementById('block-yaml-content');
    const saveBtn = document.getElementById('block-yaml-save');
    const closeBtns = modal.querySelectorAll('.modal-close, .modal-footer-close');
    YamlEditor.enableIndentation(textarea);

    // Convert block data to YAML
    try {
        const response = await fetch('./api/dump-yaml', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: blockData })
        });
        const data = await response.json();

        if (data.success) {
            textarea.value = data.yaml;
        } else {
            textarea.value = '# Error generating YAML\n' + JSON.stringify(blockData, null, 2);
        }
    } catch (e) {
        textarea.value = '# Error generating YAML\n' + JSON.stringify(blockData, null, 2);
    }

    modal.classList.add('active');

    // Handle Save
    const handleSave = () => {
        onSave(textarea.value);
        closeModal();
    };

    const closeModal = () => {
        modal.classList.remove('active');
        saveBtn.removeEventListener('click', handleSave);
        closeBtns.forEach(b => b.removeEventListener('click', closeModal));
    };

    saveBtn.addEventListener('click', handleSave);
    closeBtns.forEach(b => b.addEventListener('click', closeModal));
    modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
}

async function updateBlockFromYaml(index, section, yamlContent) {
    try {
        const response = await fetch('./api/parse-yaml', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml: yamlContent })
        });
        const data = await response.json();

        if (data.success && data.config) {
            // Handle valid parsed YAML
            if (Array.isArray(data.config)) {
                // If snippet parsed as array (e.g. " - service: ..."), take first item
                if (data.config.length > 0) {
                    updateBlockData(section, index, data.config[0]);
                }
            } else {
                // Object
                updateBlockData(section, index, data.config);
            }
            // showToast('Block updated from YAML', 'success');
        } else {
            showToast('Invalid YAML: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Failed to parse YAML', 'error');
    }
}

function updateBlockData(section, index, newData) {
    if (!state.selectedItem) return;

    if (section === 'triggers') {
        state.selectedItem.triggers[index] = newData;
        // Re-render
        renderBlocks('triggers', state.selectedItem.triggers);
    } else if (section === 'conditions') {
        state.selectedItem.conditions[index] = newData;
        renderBlocks('conditions', state.selectedItem.conditions);
    } else {
        // Actions
        if (state.currentGroup === 'automations') {
            state.selectedItem.actions[index] = newData;
            renderBlocks('actions', state.selectedItem.actions);
        } else {
            state.selectedItem.sequence[index] = newData;
            renderBlocks('actions', state.selectedItem.sequence);
        }
    }
    checkDirty();
    updateYamlView();
}

async function runBlock(blockData) {
    // Extract service data
    // Block structure: { action: 'service.name', data: {}, target: {} } (modern)
    // or { service: 'service.name', ... } (legacy)

    let service = blockData.action || blockData.service;
    let serviceData = blockData.data || {};
    let target = blockData.target || {};

    if (!service) {
        // Maybe it's a notification block disguised?
        // Note: For complex blocks like 'choose', 'if', this simple runner won't work well
        // We only support direct service calls for now.
        showToast('Cannot run this block type directly', 'warning');
        return;
    }

    const normalizeTarget = (t) => {
        const out = {};
        if (!t || typeof t !== 'object') return out;
        const keys = ['entity_id', 'device_id', 'area_id'];
        keys.forEach(key => {
            const val = t[key];
            if (Array.isArray(val) && val.length > 0) out[key] = val;
            else if (typeof val === 'string' && val.trim() !== '') out[key] = val;
        });
        return out;
    };

    try {
        // We need to construct a robust payload.
        // We can re-use the /api/call_service endpoint if it exists, or create a generic one.
        // The existing /api/run endpoint is for automation/script_entities.
        // Let's use a new or existing service call endpoint.
        // Checking `fieldComponents.js` or `server.js`... `server.js` usually has `/api/service/call`?
        // Let's assume we need to POST to `/api/call_service` which mirrors HA's service call.

        // Wait, earlier I saw `callService` logic. Let's try to assume we can add a simple endpoint if needed.
        // But for now, let's use the one that must exist for the "Run" button?
        // Ah, the main "Run" button runs the whole automation/script.

        // I'll call a dedicated endpoint `POST /api/execute-action` which simply passes the config to HA's `hass.callService` or similar?
        // Actually, easiest is `POST /api/services/{domain}/{service}`.

        const [domain, serviceName] = service.split('.');

        if (typeof serviceData === 'string') {
            try {
                serviceData = JSON.parse(serviceData);
            } catch (e) {
                serviceData = {};
            }
        }
        const cleanedTarget = normalizeTarget(target);
        const payloadData = { ...(serviceData || {}), ...cleanedTarget };

        const payload = {
            domain,
            service: serviceName,
            serviceData: payloadData
        };

        const res = await fetch('./api/execute_service', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await res.json();

        if (result.success) {
            showToast('Action executed successfully', 'success');
        } else {
            showToast('Failed to execute: ' + result.error, 'error');
        }

    } catch (e) {
        showToast('Error executing action: ' + e.message, 'error');
    }
}

async function runActionIndices(indices) {
    const actions = getBlocksData('actions');
    const unique = Array.from(new Set(indices)).filter(i => i >= 0 && i < actions.length);
    if (unique.length === 0) return;

    for (const idx of unique) {
        await runBlock(actions[idx]);
    }
}

// ============================================
// Resizing Functions
// ============================================

function initResizers() {
    elements.dividers.forEach(divider => {
        divider.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent text selection
            const id = divider.dataset.id;
            const startX = e.clientX;

            // Get initial widths
            const sidebarWidth = elements.sidebarLeft.offsetWidth;
            const middleWidth = elements.panelMiddle.textContent ? elements.panelMiddle.offsetWidth : 0;
            const traceWidth = elements.panelTrace.offsetWidth;

            divider.classList.add('active');
            document.body.classList.add('resizing');

            const onMouseMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;

                if (id === 'sidebar') {
                    const newWidth = Math.max(110, Math.min(500, sidebarWidth + deltaX));
                    elements.sidebarLeft.style.width = `${newWidth}px`;
                    localStorage.setItem('ha-editor-sidebar-width', newWidth);
                } else if (id === 'editor') {
                    const newWidth = Math.max(220, Math.min(600, middleWidth + deltaX));
                    elements.panelMiddle.style.width = `${newWidth}px`;
                    localStorage.setItem('ha-editor-middle-width', newWidth);

                    // Toggle compact mode for header
                    if (newWidth < 290) {
                        elements.panelMiddle.classList.add('compact');
                    } else {
                        elements.panelMiddle.classList.remove('compact');
                    }
                } else if (id === 'trace') {
                    const newWidth = Math.max(150, Math.min(600, traceWidth - deltaX));
                    elements.panelTrace.style.width = `${newWidth}px`;
                    localStorage.setItem('ha-editor-trace-width', newWidth);
                }
            };

            const onMouseUp = () => {
                divider.classList.remove('active');
                document.body.classList.remove('resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function loadPanelWidths() {
    const sidebarWidth = localStorage.getItem('ha-editor-sidebar-width');
    const middleWidth = localStorage.getItem('ha-editor-middle-width');
    const traceWidth = localStorage.getItem('ha-editor-trace-width');

    if (sidebarWidth) elements.sidebarLeft.style.width = `${sidebarWidth}px`;
    if (middleWidth) {
        elements.panelMiddle.style.width = `${middleWidth}px`;
        if (parseInt(middleWidth) < 290) {
            elements.panelMiddle.classList.add('compact');
        }
    }
    if (traceWidth) elements.panelTrace.style.width = `${traceWidth}px`;
}

// ============================================
// Settings Functions
// ============================================

function openSettingsModal() {
    elements.settingsModal.classList.add('active');
}

function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
}

// ============================================
// Theme Functions
// ============================================

function initTheme() {
    // Check localStorage first, then system preference
    const savedTheme = localStorage.getItem('ha-editor-theme');
    let isDark = true; // Default to dark

    if (savedTheme === 'light') {
        isDark = false;
    } else if (savedTheme === 'dark') {
        isDark = true;
    } else {
        // Use system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            isDark = false;
        }
    }

    if (!isDark) {
        document.body.classList.add('light-theme');
    }

    // Sync settings checkbox
    if (elements.settingDarkMode) {
        elements.settingDarkMode.checked = isDark;
    }
}

function toggleTheme() {
    // If called from checkbox event
    let isDark;
    if (this && this.type === 'checkbox') {
        isDark = this.checked;
    } else {
        // Fallback (shouldn't be needed with checkbox)
        isDark = !document.body.classList.contains('light-theme');
    }

    if (isDark) {
        document.body.classList.remove('light-theme');
    } else {
        document.body.classList.add('light-theme');
    }

    // Update checkbox state if changed programmatically or via toggle
    if (elements.settingDarkMode && elements.settingDarkMode.checked !== isDark) {
        elements.settingDarkMode.checked = isDark;
    }

    localStorage.setItem('ha-editor-theme', isDark ? 'dark' : 'light');
}

function initSidebar() {
    if (state.sidebarCollapsed) {
        elements.sidebarLeft.classList.add('collapsed');
        if (elements.dividerSidebar) elements.dividerSidebar.classList.add('hidden');
        if (elements.btnSidebarToggle) elements.btnSidebarToggle.classList.add('collapsed');
    }
}

function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    elements.sidebarLeft.classList.toggle('collapsed', state.sidebarCollapsed);
    if (elements.dividerSidebar) elements.dividerSidebar.classList.toggle('hidden', state.sidebarCollapsed);
    if (elements.btnSidebarToggle) elements.btnSidebarToggle.classList.toggle('collapsed', state.sidebarCollapsed);
    localStorage.setItem('ha-editor-sidebar-collapsed', state.sidebarCollapsed);
}

// ============================================
// Initialize
// ============================================

// UI Tweaker Initialization
function initUITweaker() {
    console.log('Initializing UI Tweaker...');
    const tweaker = document.getElementById('ui-tweaker');
    if (!tweaker) {
        console.error('UI Tweaker element not found!');
        return;
    }

    const header = tweaker.querySelector('.tweaker-header');
    const toggle = tweaker.querySelector('.tweaker-toggle');
    const resetBtn = tweaker.querySelector('.tweaker-reset');
    // Select all range and color inputs within the tweaker
    const inputs = tweaker.querySelectorAll('input[type="range"], input[type="color"]');

    console.log(`Found ${inputs.length} tweakable inputs.`);

    // Tabs
    const tabs = tweaker.querySelectorAll('.tweaker-tab');
    const contents = tweaker.querySelectorAll('.tweaker-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            contents.forEach(c => {
                c.classList.remove('active');
                if (c.id === `tweaker-tab-${target}`) {
                    c.classList.add('active');
                }
            });
        });
    });

    // Toggle Minimize
    const toggleMinimize = (e) => {
        e.stopPropagation(); // Prevent header click handling if button clicked
        // Don't minimize if clicking reset
        if (e.target.closest('.tweaker-reset')) return;

        tweaker.classList.toggle('minimized');

        // Save state
        const isMinimized = tweaker.classList.contains('minimized');
        localStorage.setItem('uiTweakerMinimized', isMinimized);

        // Rotate icon
        toggle.style.transform = isMinimized ? 'rotate(180deg)' : 'rotate(0deg)';
    };

    header.addEventListener('click', toggleMinimize);
    toggle.addEventListener('click', toggleMinimize);

    // Reset to Defaults
    resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        inputs.forEach(input => {
            const varName = input.dataset.var;
            const unit = input.dataset.unit || '';
            const labelValue = input.parentElement.querySelector('.tweaker-value');

            // 1. Remove inline style override
            document.documentElement.style.removeProperty(varName);

            // 2. Remove saved value
            localStorage.removeItem(`uiTweaker_${varName}`);

            // 3. Read the actual computed style (which is now the CSS default)
            const computedStyle = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();

            // 4. Update Input and Label
            if (input.type === 'color') {
                // Convert RGB to Hex for color input
                const rgbToHex = (rgb) => {
                    if (!rgb || rgb === 'transparent') return '#000000';
                    if (rgb.startsWith('#')) return rgb;
                    const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                    if (!match) return '#000000';
                    return "#" + match.slice(1, 4).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                };
                const hex = rgbToHex(computedStyle);
                input.value = hex;
                // Don't show text for colors
            } else {
                const numericValue = parseFloat(computedStyle);
                if (!isNaN(numericValue)) {
                    input.value = numericValue;
                    if (labelValue) labelValue.textContent = numericValue + unit;
                }
            }
        });
    });

    // Copy Settings to Clipboard
    const copyBtn = tweaker.querySelector('.tweaker-copy');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            let cssOutput = ':root {\n';
            inputs.forEach(input => {
                const varName = input.dataset.var;
                const unit = input.dataset.unit || '';
                const displayValue = input.value + unit;
                cssOutput += `  ${varName}: ${displayValue};\n`;
            });
            cssOutput += '}';

            // Use Clipboard API if available
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(cssOutput).then(() => {
                    showToast('Settings copied to clipboard!', 'success');
                }).catch((err) => {
                    console.error('Clipboard API failed:', err);
                    fallbackCopyTextToClipboard(cssOutput);
                });
            } else {
                fallbackCopyTextToClipboard(cssOutput);
            }

            function fallbackCopyTextToClipboard(text) {
                const textArea = document.createElement("textarea");
                textArea.value = text;

                // Ensure it's not visible but part of DOM
                textArea.style.position = 'fixed'; // Avoid scrolling to bottom
                textArea.style.left = '-9999px';
                textArea.style.top = '0';

                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                try {
                    const successful = document.execCommand('copy');
                    const msg = successful ? 'successful' : 'unsuccessful';
                    if (successful) {
                        showToast('Settings copied to clipboard!', 'success');
                    } else {
                        showToast('Failed to copy settings (fallback)', 'error');
                    }
                } catch (err) {
                    console.error('Fallback: Oops, unable to copy', err);
                    showToast('Failed to copy settings', 'error');
                }

                document.body.removeChild(textArea);
            }
        });
    }

    // Special handling for Version Nav Dimming
    const dimToggle = document.getElementById('tweak-nav-dim-enabled');
    if (dimToggle) {
        // Load state
        const isDimEnabled = localStorage.getItem('uiTweaker_dimEnabled') === 'true';
        dimToggle.checked = isDimEnabled;
        const nav = document.querySelector('.version-nav');
        if (nav) nav.classList.toggle('dim-enabled', isDimEnabled);

        dimToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            localStorage.setItem('uiTweaker_dimEnabled', enabled);
            const nav = document.querySelector('.version-nav');
            if (nav) nav.classList.toggle('dim-enabled', enabled);
        });
    }

    // Load Minimize State
    if (localStorage.getItem('uiTweakerMinimized') === 'true') {
        tweaker.classList.add('minimized');
        toggle.style.transform = 'rotate(180deg)';
    }

    let hoveredSlider = null;

    // Global arrow key support for hovered slider
    document.addEventListener('keydown', (e) => {
        if (!hoveredSlider || hoveredSlider.type !== 'range') return;

        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            const step = parseFloat(hoveredSlider.step) || 1;
            // Right/Up = Increase, Left/Down = Decrease
            const direction = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : -1;

            hoveredSlider.value = parseFloat(hoveredSlider.value) + (step * direction);
            hoveredSlider.dispatchEvent(new Event('input'));
        }
    });

    // Handle Input Changes
    inputs.forEach(input => {
        const varName = input.dataset.var;
        const unit = input.dataset.unit || '';
        const labelValue = input.parentElement.querySelector('.tweaker-value');

        // Hover tracking
        input.addEventListener('mouseenter', () => hoveredSlider = input);
        input.addEventListener('mouseleave', () => hoveredSlider = null);

        // Scroll wheel support
        if (input.type === 'range') {
            input.addEventListener('wheel', (e) => {
                e.preventDefault();
                const step = parseFloat(input.step) || 1;
                // Scroll Up (negative delta) = Increase
                const direction = e.deltaY < 0 ? 1 : -1;

                input.value = parseFloat(input.value) + (step * direction);
                input.dispatchEvent(new Event('input'));
            }, { passive: false });
        }

        // Load saved value if exists
        const savedValue = localStorage.getItem(`uiTweaker_${varName}`);
        if (savedValue) {
            input.value = savedValue;
            document.documentElement.style.setProperty(varName, savedValue + unit);
            if (labelValue) labelValue.textContent = savedValue + unit;
        }

        input.addEventListener('input', (e) => {
            const value = e.target.value;
            document.documentElement.style.setProperty(varName, value + unit);
            if (labelValue) labelValue.textContent = value + unit;

            // Save value
            localStorage.setItem(`uiTweaker_${varName}`, value);
        });
    });
}

async function init() {
    updateSaveButtonStatus(state.isDirty);
    initTheme();
    initSidebar();
    loadTagGroups();
    initUITweaker();   // Initialize UI Tweaker
    initEventListeners();
    initResizers();
    loadPanelWidths();
    updateSearchClear();

    // Check if Version Control addon is available
    await checkVersionControlStatus();
    initVersionNavStyle();

    // Fetch both counts on startup (in parallel)
    const [automations, scripts] = await Promise.all([
        fetchAutomations(),
        fetchScripts()
    ]);

    // Load the current group's items with full HA state info
    await loadItems();
    showEmptyState();
}

// Start the app
init();
