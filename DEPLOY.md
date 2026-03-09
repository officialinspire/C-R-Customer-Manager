# C&R Carpet & Rug CRM — Deployment Guide

## Quick Start (Desktop — Windows)
1. Install Node.js 18+ from nodejs.org
2. Extract the app folder to C:\CarpetCRM\ (or Desktop)
3. Double-click START-CR-CRM.bat
4. App opens automatically in Chrome/Edge
5. Bookmark http://localhost:3005 or add to desktop

## Mobile Setup (PWA — Phone)
1. Make sure desktop app is running and phone is on same WiFi
2. Find the desktop computer's local IP: run ipconfig, note IPv4 address (e.g. 192.168.1.x)
3. On phone browser, navigate to: http://192.168.1.x:3005
4. Browser → Share/Menu → "Add to Home Screen"
5. App installs as PWA — works offline after first load

## Google Drive Setup
1. Go to Google Cloud Console → Create a project named "CR-CRM"
2. Enable "Google Drive API"
3. Create Service Account → generate JSON key → download to project folder
4. Rename the key file to: credentials.json
5. Share your Drive folder "CR-CRM-Invoices" with the service account email
6. Set environment variable: GOOGLE_CREDENTIALS_PATH=./credentials.json
7. Restart the app — Drive icon in header will show green "☁️ Drive: on"

## Daily Backups
- Automatic backup runs at 3:00 AM every night
- Stored in: ./backups/YYYY-MM-DD/
- Contains: cr.sqlite (database) + invoices-export.json
- Manual backup: click ⚙️ System Status → 💾 Backup Now
- Keep ./backups/ folder on Dropbox/external drive for extra safety

## Updating the App
1. Stop with STOP-CR-CRM.bat
2. Replace app files (keep ./data/, ./uploads/, ./backups/ folders)
3. Run: npm install
4. Restart with START-CR-CRM.bat

## Troubleshooting
- App won't start: Check Node version (needs 18+), run install.sh
- OCR not working: Make sure tesseract language data is downloaded (happens on first use)
- Drive not syncing: Check credentials.json exists and GOOGLE_CREDENTIALS_PATH is set
- Lost data: Check ./backups/ folder for last night's backup
