# C&R Carpet & Rug — Customer Manager (CRM)

C&R CRM is a local-first web + desktop-friendly app for managing handwritten work orders, invoices, OCR intake, and printing from one place.

## Documentation

- Deployment and setup guide: [`../DEPLOY.md`](../DEPLOY.md)
- App source root: `./`

## Features

- Invoice/work-order CRUD with SQLite persistence (`./data/cr.sqlite`)
- OCR workflow for image/PDF scans with editable review drafts
- Search across invoice number, customer details, notes, OCR text, and item metadata
- Print/export work-order PDFs from saved invoices
- PWA support (install to phone home screen, offline-capable app shell)
- Google Drive integration for cloud sync/auth flows
- Automated nightly backups at 3:00 AM + manual backup action
- Desktop launcher scripts for Windows (`START-CR-CRM.bat`, `STOP-CR-CRM.bat`)

## Local Run

### 1) Install dependencies

```bash
chmod +x install.sh run.sh
./install.sh
```

Or minimal install if toolchain already exists:

```bash
npm install
```

### 2) Start app

```bash
./run.sh
# or: npm start
```

Open: <http://localhost:3005>

Health check:

```bash
curl http://localhost:3005/api/health
```

## Core Workflows

### Upload + OCR

1. Click **📷 Upload Scan** and choose a PDF/image.
2. File is stored under `./uploads` and OCR is processed.
3. Review extracted fields in draft mode.
4. Edit and click **💾 Save**.

### Search + Manage

- **✨ New Invoice** creates a blank record.
- **💾 Save** creates/updates invoice and line items.
- **🔍 Search** filters records by key customer/job fields.
- **🗑️ Delete** removes invoice + item lines.

### Print

1. Open a saved invoice.
2. Click **🖨️ Print Work Order Form**.
3. Generated PDF opens at `/api/invoices/:id/pdf`.

## Data Paths

- Database: `./data/cr.sqlite`
- Uploads: `./uploads`
- Inbox drop folder: `./inbox`
- Temp files: `./tmp`
- Backups: `./backups/YYYY-MM-DD/`

## Troubleshooting

- If `better-sqlite3` fails to load:

```bash
npm rebuild better-sqlite3 --build-from-source
```

- If OCR quality is poor, use cleaner scans and re-run OCR.
- For deployment, mobile setup, Drive setup, and backup expectations, use [`../DEPLOY.md`](../DEPLOY.md).
