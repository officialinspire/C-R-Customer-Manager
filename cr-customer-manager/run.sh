#!/usr/bin/env bash
set -e
export PORT="${PORT:-3005}"
echo "Starting C&R Customer Manager on http://localhost:${PORT}"
node server.js
