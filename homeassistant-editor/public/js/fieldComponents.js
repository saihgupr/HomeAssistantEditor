/**
 * Field Components - Reusable input components for block fields
 * EntityPicker, ServicePicker, DurationPicker, etc.
 */

// ============================================
// Entity Cache - Shared across all pickers
// ============================================

const entityCache = {
    entities: [],
    loaded: false,
    loading: false,
    callbacks: [],

    async load() {
        if (this.loaded) return this.entities;
        if (this.loading) {
            return new Promise(resolve => this.callbacks.push(resolve));
        }

        this.loading = true;
        try {
            const res = await fetch('/api/entities');
            const data = await res.json();
            if (data.success) {
                this.entities = data.entities;
                this.loaded = true;
            }
        } catch (e) {
            console.error('Failed to load entities:', e);
        }
        this.loading = false;

        // Resolve waiting callbacks
        this.callbacks.forEach(cb => cb(this.entities));
        this.callbacks = [];

        return this.entities;
    },

    search(query, domainFilter = null) {
        const q = query.toLowerCase();
        let results = this.entities;

        if (domainFilter) {
            results = results.filter(e => e.domain === domainFilter);
        }

        if (!q) return results.slice(0, 50); // Limit initial results

        return results.filter(e =>
            e.entity_id.toLowerCase().includes(q) ||
            e.friendly_name.toLowerCase().includes(q)
        ).slice(0, 20); // Limit search results
    }
};

// ============================================
// Service Cache - Shared across Service Pickers
// ============================================

const serviceCache = {
    services: [],
    loaded: false,
    loading: false,
    callbacks: [],

    async load() {
        if (this.loaded) return this.services;
        if (this.loading) {
            return new Promise(resolve => this.callbacks.push(resolve));
        }

        this.loading = true;
        try {
            const res = await fetch('/api/services');
            const data = await res.json();
            if (data.success) {
                this.services = data.services;
                this.loaded = true;
            }
        } catch (e) {
            console.error('Failed to load services:', e);
        }
        this.loading = false;

        // Resolve waiting callbacks
        this.callbacks.forEach(cb => cb(this.services));
        this.callbacks = [];

        return this.services;
    },

    search(query, domainFilter = null) {
        const q = query.toLowerCase();
        let results = this.services;

        if (domainFilter) {
            results = results.filter(s => s.domain === domainFilter);
        }

        if (!q) return results.slice(0, 50);

        return results.filter(s =>
            s.service_id.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q)
        ).slice(0, 20);
    }
};

// ============================================
// Device Cache - Shared across Device Pickers
// ============================================

const deviceCache = {
    devices: [],
    loaded: false,
    loading: false,
    callbacks: [],

    async load() {
        if (this.loaded) return this.devices;
        if (this.loading) {
            return new Promise(resolve => this.callbacks.push(resolve));
        }

        this.loading = true;
        try {
            const res = await fetch('/api/devices');
            const data = await res.json();
            if (data.success) {
                this.devices = data.devices;
                this.loaded = true;
            }
        } catch (e) {
            console.error('Failed to load devices:', e);
        }
        this.loading = false;

        this.callbacks.forEach(cb => cb(this.devices));
        this.callbacks = [];

        return this.devices;
    },

    search(query) {
        const q = query.toLowerCase();
        if (!q) return this.devices.slice(0, 50);
        return this.devices.filter(d =>
            (d.name || '').toLowerCase().includes(q) ||
            (d.device_id || '').toLowerCase().includes(q) ||
            (d.manufacturer || '').toLowerCase().includes(q) ||
            (d.model || '').toLowerCase().includes(q)
        ).slice(0, 20);
    }
};

// ============================================
// Area Cache - Shared across Area Pickers
// ============================================

const areaCache = {
    areas: [],
    loaded: false,
    loading: false,
    callbacks: [],

    async load() {
        if (this.loaded) return this.areas;
        if (this.loading) {
            return new Promise(resolve => this.callbacks.push(resolve));
        }

        this.loading = true;
        try {
            const res = await fetch('/api/areas');
            const data = await res.json();
            if (data.success) {
                this.areas = data.areas;
                this.loaded = true;
            }
        } catch (e) {
            console.error('Failed to load areas:', e);
        }
        this.loading = false;

        this.callbacks.forEach(cb => cb(this.areas));
        this.callbacks = [];

        return this.areas;
    },

    search(query) {
        const q = query.toLowerCase();
        if (!q) return this.areas.slice(0, 50);
        return this.areas.filter(a =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.area_id || '').toLowerCase().includes(q)
        ).slice(0, 20);
    }
};

// ============================================
// Entity Picker Component
// ============================================

function createEntityPicker(name, value, options = {}) {
    const {
        domainFilter = null,
        placeholder = 'Search entities...',
        multiple = false,
        onSelect = null
    } = options;

    const id = `entity-picker-${name}-${Date.now()}`;
    const values = multiple ? (Array.isArray(value) ? value : (value ? value.split(',').map(v => v.trim()) : [])) : [];
    const singleValue = !multiple ? (value || '') : '';

    const html = `
        <div class="entity-picker" data-name="${name}" data-multiple="${multiple}" data-domain="${domainFilter || ''}" id="${id}">
            ${multiple ? `
                <div class="entity-picker-tags">
                    ${values.map(v => `<span class="entity-tag">${escapeHtml(v)}<button class="tag-remove" data-value="${escapeHtml(v)}">&times;</button></span>`).join('')}
                </div>
            ` : ''}
            <div class="entity-picker-input-wrapper">
                <input type="text" 
                    class="entity-picker-input" 
                    placeholder="${placeholder}"
                    value="${multiple ? '' : escapeHtml(singleValue)}"
                    autocomplete="off" 
                    autocorrect="off" 
                    autocapitalize="off" 
                    spellcheck="false"
                    data-1p-ignore 
                    data-lpignore="true">
                <div class="entity-picker-dropdown" style="display: none;">
                    <div class="entity-picker-loading">Loading entities...</div>
                </div>
            </div>
            <input type="hidden" name="${name}" value="${escapeHtml(multiple ? values.join(', ') : singleValue)}">
        </div>
    `;

    // Initialize after DOM insertion
    setTimeout(() => initEntityPicker(id, domainFilter, multiple, onSelect), 0);

    return html;
}

