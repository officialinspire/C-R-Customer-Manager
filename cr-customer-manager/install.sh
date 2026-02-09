#!/usr/bin/env bash
set -e

echo "[1/5] Installing OS deps..."
sudo apt-get update
sudo apt-get install -y build-essential python3 make g++ pkg-config sqlite3 libsqlite3-dev fonts-dejavu-core fontconfig ca-certificates

echo "[2/5] Cleaning old node_modules + lock (prevents RC deps)..."
rm -rf node_modules package-lock.json

echo "[3/5] Installing npm deps..."
npm install

echo "[4/5] Rebuilding better-sqlite3 (native binding) ..."
npm rebuild better-sqlite3 --build-from-source || true

echo "[5/5] Creating folders..."
mkdir -p data inbox uploads tmp public

echo "Done."
echo "Start with: ./run.sh"
