#!/usr/bin/env bash
set -e

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ is required. Found: not installed"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  echo "ERROR: Node.js 18+ is required. Found: $(node --version 2>/dev/null || echo 'unknown')"
  exit 1
fi

echo "[1/6] Installing OS deps..."
sudo apt-get update
sudo apt-get install -y build-essential python3 make g++ pkg-config sqlite3 libsqlite3-dev fonts-dejavu-core fontconfig ca-certificates

echo "[2/6] Installing npm deps..."
npm install

echo "[3/6] Rebuilding better-sqlite3 (native binding)..."
npm rebuild better-sqlite3 --build-from-source || true

echo "[4/6] Creating folders..."
mkdir -p data inbox uploads tmp public public/icons backups scripts

echo "[5/6] Generating PWA icons..."
node scripts/generate-icons.js || echo "[WARN] Icon generation failed — add icons manually to public/icons/"

echo "[6/6] Checking Google Drive credentials..."
if [ ! -f "./credentials.json" ]; then
  echo "[Drive] No Google credentials found. To enable Drive sync:"
  echo "  1. Download service account JSON from Google Cloud Console"
  echo "  2. Save as credentials.json in this folder"
  echo "  3. Set GOOGLE_CREDENTIALS_PATH=./credentials.json before starting"
fi

echo
echo "Install complete."
echo "Next steps:"
echo "  1. Start the app: ./run.sh"
echo "  2. Open on this machine: http://localhost:3005 (or your PORT value)"
echo "  3. PWA setup: open in Chrome/Edge, then use 'Install app' from the address bar/menu"
echo "  4. Mobile access: ensure phone and server are on the same Wi-Fi, then open the local network URL shown by ./run.sh"
echo "  5. On mobile browser, use 'Add to Home Screen' to install the PWA"