function initEntityPicker(id, domainFilter, multiple, onSelect) {
    const picker = document.getElementById(id);
    if (!picker) return;

    const input = picker.querySelector('.entity-picker-input');
    const dropdown = picker.querySelector('.entity-picker-dropdown');
    const hidden = picker.querySelector('input[type="hidden"]');
    const tagsContainer = picker.querySelector('.entity-picker-tags');

    let isOpen = false;

    // Load entities on first focus
    input.addEventListener('focus', async () => {
        if (!entityCache.loaded) {
            dropdown.style.display = 'block';
            dropdown.innerHTML = '<div class="entity-picker-loading">Loading entities...</div>';
            await entityCache.load();
        }
        showDropdown();
    });

    // Search on input
    input.addEventListener('input', () => {
        showDropdown();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) {
            hideDropdown();
        }
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideDropdown();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const first = dropdown.querySelector('.entity-option');
            if (first) first.focus();
        } else if (e.key === 'Enter' && !isOpen) {
            showDropdown();
        }
    });

    // Tag removal (for multiple)
    if (tagsContainer) {
        tagsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-remove')) {
                const val = e.target.dataset.value;
                const tag = e.target.closest('.entity-tag');
                if (tag) tag.remove();
                updateHiddenValue();
            }
        });
    }

    function showDropdown() {
        const query = input.value;
        const results = entityCache.search(query, domainFilter);

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="entity-picker-empty">No entities found</div>';
        } else {
            dropdown.innerHTML = results.map(e => `
                <div class="entity-option" tabindex="0" data-entity-id="${e.entity_id}">
                    <span class="entity-option-name">${escapeHtml(e.friendly_name)}</span>
                    <span class="entity-option-id">${escapeHtml(e.entity_id)}</span>
                </div>
            `).join('');

            // Click handlers
            dropdown.querySelectorAll('.entity-option').forEach(opt => {
                opt.addEventListener('click', () => selectEntity(opt.dataset.entityId));
                opt.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') selectEntity(opt.dataset.entityId);
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = opt.nextElementSibling;
                        if (next) next.focus();
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prev = opt.previousElementSibling;
                        if (prev) prev.focus();
                        else input.focus();
                    }
                });
            });
        }

        dropdown.style.display = 'block';
        isOpen = true;
    }

    function hideDropdown() {
        dropdown.style.display = 'none';
        isOpen = false;
    }

    function selectEntity(entityId) {
        if (multiple) {
            // Add tag if not already present
            const currentValues = getCurrentValues();
            if (!currentValues.includes(entityId)) {
                const entity = entityCache.entities.find(e => e.entity_id === entityId);
                const displayName = entity?.friendly_name || entityId;
                const tag = document.createElement('span');
                tag.className = 'entity-tag';
                tag.innerHTML = `${escapeHtml(displayName)}<button class="tag-remove" data-value="${escapeHtml(entityId)}">&times;</button>`;
                tagsContainer.appendChild(tag);
                updateHiddenValue();
            }
            input.value = '';
        } else {
            input.value = entityId;
            hidden.value = entityId;
        }

        hideDropdown();
        if (onSelect) onSelect(entityId);

        // Trigger change event on hidden input
        hidden.dispatchEvent(new Event('change', { bubbles: true }));

        // Also dispatch a custom event for app.js to update dirty state and block title
        picker.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name, value: hidden.value, entityId }
        }));
    }

    function getCurrentValues() {
        if (!tagsContainer) return [];
        return Array.from(tagsContainer.querySelectorAll('.tag-remove'))
            .map(btn => btn.dataset.value);
    }

    function updateHiddenValue() {
        hidden.value = getCurrentValues().join(', ');
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

// ============================================
// Device Picker Component
// ============================================

function createDevicePicker(name, value, options = {}) {
    const { placeholder = 'Search devices...', multiple = false, onSelect = null } = options;
    const id = `device-picker-${name}-${Date.now()}`;
    const values = multiple ? (Array.isArray(value) ? value : (value ? value.split(',').map(v => v.trim()) : [])) : [];
    const singleValue = !multiple ? (value || '') : '';

    const html = `
        <div class="entity-picker device-picker" data-name="${name}" data-multiple="${multiple}" id="${id}">
            ${multiple ? `
                <div class="entity-picker-tags">
                    ${values.map(v => `<span class="entity-tag">${escapeHtml(v)}<button class="tag-remove" data-value="${escapeHtml(v)}">&times;</button></span>`).join('')}
                </div>
            ` : ''}
            <div class="entity-picker-input-wrapper">
                <input type="text"
                    class="entity-picker-input"
                    placeholder="${placeholder}"
                    value="${multiple ? '' : escapeHtml(singleValue)}"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    data-1p-ignore
                    data-lpignore="true">
                <div class="entity-picker-dropdown" style="display: none;">
                    <div class="entity-picker-loading">Loading devices...</div>
                </div>
            </div>
            <input type="hidden" name="${name}" value="${escapeHtml(multiple ? values.join(', ') : singleValue)}">
        </div>
    `;

    setTimeout(() => initDevicePicker(id, multiple, onSelect), 0);
    return html;
}

function initDevicePicker(id, multiple, onSelect) {
    const picker = document.getElementById(id);
    if (!picker) return;

    const input = picker.querySelector('.entity-picker-input');
    const dropdown = picker.querySelector('.entity-picker-dropdown');
    const hidden = picker.querySelector('input[type="hidden"]');
    const tagsContainer = picker.querySelector('.entity-picker-tags');
    const name = picker.dataset.name;
    let isOpen = false;

    input.addEventListener('focus', async () => {
        if (!deviceCache.loaded) {
            dropdown.style.display = 'block';
            dropdown.innerHTML = '<div class="entity-picker-loading">Loading devices...</div>';
            await deviceCache.load();
        }
        showDropdown();
    });

    input.addEventListener('input', () => showDropdown());

    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) hideDropdown();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideDropdown();
        else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const first = dropdown.querySelector('.entity-option');
            if (first) first.focus();
        } else if (e.key === 'Enter' && !isOpen) {
            showDropdown();
        }
    });

    if (tagsContainer) {
        tagsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-remove')) {
                const val = e.target.dataset.value;
                const tag = e.target.closest('.entity-tag');
                if (tag) tag.remove();
                updateHiddenValue();
            }
        });
    }

    function showDropdown() {
        const query = input.value;
        const results = deviceCache.search(query);

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="entity-picker-empty">No devices found</div>';
        } else {
            dropdown.innerHTML = results.map(d => `
                <div class="entity-option" tabindex="0" data-device-id="${d.device_id}">
                    <span class="entity-option-name">${escapeHtml(d.name || d.device_id)}</span>
                    <span class="entity-option-id">${escapeHtml(d.device_id)}</span>
                </div>
            `).join('');

            dropdown.querySelectorAll('.entity-option').forEach(opt => {
                opt.addEventListener('click', () => selectDevice(opt.dataset.deviceId));
                opt.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') selectDevice(opt.dataset.deviceId);
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = opt.nextElementSibling;
                        if (next) next.focus();
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prev = opt.previousElementSibling;
                        if (prev) prev.focus();
                        else input.focus();
                    }
                });
            });
        }

        dropdown.style.display = 'block';
        isOpen = true;
    }

    function hideDropdown() {
        dropdown.style.display = 'none';
        isOpen = false;
    }

    function selectDevice(deviceId) {
        if (multiple) {
            const currentValues = getCurrentValues();
            if (!currentValues.includes(deviceId)) {
                const device = deviceCache.devices.find(d => d.device_id === deviceId);
                const displayName = device?.name || deviceId;
                const tag = document.createElement('span');
                tag.className = 'entity-tag';
                tag.innerHTML = `${escapeHtml(displayName)}<button class="tag-remove" data-value="${escapeHtml(deviceId)}">&times;</button>`;
                tagsContainer.appendChild(tag);
                updateHiddenValue();
            }
            input.value = '';
        } else {
            const device = deviceCache.devices.find(d => d.device_id === deviceId);
            input.value = device?.name || deviceId;
            hidden.value = deviceId;
        }

        hideDropdown();
        if (onSelect) onSelect(deviceId);

        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        picker.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name, value: hidden.value, deviceId }
        }));
    }

    function getCurrentValues() {
        if (!tagsContainer) return [];
        return Array.from(tagsContainer.querySelectorAll('.tag-remove'))
            .map(btn => btn.dataset.value);
    }

    function updateHiddenValue() {
        hidden.value = getCurrentValues().join(', ');
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

// ============================================
// Area Picker Component
// ============================================

function createAreaPicker(name, value, options = {}) {
    const { placeholder = 'Search areas...', multiple = false, onSelect = null } = options;
    const id = `area-picker-${name}-${Date.now()}`;
    const values = multiple ? (Array.isArray(value) ? value : (value ? value.split(',').map(v => v.trim()) : [])) : [];
    const singleValue = !multiple ? (value || '') : '';

    const html = `
        <div class="entity-picker area-picker" data-name="${name}" data-multiple="${multiple}" id="${id}">
            ${multiple ? `
                <div class="entity-picker-tags">
                    ${values.map(v => `<span class="entity-tag">${escapeHtml(v)}<button class="tag-remove" data-value="${escapeHtml(v)}">&times;</button></span>`).join('')}
                </div>
            ` : ''}
            <div class="entity-picker-input-wrapper">
                <input type="text"
                    class="entity-picker-input"
                    placeholder="${placeholder}"
                    value="${multiple ? '' : escapeHtml(singleValue)}"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    data-1p-ignore
                    data-lpignore="true">
                <div class="entity-picker-dropdown" style="display: none;">
                    <div class="entity-picker-loading">Loading areas...</div>
                </div>
            </div>
            <input type="hidden" name="${name}" value="${escapeHtml(multiple ? values.join(', ') : singleValue)}">
        </div>
    `;

    setTimeout(() => initAreaPicker(id, multiple, onSelect), 0);
    return html;
}

function initAreaPicker(id, multiple, onSelect) {
    const picker = document.getElementById(id);
    if (!picker) return;

    const input = picker.querySelector('.entity-picker-input');
    const dropdown = picker.querySelector('.entity-picker-dropdown');
    const hidden = picker.querySelector('input[type="hidden"]');
    const tagsContainer = picker.querySelector('.entity-picker-tags');
    const name = picker.dataset.name;
    let isOpen = false;

    input.addEventListener('focus', async () => {
        if (!areaCache.loaded) {
            dropdown.style.display = 'block';
            dropdown.innerHTML = '<div class="entity-picker-loading">Loading areas...</div>';
            await areaCache.load();
        }
        showDropdown();
    });

    input.addEventListener('input', () => showDropdown());

    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) hideDropdown();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideDropdown();
        else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const first = dropdown.querySelector('.entity-option');
            if (first) first.focus();
        } else if (e.key === 'Enter' && !isOpen) {
            showDropdown();
        }
    });

    if (tagsContainer) {
        tagsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-remove')) {
                const val = e.target.dataset.value;
                const tag = e.target.closest('.entity-tag');
                if (tag) tag.remove();
                updateHiddenValue();
            }
        });
    }

    function showDropdown() {
        const query = input.value;
        const results = areaCache.search(query);

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="entity-picker-empty">No areas found</div>';
        } else {
            dropdown.innerHTML = results.map(a => `
                <div class="entity-option" tabindex="0" data-area-id="${a.area_id}">
                    <span class="entity-option-name">${escapeHtml(a.name || a.area_id)}</span>
                    <span class="entity-option-id">${escapeHtml(a.area_id)}</span>
                </div>
            `).join('');

            dropdown.querySelectorAll('.entity-option').forEach(opt => {
                opt.addEventListener('click', () => selectArea(opt.dataset.areaId));
                opt.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') selectArea(opt.dataset.areaId);
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = opt.nextElementSibling;
                        if (next) next.focus();
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prev = opt.previousElementSibling;
                        if (prev) prev.focus();
                        else input.focus();
                    }
                });
            });
        }

        dropdown.style.display = 'block';
        isOpen = true;
    }

    function hideDropdown() {
        dropdown.style.display = 'none';
        isOpen = false;
    }

    function selectArea(areaId) {
        if (multiple) {
            const currentValues = getCurrentValues();
            if (!currentValues.includes(areaId)) {
                const area = areaCache.areas.find(a => a.area_id === areaId);
                const displayName = area?.name || areaId;
                const tag = document.createElement('span');
                tag.className = 'entity-tag';
                tag.innerHTML = `${escapeHtml(displayName)}<button class="tag-remove" data-value="${escapeHtml(areaId)}">&times;</button>`;
                tagsContainer.appendChild(tag);
                updateHiddenValue();
            }
            input.value = '';
        } else {
            const area = areaCache.areas.find(a => a.area_id === areaId);
            input.value = area?.name || areaId;
            hidden.value = areaId;
        }

        hideDropdown();
        if (onSelect) onSelect(areaId);

        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        picker.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name, value: hidden.value, areaId }
        }));
    }

    function getCurrentValues() {
        if (!tagsContainer) return [];
        return Array.from(tagsContainer.querySelectorAll('.tag-remove'))
            .map(btn => btn.dataset.value);
    }

    function updateHiddenValue() {
        hidden.value = getCurrentValues().join(', ');
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

// ============================================
// Duration Picker Component
// ============================================

function createDurationPicker(name, value, options = {}) {
    const { showMilliseconds = false } = options;

    // Parse existing value
    let hours = 0, minutes = 0, seconds = 0, milliseconds = 0;

    if (typeof value === 'object') {
        hours = value.hours || 0;
        minutes = value.minutes || 0;
        seconds = value.seconds || 0;
        milliseconds = value.milliseconds || 0;
    } else if (typeof value === 'string' && value.includes(':')) {
        const parts = value.split(':');
        if (parts.length >= 3) {
            hours = parseInt(parts[0]) || 0;
            minutes = parseInt(parts[1]) || 0;
            const secParts = parts[2].split('.');
            seconds = parseInt(secParts[0]) || 0;
            milliseconds = parseInt(secParts[1]) || 0;
        }
    }

    const id = `duration-picker-${name}-${Date.now()}`;

    const html = `
        <div class="duration-picker" id="${id}">
            <div class="duration-fields">
                <div class="duration-field">
                    <input type="text" inputmode="numeric" class="duration-hours" maxlength="2" value="${String(hours).padStart(2, '0')}" placeholder="00">
                    <label>h</label>
                </div>
                <span class="duration-sep">:</span>
                <div class="duration-field">
                    <input type="text" inputmode="numeric" class="duration-minutes" maxlength="2" value="${String(minutes).padStart(2, '0')}" placeholder="00">
                    <label>m</label>
                </div>
                <span class="duration-sep">:</span>
                <div class="duration-field">
                    <input type="text" inputmode="numeric" class="duration-seconds" maxlength="2" value="${String(seconds).padStart(2, '0')}" placeholder="00">
                    <label>s</label>
                </div>
                ${showMilliseconds ? `
                    <span class="duration-sep">.</span>
                    <div class="duration-field">
                        <input type="text" inputmode="numeric" class="duration-ms" maxlength="3" value="${String(milliseconds).padStart(3, '0')}" placeholder="000">
                        <label>ms</label>
                    </div>
                ` : ''}
            </div>
            <input type="hidden" name="${name}" value="">
        </div>
    `;

    setTimeout(() => initDurationPicker(id), 0);

    return html;
}

function initDurationPicker(id) {
    const picker = document.getElementById(id);
    if (!picker) return;

    const hidden = picker.querySelector('input[type="hidden"]');

    const inputs = picker.querySelectorAll('input[type="text"]');

    function updateValue() {
        const h = picker.querySelector('.duration-hours')?.value || '0';
        const m = picker.querySelector('.duration-minutes')?.value || '0';
        const s = picker.querySelector('.duration-seconds')?.value || '0';
        const ms = picker.querySelector('.duration-ms')?.value || '';

        let val = `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
        if (ms) val += `.${ms}`;

        hidden.value = val;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));

        // Dispatch custom event for dirty state tracking
        picker.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name: hidden.name, value: val }
        }));
    }

    inputs.forEach(input => {
        input.addEventListener('input', (e) => {
            // Allow only numbers
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
            updateValue();
        });

        input.addEventListener('blur', (e) => {
            // Pad on blur
            if (e.target.value) {
                const maxLen = e.target.maxLength;
                e.target.value = e.target.value.padStart(maxLen, '0');
            } else {
                e.target.value = ''.padStart(e.target.maxLength, '0');
            }
            updateValue();
        });
    });

    // Initial value (don't trigger change event on init)
    const h = picker.querySelector('.duration-hours')?.value || '0';
    const m = picker.querySelector('.duration-minutes')?.value || '0';
    const s = picker.querySelector('.duration-seconds')?.value || '0';
    const ms = picker.querySelector('.duration-ms')?.value || '';
    let val = `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
    if (ms) val += `.${ms}`;
    hidden.value = val;
}

// ============================================
// Time Picker Component (Time of Day)
// ============================================

function createTimePicker(name, value, options = {}) {
    const { } = options;

    // Parse existing value - supports "HH:MM:SS" or "HH:MM"
    let hours = 0, minutes = 0, seconds = 0;

    if (typeof value === 'string' && value.includes(':')) {
        const parts = value.split(':');
        hours = parseInt(parts[0]) || 0;
        minutes = parseInt(parts[1]) || 0;
        seconds = parseInt(parts[2]) || 0;
    }

    // Determine default mode based on browser locale if not specified
    const use24Hour = options.use24Hour !== undefined ? options.use24Hour : !new Date().toLocaleTimeString().match(/am|pm/i);

    const id = `time-picker-${name}-${Date.now()}`;

    const html = `
        <div class="time-picker" id="${id}" data-mode="${use24Hour ? '24h' : '12h'}">
            <div class="time-fields">
                <div class="time-field">
                    <input type="text" inputmode="numeric" class="time-hours" maxlength="2" value="${String(hours).padStart(2, '0')}" placeholder="00">
                    <label>h</label>
                </div>
                <span class="time-sep">:</span>
                <div class="time-field">
                    <input type="text" inputmode="numeric" class="time-minutes" maxlength="2" value="${String(minutes).padStart(2, '0')}" placeholder="00">
                    <label>m</label>
                </div>
                <span class="time-sep">:</span>
                <div class="time-field">
                    <input type="text" inputmode="numeric" class="time-seconds" maxlength="2" value="${String(seconds).padStart(2, '0')}" placeholder="00">
                    <label>s</label>
                </div>
                <div class="time-ampm" style="display: ${use24Hour ? 'none' : 'flex'}">
                    <select class="ampm-select">
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                    </select>
                </div>
            </div>
            
            <button type="button" class="time-format-toggle" title="Switch 12/24h">
                ${use24Hour ? '24h' : '12h'}
            </button>

            <input type="hidden" name="${name}" value="">
        </div>
    `;

    setTimeout(() => initTimePicker(id), 0);
    return html;
}

function initTimePicker(id) {
    const picker = document.getElementById(id);
    if (!picker) return;

    const hidden = picker.querySelector('input[type="hidden"]');
    const inputs = picker.querySelectorAll('input[type="text"]');
    const ampmSelect = picker.querySelector('.ampm-select');
    const formatToggle = picker.querySelector('.time-format-toggle');
    const ampmContainer = picker.querySelector('.time-ampm');
    const hoursInput = picker.querySelector('.time-hours');

    let is24h = picker.dataset.mode === '24h';

    function updateValue() {
        let h = parseInt(picker.querySelector('.time-hours')?.value || '0');
        const m = (picker.querySelector('.time-minutes')?.value || '0').padStart(2, '0');
        const s = (picker.querySelector('.time-seconds')?.value || '0').padStart(2, '0');

        if (!is24h) {
            const ampm = ampmSelect.value;
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
        }

        const val = `${String(h).padStart(2, '0')}:${m}:${s}`;
        hidden.value = val;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));

        picker.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name: hidden.name, value: val }
        }));
    }

    function toggleFormat() {
        is24h = !is24h;
        picker.dataset.mode = is24h ? '24h' : '12h';
        formatToggle.textContent = is24h ? '24h' : '12h';
        ampmContainer.style.display = is24h ? 'none' : 'flex';

        // Convert current visual value
        let h = parseInt(hoursInput.value || '0');
        if (is24h) {
            // 12h -> 24h
            const ampm = ampmSelect.value;
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
        } else {
            // 24h -> 12h
            if (h === 0) {
                h = 12;
                ampmSelect.value = 'AM';
            } else if (h === 12) {
                ampmSelect.value = 'PM';
            } else if (h > 12) {
                h -= 12;
                ampmSelect.value = 'PM';
            } else {
                ampmSelect.value = 'AM';
            }
        }
        hoursInput.value = String(h).padStart(2, '0');
        updateValue();
    }

    // Set initial AM/PM state if starting in 12h mode
    if (!is24h) {
        let h = parseInt(hoursInput.value || '0');
        if (h === 0) {
            h = 12;
            ampmSelect.value = 'AM';
        } else if (h === 12) {
            ampmSelect.value = 'PM';
        } else if (h > 12) {
            h -= 12;
            ampmSelect.value = 'PM';
        } else {
            ampmSelect.value = 'AM';
        }
        hoursInput.value = String(h).padStart(2, '0');
    }

    if (formatToggle) formatToggle.addEventListener('click', toggleFormat);
    if (ampmSelect) ampmSelect.addEventListener('change', updateValue);

    inputs.forEach(input => {
        input.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
            updateValue();
        });
        input.addEventListener('blur', (e) => {
            if (e.target.value) {
                e.target.value = e.target.value.padStart(2, '0');
            } else {
                e.target.value = '00';
            }
            updateValue();
        });
    });

    // Set initial value without triggering change
    const h = (picker.querySelector('.time-hours')?.value || '0').padStart(2, '0');
    const m = (picker.querySelector('.time-minutes')?.value || '0').padStart(2, '0');
    const s = (picker.querySelector('.time-seconds')?.value || '0').padStart(2, '0');
    hidden.value = `${h}:${m}:${s}`;
}

