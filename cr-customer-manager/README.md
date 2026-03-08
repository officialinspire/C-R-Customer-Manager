# C&R Carpet & Rug — Customer Manager

Local-first web app for C&R's handwritten-style work-order flow:
- Create/edit/search customer invoices and installation work orders.
- Upload a scan (image or PDF), run OCR, review extracted fields, then save.
- Print/export a clean work-order PDF.
- Store all data in local SQLite (`./data/cr.sqlite`).

## Local run

### 1) Install dependencies

If this is a fresh machine, use the helper:

```bash
chmod +x install.sh run.sh
./install.sh
```

If you already have build tools and Node installed, a minimal install is:

```bash
npm install
```

### 2) Start the app

```bash
./run.sh
# or: npm start
```

Open: `http://localhost:3005`

Health check endpoint:

```bash
curl http://localhost:3005/api/health
```

## Core workflows

### Upload scan workflow

1. Click **📷 Upload Scan** and choose an image/PDF scan of the paper form.
2. The server saves the file in `./uploads` and runs OCR.
3. The UI loads a **draft** record (not saved yet) with extracted fields.
4. Review/edit fields, then click **💾 Save**.

Notes:
- Supported upload types: PDF, JPEG, PNG, TIFF.
- Max file size: 15 MB.
- `./inbox` watcher archives dropped image files into `./uploads` for manual review/import.

### OCR review flow

1. After upload (or **🔄 Re-scan** on an existing invoice), the **OCR Review Draft** panel appears.
2. Low-confidence or empty fields are visually flagged.
3. Validate key fields (invoice #, sold-to, address, phones, dates, salesperson).
4. Save once data matches the paper form.

### Save / search / load / new / delete

- **✨ New Invoice** starts a blank record.
- **💾 Save** creates/updates the invoice.
- **🔍 Search** filters by invoice #, customer name, phone, address, installer, notes, OCR text, and item metadata.
- Click a search result to load it.
- **🗑️ Delete** removes the invoice and its item lines.

### Print/export flow

1. Load a saved invoice.
2. Click **🖨️ Print Work Order Form**.
3. A generated PDF opens at `/api/invoices/:id/pdf` for print/save.

## Schema + migration notes

- Main table: `invoices`
- Detail lines: `invoice_items`
- Automatic migration runs on server start via `openDb()`.
- Current schema version is tracked with SQLite `PRAGMA user_version`.
- Additional idempotent migration bookkeeping is in `schema_migrations`.

Recent migration behavior includes:
- Backfilling canonical fields from legacy columns (`email`, `subtotal`, `total`).
- Normalizing source scan paths to `/uploads/<file>`.
- Normalizing date fields to `YYYY-MM-DD` where possible.
- Enforcing uniqueness for non-empty `invoice_number` values.

## Data locations

- Database: `./data/cr.sqlite`
- Uploaded scans: `./uploads`
- Inbox drop folder: `./inbox`
- Multer temp files: `./tmp`

## Troubleshooting

- If `better-sqlite3` fails to load, run:

```bash
npm rebuild better-sqlite3 --build-from-source
```

- If OCR is poor, use cleaner/straighter scans and re-run OCR from the invoice screen.
