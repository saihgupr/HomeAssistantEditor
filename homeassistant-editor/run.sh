#!/bin/sh
export NODE_ENV="${NODE_ENV:-production}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-54002}"

# Print the version baked into this image instead of a hardcoded banner
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADDON_VERSION="$(node -e "const fs=require('fs');process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version)" "$SCRIPT_DIR/config.json" 2>/dev/null)"
[ -n "$ADDON_VERSION" ] || ADDON_VERSION="unknown"

echo "======================================"
echo "Home Assistant Editor v${ADDON_VERSION}"
echo "======================================"
echo "Starting server..."
echo "======================================"

node server.js