// ============================================
// Service Picker Component
// ============================================

function createServicePicker(name, value, options = {}) {
    const { placeholder = 'Search services...', onSelect = null } = options;
    const id = `service-picker-${name}-${Date.now()}`;
    const safeValue = value || '';

    const html = `
        <div class="service-picker" data-name="${name}" id="${id}">
            <div class="service-picker-input-wrapper">
                <input type="text" 
                    class="service-picker-input" 
                    placeholder="${placeholder}"
                    value="${escapeHtml(safeValue)}"
                    autocomplete="off" 
                    autocorrect="off" 
                    autocapitalize="off" 
                    spellcheck="false"
                    data-1p-ignore 
                    data-lpignore="true">
                <div class="service-picker-dropdown" style="display: none;">
                    <div class="service-picker-loading">Loading services...</div>
                </div>
            </div>
            <input type="hidden" name="${name}" value="${escapeHtml(safeValue)}">
        </div>
    `;

    setTimeout(() => initServicePicker(id, onSelect), 0);
    return html;
}

function initServicePicker(id, onSelect) {
    const picker = document.getElementById(id);
    if (!picker) return;

    const input = picker.querySelector('.service-picker-input');
    const dropdown = picker.querySelector('.service-picker-dropdown');
    const hidden = picker.querySelector('input[type="hidden"]');
    const name = picker.dataset.name;
    let isOpen = false;

    // Load services on focus
    input.addEventListener('focus', async () => {
        if (!serviceCache.loaded) {
            dropdown.style.display = 'block';
            dropdown.innerHTML = '<div class="service-picker-loading">Loading services...</div>';
            await serviceCache.load();
        }
        showDropdown();
    });

    input.addEventListener('input', () => showDropdown());

    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) hideDropdown();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideDropdown();
        else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const first = dropdown.querySelector('.service-option');
            if (first) first.focus();
        } else if (e.key === 'Enter' && !isOpen) {
            showDropdown();
        }
    });

    function showDropdown() {
        const query = input.value;
        const results = serviceCache.search(query);

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="service-picker-empty">No services found</div>';
        } else {
            dropdown.innerHTML = results.map(s => `
                <div class="service-option" tabindex="0" data-service-id="${s.service_id}">
                    <span class="service-option-name">${escapeHtml(s.name || s.service_id)}</span>
                    <span class="service-option-id">${escapeHtml(s.service_id)}</span>
                    ${s.description ? `<div class="service-option-desc">${escapeHtml(s.description)}</div>` : ''}
                </div>
            `).join('');

            dropdown.querySelectorAll('.service-option').forEach(opt => {
                opt.addEventListener('click', () => selectService(opt.dataset.serviceId));
                opt.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') selectService(opt.dataset.serviceId);
                    if (e.key === 'ArrowDown') nextOption(opt);
                    if (e.key === 'ArrowUp') prevOption(opt);
                });
            });
        }
        dropdown.style.display = 'block';
        isOpen = true;
    }

    function hideDropdown() {
        dropdown.style.display = 'none';
        isOpen = false;
    }

    function nextOption(el) {
        el.preventDefault?.();
        const next = el.nextElementSibling;
        if (next) next.focus();
    }

    function prevOption(el) {
        el.preventDefault?.();
        const prev = el.previousElementSibling;
        if (prev) prev.focus();
        else input.focus();
    }

    function selectService(serviceId) {
        input.value = serviceId;
        hidden.value = serviceId;
        hideDropdown();
        if (onSelect) onSelect(serviceId);

        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        picker.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name, value: serviceId }
        }));
    }
}

