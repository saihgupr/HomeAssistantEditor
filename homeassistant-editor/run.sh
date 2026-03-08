#!/bin/sh
export NODE_ENV="${NODE_ENV:-production}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-54002}"

echo "======================================"
echo "Home Assistant Editor v1.1.0-beta.2"
echo "======================================"
echo "Starting server..."
echo "======================================"

node server.js
