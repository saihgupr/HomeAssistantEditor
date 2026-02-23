# Changelog

## [1.0.3] - 2026-02-23

### Added
- **Parallel Processing**: YAML files are now read and parsed in parallel using `Promise.all`, significantly improving loading speed for configurations with multiple files.
- **In-Memory Caching**: Implemented a caching mechanism for parsed YAML data and file content to minimize redundant disk I/O.
- **Smart Invalidation**: Cache entries are automatically refreshed based on file modification timestamps (`mtimeMs`).
- **Debug Telemetry**: Performance metrics and cache status logs added to the internal service for easier verification.

### Changed
- Refactored `extractAutomations` and `extractScripts` for improved concurrency and responsiveness.
- Optimized configuration file path lookup.