// ============================================
// Target Selector Component
// ============================================

function createTargetSelector(name, value, options = {}) {
    // value is expected to be an object: { entity_id: [], device_id: [], area_id: [] }

    // Ensure value is an object
    const target = (typeof value === 'object' && value !== null) ? value : {};
    const showDeviceArea = options.showDeviceArea !== false;

    // Create random ID for container
    const id = `target-selector-${name}-${Date.now()}`;

    // Note: Entities are supported with a picker; devices/areas use freeform IDs for now.

    const jsonValue = JSON.stringify(target);
    setTimeout(() => initTargetSelector(id), 0);

    const deviceAreaHtml = showDeviceArea ? `
            <div class="target-field-group">
                <label>Devices</label>
                ${createDevicePicker(`${name}.device_id`, target.device_id || [], {
        multiple: true,
        placeholder: 'Target devices...'
    })}
            </div>
            <div class="target-field-group">
                <label>Areas</label>
                ${createAreaPicker(`${name}.area_id`, target.area_id || [], {
        multiple: true,
        placeholder: 'Target areas...'
    })}
            </div>
    ` : '';

    return `
        <div class="target-selector" id="${id}" data-name="${name}">
            <div class="target-field-group">
                <label>Entities</label>
                ${createEntityPicker(`${name}.entity_id`, target.entity_id || [], {
        multiple: true,
        placeholder: 'Target entities...'
    })}
            </div>
            ${deviceAreaHtml}
            <input type="hidden" name="${name}" class="target-full-value" value="${escapeHtml(jsonValue)}">
        </div>
    `;
}

