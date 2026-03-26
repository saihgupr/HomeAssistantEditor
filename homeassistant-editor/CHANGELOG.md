# Changelog

## [1.1.0] - 2026-03-26

### Added
- **Session Undo/Redo**: Full undo/redo support for all visual actions during a session (including structural changes and field edits).
- **Condition Testing**: Dedicated "Test" buttons on condition blocks with real-time pass/fail feedback for all conditions and templates.
- **Support for Home Assistant Packages**: Directly browse, edit, and trace automations and scripts organized within HA packages.
- **Sync Metadata (Areas, Labels & Icons)**: Automatically import Areas for folders and Labels for tags, plus direct entity icon support from HA.
- **Script Run & Stop Feature**: Enhanced header controls with Run/Stop state for scripts and automations.
- **Live Trigger ID Suggestions**: Intelligent autocomplete for Trigger IDs in conditions based on current automation triggers.

### Changed
- **Readable Logic Phrasing**: `numeric_state` blocks now use natural phrasing like "is above" or "is between" instead of technical math syntax.
- **Unified Time Picker**: 12h/24h toggle integrated into a single AM/PM dropdown for cleaner navigation.
- **Smart Block Expansion**: Duplicated or newly added blocks now always appear expanded by default.
- **Instant YAML View**: Block-level YAML view now reflects unsaved changes instantly.

### Fixed
- **Safari Support**: Improved compatibility for Safari and mobile browsers with better input protection.
- **Enhanced Color Rendering**: Fixed background transparency and color vibrancy for all UI blocks in color mode.
- **Architecture Stability**: Pre-built Docker images for multiple architectures to prevent build failures during installation.
- **Metadata Cleanup**: Automatically strips internal markers to prevent "Unknown keys" errors when saving YAML.
- **Nested Action Reliability**: Fixed undo/redo logic and context menus for nested blocks (`if`, `choose`).


## [1.0.3] - 2026-02-23

### Added
- **Parallel Processing**: YAML files are now read and parsed in parallel using `Promise.all`, significantly improving loading speed for configurations with multiple files.
- **In-Memory Caching**: Implemented a caching mechanism for parsed YAML data and file content to minimize redundant disk I/O.
- **Smart Invalidation**: Cache entries are automatically refreshed based on file modification timestamps (`mtimeMs`).
- **Debug Telemetry**: Performance metrics and cache status logs added to the internal service for easier verification.

### Changed
- Refactored `extractAutomations` and `extractScripts` for improved concurrency and responsiveness.
- Optimized configuration file path lookup.
