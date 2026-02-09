# C&R Carpet & Rug — Customer Manager

Local web app:
- Watch `./inbox` for scans → OCR → store in SQLite
- Search / edit invoices
- Multi-line items + auto totals
- Installer mobile view
- Generate PDF work order

## Install
```bash
cd /home/zach/cr-customer-manager
chmod +x install.sh run.sh
./install.sh
```

## Run
```bash
./run.sh
# then open: http://localhost:3005
```

## Auto-import scans
Drop images into:
- `./inbox` (auto-processed)

Or use **Manual Upload Scan** in the UI.

## Notes
This version uses ROI-based OCR: it crops specific regions of the standardized C&R form before running Tesseract.
That is the key upgrade that makes OCR usable for this template.