function initTargetSelector(id) {
    const container = document.getElementById(id);
    if (!container) return;

    const hidden = container.querySelector('.target-full-value');
    const name = container.dataset.name;

    // Listen for changes in child pickers
    // We listen to 'picker-change' from the EntityPicker
    container.addEventListener('picker-change', (e) => {
        // Only handle child changes, not our own dispatch
        if (e.target !== container) {
            e.stopPropagation();
            updateTargetValue();
        }
    });

    const devicePickerInput = container.querySelector(`input[name="${name}.device_id"]`);
    const areaPickerInput = container.querySelector(`input[name="${name}.area_id"]`);
    if (devicePickerInput) devicePickerInput.addEventListener('change', () => updateTargetValue());
    if (areaPickerInput) areaPickerInput.addEventListener('change', () => updateTargetValue());

    function updateTargetValue() {
        const entityPickerInput = container.querySelector(`input[name="${name}.entity_id"]`);
        const entityPickerVal = entityPickerInput ? entityPickerInput.value : '';

        const existing = (() => {
            try {
                return JSON.parse(hidden.value || '{}') || {};
            } catch (e) {
                return {};
            }
        })();

        const target = {};

        if (entityPickerVal) {
            target.entity_id = entityPickerVal.split(',').map(v => v.trim()).filter(Boolean);
        }

        const deviceVal = devicePickerInput ? devicePickerInput.value : '';
        const areaVal = areaPickerInput ? areaPickerInput.value : '';
        if (devicePickerInput) {
            if (deviceVal) target.device_id = deviceVal.split(',').map(v => v.trim()).filter(Boolean);
        } else if (existing.device_id) {
            target.device_id = existing.device_id;
        }
        if (areaPickerInput) {
            if (areaVal) target.area_id = areaVal.split(',').map(v => v.trim()).filter(Boolean);
        } else if (existing.area_id) {
            target.area_id = existing.area_id;
        }

        // Preserve existing device/area if present in original JSON? 
        // Ideally yes, but hidden.value might be stale if we don't parse it.
        // For partial updates, we'd need to keep local state. 
        // For now, let's assume we are the source of truth for 'target'.

        hidden.value = JSON.stringify(target);

        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        container.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name, value: hidden.value }
        }));
    }
}

