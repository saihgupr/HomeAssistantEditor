# Changelog

## [1.0.4] - 2026-02-25

### Added
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
- **Clipboard Type Safety**: Block clipboard data is now section-aware (`triggers`, `conditions`, `actions`) and separated from item clipboard data.

### Fixed
- **NaN in Block Titles**: Fixed a bug where `numeric_state` blocks could display "NaN" in their title while editing empty number fields.
- **Stale Context Menu Data**: Fixed an issue where context menu actions (like Show YAML) would use old data instead of the latest unsaved visual edits.
- **Paste Restrictions by Section**: Condition/trigger/action blocks can now only be pasted into matching sections.
- **Paste Button Visibility**: Section paste buttons now only appear when the clipboard contains a compatible block type for that section.
- **Context Menu Paste Guardrails**: Block and item context menu paste actions now honor clipboard type compatibility.
- **Settings Theme Overhaul**: Replaced separate `Dark Mode` and `Follow Browser Theme` toggles with a unified 3-way `Theme` selector (`Auto`, `Light`, `Dark`).
- **Sort Control Relocation**: Moved item sort mode from the main list header into Settings under `Sort Items By`.
- **Settings Sort Row Layout**: Updated sort setting layout so label/description and dropdown align on one row for a cleaner settings panel.
- **Settings Select Polish**: Refined settings dropdown styling (custom chevron, hover/focus states, and better visual fit with existing UI components).

## [1.0.3] - 2026-02-23

### Added
- **Parallel Processing**: YAML files are now read and parsed in parallel using `Promise.all`, significantly improving loading speed for configurations with multiple files.
- **In-Memory Caching**: Implemented a caching mechanism for parsed YAML data and file content to minimize redundant disk I/O.
- **Smart Invalidation**: Cache entries are automatically refreshed based on file modification timestamps (`mtimeMs`).
- **Debug Telemetry**: Performance metrics and cache status logs added to the internal service for easier verification.

### Changed
- Refactored `extractAutomations` and `extractScripts` for improved concurrency and responsiveness.
- Optimized configuration file path lookup.
