import fs from "fs";
import path from "path";
import express from "express";
import chokidar from "chokidar";
import multer from "multer";
import PDFDocument from "pdfkit";

import { openDb, computeTotals } from "./db.js";
import { ocrImageToText } from "./ocr.js";
import { extractFromOCR } from "./parse.js";

const PORT = process.env.PORT || 3005;
const ROOT = process.cwd();

const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DB = path.join(ROOT, "data", "cr.sqlite");
const INBOX_DIR = path.join(ROOT, "inbox");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const TMP_DIR = path.join(ROOT, "tmp");

fs.mkdirSync(INBOX_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const db = openDb(DATA_DB);

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));

const upload = multer({ dest: TMP_DIR });

function nowISO() {
  return new Date().toISOString();
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, db: "ok", time: nowISO(), port: PORT });
});

function getInvoice(id) {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id);
  if (!inv) return null;
  const items = db
    .prepare(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY line_no ASC, id ASC`)
    .all(id);
  return { ...inv, items };
}

function upsertInvoice(payload) {
  const totals = computeTotals(payload);

  const inv = {
    id: payload.id || null,
    invoice_number: payload.invoice_number || "",
    sold_to: payload.sold_to || "",
    directions: payload.directions || "",
    email: payload.email || "",
    order_date: payload.order_date || "",
    home_phone: payload.home_phone || "",
    cell_phone: payload.cell_phone || "",
    installation_date: payload.installation_date || "",
    installed_by: payload.installed_by || "",
    salesperson: payload.salesperson || "",

    tax_rate: Number(payload.tax_rate || 0),
    deposit: Number(payload.deposit || 0),

    installation_instructions: payload.installation_instructions || "",
    notes: payload.notes || "",

    subtotal: totals.subtotal,
    sales_tax: totals.sales_tax,
    total: totals.total,
    balance: totals.balance,

    raw_text: payload.raw_text || "",
    source_filename: payload.source_filename || "",
    source_path: payload.source_path || "",

    created_at: payload.created_at || nowISO(),
    updated_at: nowISO()
  };

  const isUpdate = !!inv.id;

  if (!isUpdate) {
    const info = db.prepare(`
      INSERT INTO invoices
      (invoice_number, sold_to, directions, email, order_date, home_phone, cell_phone,
       installation_date, installed_by, salesperson, tax_rate, deposit, installation_instructions, notes,
       subtotal, sales_tax, total, balance, raw_text, source_filename, source_path, created_at, updated_at)
      VALUES
      (@invoice_number, @sold_to, @directions, @email, @order_date, @home_phone, @cell_phone,
       @installation_date, @installed_by, @salesperson, @tax_rate, @deposit, @installation_instructions, @notes,
       @subtotal, @sales_tax, @total, @balance, @raw_text, @source_filename, @source_path, @created_at, @updated_at)
    `).run(inv);
    inv.id = info.lastInsertRowid;
  } else {
    db.prepare(`
      UPDATE invoices SET
        invoice_number=@invoice_number,
        sold_to=@sold_to,
        directions=@directions,
        email=@email,
        order_date=@order_date,
        home_phone=@home_phone,
        cell_phone=@cell_phone,
        installation_date=@installation_date,
        installed_by=@installed_by,
        salesperson=@salesperson,
        tax_rate=@tax_rate,
        deposit=@deposit,
        installation_instructions=@installation_instructions,
        notes=@notes,
        subtotal=@subtotal,
        sales_tax=@sales_tax,
        total=@total,
        balance=@balance,
        raw_text=@raw_text,
        source_filename=@source_filename,
        source_path=@source_path,
        updated_at=@updated_at
      WHERE id=@id
    `).run(inv);
  }

  // Replace items
  db.prepare(`DELETE FROM invoice_items WHERE invoice_id=?`).run(inv.id);

  const insertItem = db.prepare(`
    INSERT INTO invoice_items
    (invoice_id, line_no, description, manufacturer, size, style, color, pad, rug_pad, qty, unit_price, amount)
    VALUES
    (@invoice_id, @line_no, @description, @manufacturer, @size, @style, @color, @pad, @rug_pad, @qty, @unit_price, @amount)
  `);

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    insertItem.run({
      invoice_id: inv.id,
      line_no: Number(it.line_no || (i + 1)),
      description: String(it.description || "").slice(0, 200),
      manufacturer: String(it.manufacturer || "").slice(0, 200),
      size: String(it.size || "").slice(0, 200),
      style: String(it.style || "").slice(0, 200),
      color: String(it.color || "").slice(0, 200),
      pad: String(it.pad || "").slice(0, 200),
      rug_pad: String(it.rug_pad || "").slice(0, 200),
      qty: Number(it.qty || 0),
      unit_price: Number(it.unit_price || 0),
      amount: Number(it.amount || 0)
    });
  }

  return getInvoice(inv.id);
}

app.get("/api/invoices", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    const rows = db.prepare(`
      SELECT id, invoice_number, sold_to, installation_date, total, updated_at
      FROM invoices
      ORDER BY updated_at DESC
      LIMIT 250
    `).all();
    return res.json(rows);
  }

  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT id, invoice_number, sold_to, installation_date, total, updated_at
    FROM invoices
    WHERE invoice_number LIKE ? OR sold_to LIKE ? OR directions LIKE ? OR home_phone LIKE ? OR cell_phone LIKE ?
    ORDER BY updated_at DESC
    LIMIT 250
  `).all(like, like, like, like, like);

  res.json(rows);
});

