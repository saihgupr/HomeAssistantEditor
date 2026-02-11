# Changelog

## [1.0.0] - 2026-02-11
- Official v1.0.0 release.
- Synchronized Docker setup with Home Assistant Time Machine pattern.
- Moved to Node 20 Alpine base image for improved portability and performance.
- Standardized startup scripts and logging.
- Overhauled documentation with modern UI screenshots and professional installation guides.
- Added Docker Compose support for standalone deployments.

## 2026-02-06
- Expanded block type coverage in the visual editor (triggers, conditions, actions) with proper defaults and titles.
- Added missing icons for new block types in the add-block modal.
- Added nested editors for condition groups, choose, wait-for-trigger, and parallel/sequence blocks.
- Added a full repeat editor with mode selection and nested sequences.
- Added required-field validation highlights for common trigger/condition/action inputs.
- Live-updated block titles as fields change (when no alias is set).
- Added empty-state hints for nested condition/action/trigger sections.
- Made nested empty-state hints auto-hide/show when adding or removing items.
- Enabled drag-and-drop reordering for nested blocks and removed extra reorder buttons.
- Prevented save when required fields are missing, and auto-focused the first invalid field.
- Improved validation updates for entity/service pickers.
- Added inline “Required” badges on invalid fields.
- Added live YAML validation banner while editing YAML.
- Fixed YAML editor bindings to ensure typing updates the highlighted layer.
- Switched YAML editor to a plain-text fallback to ensure typing is visible.
- Added proper checkbox editors for boolean action fields.
- Fixed service target parsing and ignored target picker subfields during save.
- Improved Sun condition fields with proper selects and offset handling.
- Added weekday picker for time conditions and event selector for zone triggers.
- Added structured editors for Home Assistant trigger events and MQTT payloads; improved event data handling.
- Added parsing for webhook allowed methods and JSON validation messaging for event data.
- Added structured device editors (ID/domain/type + extra JSON) across triggers, conditions, and actions.
- Expanded target selector to allow device/area IDs in addition to entities.
- Fixed service action target selector to preserve existing target objects.
- Added JSON validation for variables actions to prevent invalid payloads on save.
- Improved block titles to use device/area names when service targets or device triggers use those IDs.
- Filled missing editors: event trigger data, condition “for” durations, and optional timeouts for wait actions.
- Added empty-state hints for choose default actions to match other nested sections.
- Added empty-state hints to If/Then/Else nested sections for consistency.
- Fixed event data and variables editors to preserve object values instead of clearing.
- Fixed notification composer to persist its data payload on save.
- Nested blocks now honor the “Collapse blocks by default” setting.
- Added shift-multi-select for actions plus a “Run selected” control and improved run context menu behavior.
- Fixed action run to omit empty targets and reduce HA 400 errors.
- Fixed service data parsing to avoid leaking schema fields into YAML and improved run payload formatting.
- Improved multi-select visuals to show a unified selection range when shift-selecting actions.
