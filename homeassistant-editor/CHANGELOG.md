# Changelog

## [1.0.4] - 2026-02-25

### Added
- **Session Undo/Redo**: Implemented full undo/redo support for the visual editor. Structural changes (adding, deleting, moving blocks) and field edits (dropdowns, checkboxes, entity pickers) can now be reversed.
- **Undo/Redo UI Buttons**: Added dedicated Undo and Redo buttons to the editor footer with live state (disabled when no history is available).
- **Condition Test Action**: Added a dedicated test icon on condition blocks to run pass/fail checks directly from the block header.
- **Condition Test Feedback**: Added visual status feedback for test actions (`testing`, `pass`, `fail`, `unsupported`) with updated icon coloring.
- **Template Condition API**: Added backend endpoint for testing template conditions (`POST /api/test_template`).
- **Live Trigger ID Suggestions**: Added real-time autocomplete suggestions for Trigger IDs in conditions, dynamically gathered from the current unsaved state of triggers in the automation.
- **Readable Numeric State Titles**: Updated `numeric_state` triggers and conditions to use natural phrasing (e.g., "is above", "is between") instead of technical math syntax.

### Changed
- **Unified Time Picker**: Integrated the 12h/24h toggle into the AM/PM dropdown for a cleaner UI.
- **Auto-Detect Time Format**: The time picker now automatically defaults to the user's browser locale (12h or 24h preference).
- **Forced Block Expansion**: Newly added or duplicated blocks (triggers, conditions, actions) now always appear expanded by default for immediate editing, regardless of the global "Collapse blocks by default" setting.
- **Instant YAML View**: Individual block "Show YAML" action now works instantly for new or modified items without requiring a save first.
- **Refined Field Descriptions**: Removed redundant helper text from `input_number.increment` and `input_number.decrement` actions to reduce visual noise.
- **Restricted Block Context Menu**: Right-click context menus are now only triggered by clicking on the block header (action bar), preventing accidental popups while editing fields in the block body.
- **Clipboard Type Safety**: Block clipboard data is now section-aware (`triggers`, `conditions`, `actions`) and separated from item clipboard data.
- **Settings & UI Overhaul**: Unified theme selection, moved item sorting to settings, and refined component styling across the application.

### Fixed
- **Undo Disappearing Bug**: Fixed a critical bug where undoing a block reorder would cause all actions to disappear from the visual editor.
- **NaN in Block Titles**: Fixed a bug where `numeric_state` blocks could display "NaN" in their title while editing empty number fields.
- **Stale Context Menu Data**: Fixed an issue where context menu actions (like Show YAML) would use old data instead of the latest unsaved visual edits.
- **Reliable Redo Shortcut**: Ensured `Cmd+Shift+Z` and `Cmd+Y` work consistently for redoing changes.
- **Nested Drag Undo**: Added missing undo/redo support for moving blocks within nested sections (like inside an `if` or `choose` action).
- **Expansion State Persistence**: Undo/Redo now correctly restores the expanded/collapsed state of all blocks.
- **Paste Guardrails**: Section paste buttons now only appear when the clipboard contains a compatible block type for that section.
- **Settings Row Layout**: Refined the settings panel layout for better readability.

## [1.0.3] - 2026-02-23

### Added
- **Parallel Processing**: YAML files are now read and parsed in parallel using `Promise.all`, significantly improving loading speed for configurations with multiple files.
- **In-Memory Caching**: Implemented a caching mechanism for parsed YAML data and file content to minimize redundant disk I/O.
- **Smart Invalidation**: Cache entries are automatically refreshed based on file modification timestamps (`mtimeMs`).
- **Debug Telemetry**: Performance metrics and cache status logs added to the internal service for easier verification.

### Changed
- Refactored `extractAutomations` and `extractScripts` for improved concurrency and responsiveness.
- Optimized configuration file path lookup.