// ============================================
// Data Editor Component (Simple Key-Value)
// ============================================

function createDataEditor(name, value, options = {}) {
    const id = `data-editor-${name}-${Date.now()}`;
    const data = (typeof value === 'object' && value !== null) ? value : {};


    const entries = Object.entries(data);
    if (entries.length === 0) entries.push(['', '']);

    const rowsHtml = entries.map(([k, v]) => `
        <div class="data-row">
            <input type="text" class="data-key-input" placeholder="Name" value="${escapeHtml(k)}">
            <span class="data-sep">:</span>
            <input type="text" class="data-value-input" placeholder="Value" value="${escapeHtml(v)}">
            <button class="data-remove-btn" title="Remove">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>
    `).join('');

    const html = `
        <div class="data-editor" id="${id}" data-name="${name}">
            <div class="data-rows">
                ${rowsHtml}
            </div>
            <button class="data-add-btn">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                Add option
            </button>
            <input type="hidden" name="${name}" value="${escapeHtml(JSON.stringify(data))}">
        </div>
    `;

    setTimeout(() => initDataEditor(id), 0);
    return html;
}

function initDataEditor(id) {
    const editor = document.getElementById(id);
    if (!editor) return;

    const rowsContainer = editor.querySelector('.data-rows');
    const addButton = editor.querySelector('.data-add-btn');
    const hidden = editor.querySelector('input[type="hidden"]');
    const name = editor.dataset.name;

    addButton.addEventListener('click', (e) => {
        e.preventDefault();
        addRow('', '');
    });

    rowsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.data-remove-btn');
        if (btn) {
            e.preventDefault();
            btn.closest('.data-row').remove();
            updateHiddenValue();
        }
    });

    rowsContainer.addEventListener('input', (e) => {
        if (e.target.classList.contains('data-key-input') || e.target.classList.contains('data-value-input')) {
            updateHiddenValue();
        }
    });

    function addRow(key, val) {
        const row = document.createElement('div');
        row.className = 'data-row';
        row.innerHTML = `
            <input type="text" class="data-key-input" placeholder="Name" value="${escapeHtml(key)}">
            <span class="data-sep">:</span>
            <input type="text" class="data-value-input" placeholder="Value" value="${escapeHtml(val)}">
            <button class="data-remove-btn" title="Remove">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        `;
        rowsContainer.appendChild(row);
    }

    function updateHiddenValue() {
        const data = {};
        rowsContainer.querySelectorAll('.data-row').forEach(row => {
            const k = row.querySelector('.data-key-input').value.trim();
            const v = row.querySelector('.data-value-input').value; // Don't trim value, might be important
            if (k) {
                // Heuristic for types:
                if (v === 'true') data[k] = true;
                else if (v === 'false') data[k] = false;
                else if (!isNaN(v) && v !== '') data[k] = Number(v);
                else data[k] = v;
            }
        });

        hidden.value = JSON.stringify(data);
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        editor.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name, value: hidden.value }
        }));
    }
}

