#!/usr/bin/env bash
set -e
export PORT="${PORT:-3005}"

if [ -f "./credentials.json" ]; then
  export GOOGLE_CREDENTIALS_PATH="./credentials.json"
fi

echo "Starting C&R Customer Manager on http://localhost:${PORT}"
echo "Local network access (for mobile PWA):"
hostname -I 2>/dev/null | awk '{print "  http://"$1":'"$PORT"'"}' || echo "  Check your IP with: ipconfig (Windows) or ifconfig (Mac/Linux)"

node server.js