app.get("/api/invoices/:id", (req, res) => {
  const inv = getInvoice(Number(req.params.id));
  if (!inv) return res.status(404).json({ error: "Not found" });
  res.json(inv);
});

app.post("/api/invoices", (req, res) => {
  try {
    const saved = upsertInvoice(req.body || {});
    res.json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Save failed" });
  }
});

app.delete("/api/invoices/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    db.prepare(`DELETE FROM invoice_items WHERE invoice_id=?`).run(id);
    db.prepare(`DELETE FROM invoices WHERE id=?`).run(id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Delete failed" });
  }
});

app.get("/api/installs", (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!date) return res.json([]);
  const rows = db.prepare(`
    SELECT id, invoice_number, sold_to, directions, home_phone, cell_phone, installation_date, installed_by, installation_instructions, total, balance
    FROM invoices
    WHERE installation_date = ?
    ORDER BY sold_to ASC
  `).all(date);
  res.json(rows);
});

app.post("/api/upload", upload.single("scan"), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "No file" });

    const safeName = `${Date.now()}_${(f.originalname || "scan").replace(/[^\w.\- ]+/g, "_")}`;
    const dest = path.join(UPLOADS_DIR, safeName);
    fs.renameSync(f.path, dest);

    const raw = await ocrImageToText(dest);
    const extracted = extractFromOCR(raw);

    const saved = upsertInvoice({
      ...extracted,
      raw_text: raw,
      source_filename: safeName,
      source_path: `/uploads/${safeName}`,
      tax_rate: 0.0,
      deposit: 0.0,
      installation_instructions: "",
      notes: ""
    });

    res.json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload/OCR failed" });
  }
});

app.get("/api/invoices/:id/pdf", (req, res) => {
  const inv = getInvoice(Number(req.params.id));
  if (!inv) return res.status(404).end();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="C_R_WorkOrder_${inv.invoice_number || inv.id}.pdf"`);

  const doc = new PDFDocument({ margin: 36 });
  doc.pipe(res);

  doc.fontSize(18).text("C&R Carpet & Rug — Work Order");
  doc.moveDown(0.5);

  doc.fontSize(10).text(`Invoice: ${inv.invoice_number || ""}`);
  doc.text(`Sold To: ${inv.sold_to || ""}`);
  doc.text(`Directions: ${inv.directions || ""}`);
  doc.text(`Email: ${inv.email || ""}`);
  doc.text(`Home: ${inv.home_phone || ""}  Cell: ${inv.cell_phone || ""}`);
  doc.text(`Order Date: ${inv.order_date || ""}   Install Date: ${inv.installation_date || ""}`);
  doc.text(`Installed By: ${inv.installed_by || ""}   Salesperson: ${inv.salesperson || ""}`);
  doc.moveDown();

  doc.fontSize(12).text("Items");
  doc.moveDown(0.3);

  const cols = { desc: 36, mfg: 210, size: 320, style: 400, amt: 520 };
  doc.fontSize(9).text("Desc", cols.desc, doc.y);
  doc.text("Mfg", cols.mfg, doc.y);
  doc.text("Size", cols.size, doc.y);
  doc.text("Style", cols.style, doc.y);
  doc.text("Amount", cols.amt, doc.y);
  doc.moveDown(0.6);

  let y = doc.y;
  for (const it of inv.items || []) {
    doc.text(it.description || "", cols.desc, y, { width: 160 });
    doc.text(it.manufacturer || "", cols.mfg, y, { width: 105 });
    doc.text(it.size || "", cols.size, y, { width: 75 });
    doc.text(it.style || "", cols.style, y, { width: 110 });
    doc.text(`$${Number(it.amount || 0).toFixed(2)}`, cols.amt, y);
    y += 34;
    if (y > 700) {
      doc.addPage();
      y = doc.y;
    }
  }

  doc.moveDown();
  doc.fontSize(12).text("Install Instructions");
  doc.fontSize(10).text(inv.installation_instructions || "(none)");
  doc.moveDown();

  doc.fontSize(12).text("Totals");
  doc.fontSize(10).text(`Subtotal: $${Number(inv.subtotal || 0).toFixed(2)}`);
  doc.text(`Sales Tax: $${Number(inv.sales_tax || 0).toFixed(2)}`);
  doc.text(`Total: $${Number(inv.total || 0).toFixed(2)}`);
  doc.text(`Deposit: $${Number(inv.deposit || 0).toFixed(2)}`);
  doc.text(`Balance: $${Number(inv.balance || 0).toFixed(2)}`);

  doc.end();
});

// Inbox watcher (drop scans into ./inbox)
const watcher = chokidar.watch(INBOX_DIR, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 }
});

watcher.on("add", async (filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"].includes(ext)) return;

    const base = path.basename(filePath);
    const safeName = `${Date.now()}_${base}`.replace(/[^\w.\- ]+/g, "_");
    const dest = path.join(UPLOADS_DIR, safeName);

    fs.copyFileSync(filePath, dest);
    fs.unlinkSync(filePath);

    const raw = await ocrImageToText(dest);
    const extracted = extractFromOCR(raw);

    upsertInvoice({
      ...extracted,
      raw_text: raw,
      source_filename: safeName,
      source_path: `/uploads/${safeName}`,
      tax_rate: 0.0,
      deposit: 0.0,
      installation_instructions: "",
      notes: ""
    });

    console.log(`[WATCHER] processed: ${safeName}`);
  } catch (e) {
    console.error("[WATCHER] failed:", e);
  }
});

app.listen(PORT, () => {
  console.log(`Running: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Drop scans into: ${INBOX_DIR}`);
});