// ============================================
// Service Arguments Editor (Schema-Driven)
// ============================================

function createServiceArgsEditor(serviceId, currentData = {}, options = {}) {
    const id = `service-args-${serviceId.replace(/\./g, '-')}-${Date.now()}`;
    const name = options.name || 'data';

    // Initial: Return placeholder (Generic Editor)
    // We render generic editor immediately so user sees data while schema loads.
    const genericHtml = createDataEditor(name, currentData);

    setTimeout(() => initServiceArgsEditor(id, serviceId, currentData, options), 0);

    return `<div id="${id}" class="service-args-container">${genericHtml}</div>`;
}

async function initServiceArgsEditor(id, serviceId, currentData, options) {
    const container = document.getElementById(id);
    if (!container) return;

    if (!serviceCache.loaded) {
        await serviceCache.load();
    }

    // Re-check container existence after await
    if (!document.getElementById(id)) return;

    const serviceDef = serviceCache.services.find(s => s.service_id === serviceId);

    // If no schema, remain generic (do nothing)
    if (!serviceDef || !serviceDef.fields || Object.keys(serviceDef.fields).length === 0) {
        return;
    }

    // Generate Schema UI
    const fieldsHtml = [];
    const usedKeys = new Set();
    const name = options.name || 'data';

    for (const [fieldKey, fieldDef] of Object.entries(serviceDef.fields)) {
        const value = currentData[fieldKey];
        usedKeys.add(fieldKey);

        let inputHtml = '';
        const label = fieldDef.name || fieldKey;
        const description = fieldDef.description || '';
        const selector = fieldDef.selector || {};

        if (selector.boolean) {
            inputHtml = createToggle(fieldKey, value, { label, description });
        } else if (selector.number) {
            inputHtml = createSlider(fieldKey, value, {
                label,
                description,
                min: selector.number.min,
                max: selector.number.max,
                step: selector.number.step,
                unit: selector.number.unit_of_measurement
            });
        } else if (selector.select) {
            inputHtml = createDropdown(fieldKey, value, {
                label,
                description,
                options: selector.select.options
            });
        } else if (selector.color_rgb || selector.color_temp) {
            // For now, simple color picker or generic input
            // RGB is complex (array), let's stick to simple inputs or specialized later
            // If it's pure RGB array, standard color input returns hex, need conversion.
            // Fallback to text for complex types for now to ensure safety
            inputHtml = createTextInput(fieldKey, value, { label, placeholder: 'e.g. [255, 0, 0]', description });
        } else if (selector.entity) {
            inputHtml = createEntityPicker(fieldKey, value, {
                domainFilter: selector.entity.domain,
                multiple: selector.entity.multiple,
                placeholder: `Select ${label}...`
            });
            inputHtml = `
                <div class="block-field">
                    <label>${escapeHtml(label)}</label>
                    ${inputHtml}
                    ${description ? `<div class="field-description">${escapeHtml(description)}</div>` : ''}
                </div>`;
        } else if (selector.duration) {
            inputHtml = `
                <div class="block-field">
                    <label>${escapeHtml(label)}</label>
                    ${createDurationPicker(fieldKey, value)}
                </div>`;
        } else if (selector.time) {
            inputHtml = `
                <div class="block-field">
                    <label>${escapeHtml(label)}</label>
                    ${createTimePicker(fieldKey, value)}
                </div>`;
        } else {
            // Default Text Input
            inputHtml = createTextInput(fieldKey, value, { label, description });
        }
        fieldsHtml.push(inputHtml);
    }

    // Advanced Args (keys not in schema)
    const extraData = {};
    let hasExtra = false;
    for (const [k, v] of Object.entries(currentData)) {
        if (!usedKeys.has(k)) {
            extraData[k] = v;
            hasExtra = true;
        }
    }

    if (hasExtra) {
        fieldsHtml.push(`
            <div class="advanced-args-section">
                <div class="section-divider"><span>Advanced / Custom Args</span></div>
                ${createDataEditor('advanced_args', extraData)}
            </div>
        `);
    }

    // Replace Content
    const editorHtml = `
        <div class="service-args-editor" data-name="${name}">
            ${fieldsHtml.join('')}
            <input type="hidden" name="${name}" value="${escapeHtml(JSON.stringify(currentData))}">
        </div>
    `;

    container.innerHTML = editorHtml;

    // Init listeners for new content
    const editor = container.querySelector('.service-args-editor');
    const hiddenInput = editor.querySelector(`input[name="${name}"]`);

    const triggerChange = () => {
        const newData = {};

        // Standard inputs
        editor.querySelectorAll('input:not([type="hidden"]), select').forEach(el => {
            if (el.name && !el.closest('.data-editor') && !el.closest('.entity-picker') && !el.closest('.duration-picker') && !el.closest('.time-picker')) {
                let val = el.value;
                if (el.type === 'checkbox') val = el.checked;
                else if (el.type === 'number') val = parseFloat(val);
                if (val !== '' && val !== null) newData[el.name] = val;
            }
        });

        // Specialized pickers (hidden inputs)
        editor.querySelectorAll('.entity-picker input[type="hidden"], .duration-picker input[type="hidden"], .time-picker input[type="hidden"]').forEach(el => {
            if (el.name && el.value) newData[el.name] = el.value;
        });

        // Advanced args
        const advInput = editor.querySelector('input[name="advanced_args"]');
        if (advInput) {
            try {
                const advData = JSON.parse(advInput.value);
                Object.assign(newData, advData);
            } catch (e) { }
        }

        hiddenInput.value = JSON.stringify(newData);
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    editor.addEventListener('input', (e) => {
        if (e.target !== hiddenInput) triggerChange();
    });
    editor.addEventListener('change', (e) => {
        if (e.target !== hiddenInput) triggerChange();
    });
    editor.addEventListener('picker-change', (e) => {
        triggerChange();
    });
}


function createTextInput(name, value, options = {}) {
    return `
    <div class="block-field">
        <label>${escapeHtml(options.label || name)}</label>
        <input type="text" name="${name}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(options.placeholder || '')}">
        ${options.description ? `<div class="field-description">${escapeHtml(options.description)}</div>` : ''}
    </div>
    `;
}

function createToggle(name, value, options = {}) {
    const isChecked = value === true || value === 'on' || value === 'true';
    return `
    <div class="block-field field-toggle">
        <label>${escapeHtml(options.label || name)}</label>
        <label class="switch">
            <input type="checkbox" name="${name}" ${isChecked ? 'checked' : ''}>
            <span class="slider round"></span>
        </label>
        ${options.description ? `<div class="field-description">${escapeHtml(options.description)}</div>` : ''}
    </div>
    `;
}

function createSlider(name, value, options = {}) {
    const min = options.min ?? 0;
    const max = options.max ?? 100;
    const step = options.step ?? 1;
    const val = (value === undefined || value === null) ? min : value;

    // We can add a live value display
    const id = `slider-${name}-${Date.now()}`;

    // Simple inline script to update output
    const onInput = `document.getElementById('${id}-val').textContent = this.value${options.unit ? ` + ' ' + '${options.unit}'` : ''}`;

    return `
    <div class="block-field field-slider">
        <div class="field-header">
            <label>${escapeHtml(options.label || name)}</label>
            <span class="field-value" id="${id}-val">${val}${options.unit ? ' ' + options.unit : ''}</span>
        </div>
        <input type="range" id="${id}" name="${name}" min="${min}" max="${max}" step="${step}" value="${val}" oninput="${onInput}">
         ${options.description ? `<div class="field-description">${escapeHtml(options.description)}</div>` : ''}
    </div>
    `;
}

function createDropdown(name, value, options = {}) {
    const opts = options.options || []; // can be array of strings or objects {label, value}

    return `
    <div class="block-field">
        <label>${escapeHtml(options.label || name)}</label>
        <div class="select-wrapper">
            <select name="${name}">
                <option value="">Select...</option>
                ${opts.map(o => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        const selected = String(v) === String(value) ? 'selected' : '';
        return `<option value="${escapeHtml(v)}" ${selected}>${escapeHtml(l)}</option>`;
    }).join('')}
            </select>
        </div>
        ${options.description ? `<div class="field-description">${escapeHtml(options.description)}</div>` : ''}
    </div>
    `;
}

// ============================================
// Notification Composer (Simplified UI)
// ============================================

function createNotificationComposer(serviceId, currentData = {}, options = {}) {
    // Ensure we default to a notify service if none selected, but usually serviceId is passed
    const id = `notify-composer-${Date.now()}`;
    const message = currentData.message || '';
    const title = currentData.title || '';
    const name = options.name || 'data';

    // We can hide/show the "Data" field for advanced users if needed, 
    // but detecting it is better.
    // Let's filter out message/title from "data" to show remaining advanced fields
    const advancedData = { ...currentData };
    delete advancedData.message;
    delete advancedData.title;

    const hasAdvanced = Object.keys(advancedData).length > 0;
    const advancedValue = hasAdvanced ? JSON.stringify(advancedData) : '';

    const html = `
        <div class="notification-composer" id="${id}">
            <div class="composer-field">
                <label>Message</label>
                <textarea class="composer-message-input" rows="3" placeholder="Notification message...">${escapeHtml(message)}</textarea>
            </div>
            
            <div class="composer-field">
                <label>Title <span class="opt">(Optional)</span></label>
                <input type="text" class="composer-title-input" value="${escapeHtml(title)}" placeholder="Notification title">
            </div>

            <div class="composer-advanced ${hasAdvanced ? 'open' : ''}">
                <div class="advanced-toggle" onclick="this.closest('.composer-advanced').classList.toggle('open')">
                    Advanced Data (JSON)
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2"/></svg>
                </div>
                <div class="advanced-content">
                     ${createDataEditor('advanced-data', advancedData)}
                </div>
            </div>

            <!-- Hidden input to sync back to block.data -->
            <input type="hidden" class="composer-final-output" name="${escapeHtml(name)}">
        </div>
    `;

    setTimeout(() => initNotificationComposer(id), 0);
    return html;
}

function initNotificationComposer(id) {
    const container = document.getElementById(id);
    if (!container) return;

    const msgInput = container.querySelector('.composer-message-input');
    const titleInput = container.querySelector('.composer-title-input');
    const advancedContainer = container.querySelector('.data-editor'); // The generic editor we embedded
    const output = container.querySelector('.composer-final-output');

    // Helper to get advanced data from the embedded generic editor
    function getAdvancedData() {
        if (!advancedContainer) return {};
        const hidden = advancedContainer.querySelector('input[type="hidden"]');
        try {
            return JSON.parse(hidden.value);
        } catch (e) {
            return {};
        }
    }

    function updateOutput() {
        const data = {
            message: msgInput.value,
            title: titleInput.value,
            ...getAdvancedData()
        };

        // Clean up empty title
        if (!data.title) delete data.title;

        output.value = JSON.stringify(data);
        output.dispatchEvent(new Event('change', { bubbles: true }));
        // Dispatch change so app.js picks it up
        container.dispatchEvent(new CustomEvent('picker-change', {
            bubbles: true,
            detail: { name: 'data', value: output.value }
        }));
    }

    msgInput.addEventListener('input', updateOutput);
    titleInput.addEventListener('input', updateOutput);

    // Listen for changes from the embedded data editor
    if (advancedContainer) {
        advancedContainer.addEventListener('picker-change', (e) => {
            e.stopPropagation(); // Stop bubbling, we handle it
            updateOutput();
        });
    }
}

// Export
// Helper: Escape HTML
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Export for use in app.js
window.fieldComponents = {
    createEntityPicker,
    createDevicePicker,
    createAreaPicker,
    createDurationPicker,
    createTimePicker,
    createServicePicker,
    createTargetSelector,
    createDataEditor,
    createServiceArgsEditor,
    createNotificationComposer,
    entityCache,
    serviceCache,
    deviceCache,
    areaCache
};
