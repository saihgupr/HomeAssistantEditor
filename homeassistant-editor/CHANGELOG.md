# Changelog

## [1.3.1] - 2026-11-08

### Fixed
- **Includes Under Any Key (#17)**: The include walker no longer skips `!include` lines whose key is not an automation, script, or package key, and files found inside an `!include_dir_*` are scanned for their own includes. Configs that reach their automation files through a `homeassistant:` include or a directory include now list their automations and scripts.

## [1.3.0] - 2026-11-07

### Added
- **Blueprint Automations**: Automations built on blueprints now show up in the list, open with their blueprint inputs visible, and can be filtered.
- **Configuration Warnings**: Files that cannot be read or parsed are reported through `/api/health` and shown in a banner with the file name and YAML error, instead of only being written to the add-on log.

### Fixed
- **Nested `!include` Discovery** (#17): Includes are now resolved recursively, so configurations that keep automations and scripts behind a chain like `packages: !include_dir_named packages/` → `automation ui: !include ../automations.yaml` are detected.
- **`!include_dir_*` Contents**: Files pulled in by `!include_dir_list`, `!include_dir_named`, `!include_dir_merge_list` and `!include_dir_merge_named` are now parsed with the correct shape (single item, named map, or list) instead of being silently skipped.
- **Package Automation Keys**: Automations and scripts defined under package keys such as `automation split:` or `script split:` are listed and editable in place.
- **Package Writes**: Saving an automation or script that lives inside a package or an included file now writes back to the correct nested location instead of the file root.
- **Device and Area IDs** (#22, #24): Device and area IDs are resolved from local storage so the visual editor shows names instead of raw IDs.
- **Entity Lookup Fallback** (#25): Falls back to `/api/states` when `/api/entities` is unavailable, so entities are found on container installs.
- **`<<: !include` Documents**: Files using an ESPHome style merge include no longer abort parsing, so a single unsupported file cannot hide the rest of the config.

## [1.2.1] - 2026-08-22

### Added
- **Gemini 3.6 Flash Support**: Added `gemini-3.6-flash` as the recommended default model for AI assistance and auto-naming.

### Changed
- **Concise AI Descriptions**: Optimized description generation prompts to produce compact, single-sentence summaries (under 15 words) that fit cleanly within the editor UI.
- **Contextual AI Sparkle Buttons**: Repositioned header AI buttons directly adjacent to title and description inputs, appearing smoothly on hover/focus.

### Fixed
- **Area & Folder Metadata Sync**: Safely handle entities with null default names when syncing Home Assistant areas into editor folders.

## [1.2.0] - 2026-08-18

### Added
- **Nested Drag & Drop**: Full drag-and-drop support into nested branches (`choose`, `if/then`, and `repeat` sequences) and reordering within actions, conditions, and triggers.
- **Optional Gemini AI Assistance**: Integrate Google Gemini AI to auto-generate descriptive action names and automation summaries with a single click.
- **Home Assistant Custom YAML Tags**: Full support for `!include`, `!include_dir_list`, `!include_dir_named`, `!include_dir_merge_list`, `!include_dir_merge_named`, `!secret`, `!env_var`, and `!input` custom tags.
- **Split & Recursive Configs**: Recursive directory scanning for multi-file configurations, nested automation files, and package directories.
- **Searchable Action Picker**: Integrated real-time search filter in the "Add Action" modal dialog.
- **Dual-Stack Network Support**: Dual-stack IPv4 and IPv6 listener support for seamless mDNS (`.local`) and Safari connectivity.

### Changed
- **Vibrant YAML Syntax Coloring**: Enhanced YAML editor theme with crisp syntax highlighting for keys, values, and comments.
- **Compact Drag Placeholders**: Adjusted drop placeholder sizing to match collapsed blocks and eliminated duplicate drop highlights.
- **Cleaned Alias Rendering**: Streamlined block headers by eliminating redundant top-level alias fields.

### Fixed
- **Live Entity State Sync**: Accurately synchronize enabled/disabled status and last triggered times from Home Assistant core states and entity registry.
- **Config Path Discovery**: Automatically resolve and fall back across `/homeassistant`, `/config`, and environment variables.
- **Direct Port Ingress Parity**: Unified API proxy endpoints so direct port (`54002`) and Ingress provide identical capabilities.

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
- **Device Trigger Selection**: Fixed "No devices found" in Device triggers, conditions, and actions by using the correct Home Assistant WebSocket API for device and area registries.
- **Block Title Display**: Improved display of device triggers by pre-loading device names on startup to avoid showing raw IDs.
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
