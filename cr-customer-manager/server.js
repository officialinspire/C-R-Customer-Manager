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

function asBoolInt(v) {
  return v ? 1 : 0;
}

function normalizeInvoiceNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return raw.toUpperCase();
  return `CR ${digits.slice(0, 5).padStart(5, "0")}`;
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

  // Legacy compatibility payload for existing clients.
  return {
    ...inv,
    email: inv.customer_email || inv.email || "",
    total: inv.total_sale,
    subtotal: inv.merchandise_total,
    items,
    form: null
  };
}

function buildInvoicePayload(payload) {
  const form = payload?.form || {};
  const now = nowISO();
  const totals = computeTotals({
    ...payload,
    merchandise_total: payload.merchandise_total ?? form.merchandise_total,
    sales_tax: payload.sales_tax ?? form.sales_tax,
    total_sale: payload.total_sale ?? form.total_sale,
    deposit: payload.deposit ?? form.deposit,
    balance: payload.balance ?? form.balance
  });

  return {
    id: payload.id || null,
    invoice_number: normalizeInvoiceNumber(payload.invoice_number || form.header_invoice_number || ""),
    sold_to: payload.sold_to || form.customer_name || "",
    directions: payload.directions || form.service_address || "",
    customer_email: payload.customer_email || payload.email || form.customer_email || "",
    order_date: payload.order_date || form.order_date || "",
    home_phone: payload.home_phone || form.home_phone || "",
    cell_phone: payload.cell_phone || form.cell_phone || "",
    installation_date: payload.installation_date || form.installation_date || "",
    installed_by: payload.installed_by || form.installed_by || "",
    salesperson: payload.salesperson || form.salesperson || "",

    heard_ad: asBoolInt(payload.heard_ad ?? form.heard_ad),
    heard_radio: asBoolInt(payload.heard_radio ?? form.heard_radio),
    heard_friend: asBoolInt(payload.heard_friend ?? form.heard_friend),
    heard_internet: asBoolInt(payload.heard_internet ?? form.heard_internet),
    heard_walkin: asBoolInt(payload.heard_walkin ?? form.heard_walkin),

    manufacturer: payload.manufacturer || form.manufacturer || "",
    size: payload.size || form.size || "",
    style: payload.style || form.style || "",
    color: payload.color || form.color || "",
    pad: payload.pad || form.pad || "",
    rug_pad: payload.rug_pad || form.rug_pad || "",
    unit_price: Number(payload.unit_price ?? form.unit_price ?? 0),
    amount: Number(payload.amount ?? form.amount ?? 0),

    install_lvg_rm: asBoolInt(payload.install_lvg_rm ?? form.install_lvg_rm),
    install_din_rm: asBoolInt(payload.install_din_rm ?? form.install_din_rm),
    install_bdrm1: asBoolInt(payload.install_bdrm1 ?? form.install_bdrm1),
    install_bdrm2: asBoolInt(payload.install_bdrm2 ?? form.install_bdrm2),
    install_bdrm3: asBoolInt(payload.install_bdrm3 ?? form.install_bdrm3),
    install_bdrm4: asBoolInt(payload.install_bdrm4 ?? form.install_bdrm4),
    install_hall: asBoolInt(payload.install_hall ?? form.install_hall),
    install_stairs: asBoolInt(payload.install_stairs ?? form.install_stairs),
    install_closet: asBoolInt(payload.install_closet ?? form.install_closet),
    install_basement: asBoolInt(payload.install_basement ?? form.install_basement),
    install_fam_rm: asBoolInt(payload.install_fam_rm ?? form.install_fam_rm),
    installation_instructions: payload.installation_instructions || form.installation_instructions || form.install_area_notes || "",

    merchandise_total: totals.merchandise_total,
    sales_tax: totals.sales_tax,
    total_sale: totals.total_sale,
    deposit: totals.deposit,
    balance: totals.balance,
    payment_cash: asBoolInt(payload.payment_cash ?? form.payment_cash),
    payment_check: asBoolInt(payload.payment_check ?? form.payment_check),
    payment_charge: asBoolInt(payload.payment_charge ?? form.payment_charge),
    payment_financing: asBoolInt(payload.payment_financing ?? form.payment_financing),

    buyer_name: payload.buyer_name || form.buyer_name || form.buyer_signature_name || "",
    buyer_date: payload.buyer_date || form.buyer_date || form.buyer_signature_date || "",
    notes: payload.notes || "",

    raw_text: payload.raw_text || "",
    source_filename: payload.source_filename || "",
    source_path: payload.source_path || "",
    ocr_status: payload.ocr_status || "pending",
    ocr_confidence: Number(payload.ocr_confidence || 0),

    // Legacy mirrors
    email: payload.customer_email || payload.email || form.customer_email || "",
    tax_rate: Number(payload.tax_rate || 0),
    subtotal: totals.subtotal,
    total: totals.total,

    created_at: payload.created_at || now,
    updated_at: now
  };
}

function upsertInvoice(payload) {
  const inv = buildInvoicePayload(payload);

  const tx = db.transaction((record, rawPayload) => {
    const isUpdate = !!record.id;

    if (!isUpdate) {
      const info = db.prepare(`
        INSERT INTO invoices (
          invoice_number, sold_to, directions, customer_email, order_date, home_phone, cell_phone,
          installation_date, installed_by, salesperson,
          heard_ad, heard_radio, heard_friend, heard_internet, heard_walkin,
          manufacturer, size, style, color, pad, rug_pad, unit_price, amount,
          install_lvg_rm, install_din_rm, install_bdrm1, install_bdrm2, install_bdrm3, install_bdrm4,
          install_hall, install_stairs, install_closet, install_basement, install_fam_rm, installation_instructions,
          merchandise_total, sales_tax, total_sale, deposit, balance,
          payment_cash, payment_check, payment_charge, payment_financing,
          buyer_name, buyer_date, notes,
          raw_text, source_filename, source_path, ocr_status, ocr_confidence,
          created_at, updated_at,
          email, tax_rate, subtotal, total
        ) VALUES (
          @invoice_number, @sold_to, @directions, @customer_email, @order_date, @home_phone, @cell_phone,
          @installation_date, @installed_by, @salesperson,
          @heard_ad, @heard_radio, @heard_friend, @heard_internet, @heard_walkin,
          @manufacturer, @size, @style, @color, @pad, @rug_pad, @unit_price, @amount,
          @install_lvg_rm, @install_din_rm, @install_bdrm1, @install_bdrm2, @install_bdrm3, @install_bdrm4,
          @install_hall, @install_stairs, @install_closet, @install_basement, @install_fam_rm, @installation_instructions,
          @merchandise_total, @sales_tax, @total_sale, @deposit, @balance,
          @payment_cash, @payment_check, @payment_charge, @payment_financing,
          @buyer_name, @buyer_date, @notes,
          @raw_text, @source_filename, @source_path, @ocr_status, @ocr_confidence,
          @created_at, @updated_at,
          @email, @tax_rate, @subtotal, @total
        )
      `).run(record);
      record.id = info.lastInsertRowid;
    } else {
      db.prepare(`
        UPDATE invoices SET
          invoice_number=@invoice_number,
          sold_to=@sold_to,
          directions=@directions,
          customer_email=@customer_email,
          order_date=@order_date,
          home_phone=@home_phone,
          cell_phone=@cell_phone,
          installation_date=@installation_date,
          installed_by=@installed_by,
          salesperson=@salesperson,
          heard_ad=@heard_ad,
          heard_radio=@heard_radio,
          heard_friend=@heard_friend,
          heard_internet=@heard_internet,
          heard_walkin=@heard_walkin,
          manufacturer=@manufacturer,
          size=@size,
          style=@style,
          color=@color,
          pad=@pad,
          rug_pad=@rug_pad,
          unit_price=@unit_price,
          amount=@amount,
          install_lvg_rm=@install_lvg_rm,
          install_din_rm=@install_din_rm,
          install_bdrm1=@install_bdrm1,
          install_bdrm2=@install_bdrm2,
          install_bdrm3=@install_bdrm3,
          install_bdrm4=@install_bdrm4,
          install_hall=@install_hall,
          install_stairs=@install_stairs,
          install_closet=@install_closet,
          install_basement=@install_basement,
          install_fam_rm=@install_fam_rm,
          installation_instructions=@installation_instructions,
          merchandise_total=@merchandise_total,
          sales_tax=@sales_tax,
          total_sale=@total_sale,
          deposit=@deposit,
          balance=@balance,
          payment_cash=@payment_cash,
          payment_check=@payment_check,
          payment_charge=@payment_charge,
          payment_financing=@payment_financing,
          buyer_name=@buyer_name,
          buyer_date=@buyer_date,
          notes=@notes,
          raw_text=@raw_text,
          source_filename=@source_filename,
          source_path=@source_path,
          ocr_status=@ocr_status,
          ocr_confidence=@ocr_confidence,
          updated_at=@updated_at,
          email=@email,
          tax_rate=@tax_rate,
          subtotal=@subtotal,
          total=@total
        WHERE id=@id
      `).run(record);
    }

    // Legacy-only detail lines; optional for new form-first flow.
    db.prepare(`DELETE FROM invoice_items WHERE invoice_id=?`).run(record.id);

    const insertItem = db.prepare(`
      INSERT INTO invoice_items
      (invoice_id, line_no, description, manufacturer, size, style, color, pad, rug_pad, qty, unit_price, amount)
      VALUES
      (@invoice_id, @line_no, @description, @manufacturer, @size, @style, @color, @pad, @rug_pad, @qty, @unit_price, @amount)
    `);

    const items = Array.isArray(rawPayload.items) ? rawPayload.items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      insertItem.run({
        invoice_id: record.id,
        line_no: Number(it.line_no || i + 1),
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

    return record.id;
  });

  const savedId = tx(inv, payload);
  return getInvoice(savedId);
}

app.get("/api/invoices", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    const rows = db.prepare(`
      SELECT id, invoice_number, sold_to, directions, home_phone, cell_phone, installation_date, total_sale AS total, updated_at
      FROM invoices
      ORDER BY updated_at DESC
      LIMIT 250
    `).all();
    return res.json(rows);
  }

  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT id, invoice_number, sold_to, directions, home_phone, cell_phone, installation_date, total_sale AS total, updated_at
    FROM invoices
    WHERE invoice_number LIKE ?
      OR sold_to LIKE ?
      OR directions LIKE ?
      OR home_phone LIKE ?
      OR cell_phone LIKE ?
      OR customer_email LIKE ?
      OR installed_by LIKE ?
      OR salesperson LIKE ?
      OR installation_instructions LIKE ?
      OR notes LIKE ?
      OR raw_text LIKE ?
    ORDER BY updated_at DESC
    LIMIT 250
  `).all(like, like, like, like, like, like, like, like, like, like, like);

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
    if (String(e.message || "").includes("idx_invoices_invoice_number_nonempty_unique")) {
      return res.status(409).json({ error: "invoice_number must be unique when provided" });
    }
    res.status(500).json({ error: "Save failed" });
  }
});

app.post("/api/invoices/:id/rescan", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = getInvoice(id);
    if (!existing) return res.status(404).json({ error: "Invoice not found" });

    const sourceCandidate = existing.source_filename
      ? path.join(UPLOADS_DIR, existing.source_filename)
      : path.join(ROOT, String(existing.source_path || "").replace(/^\//, ""));

    if (!sourceCandidate || !fs.existsSync(sourceCandidate)) {
      return res.status(400).json({ error: "This invoice has no available source scan to reprocess" });
    }

    const raw = await ocrImageToText(sourceCandidate);
    const extracted = extractFromOCR(raw);
    const saved = upsertInvoice({
      ...existing,
      ...extracted,
      id,
      raw_text: raw,
      source_filename: existing.source_filename || path.basename(sourceCandidate),
      source_path: existing.source_path || `/uploads/${path.basename(sourceCandidate)}`,
      ocr_status: "processed",
      ocr_confidence: Number(existing.ocr_confidence || 0)
    });

    res.json(saved);
  } catch (e) {
    console.error(e);
    if (String(e.message || "").includes("idx_invoices_invoice_number_nonempty_unique")) {
      return res.status(409).json({ error: "invoice_number must be unique when provided" });
    }
    res.status(500).json({ error: "Re-scan failed" });
  }
});

app.delete("/api/invoices/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const tx = db.transaction((rowId) => {
      db.prepare(`DELETE FROM invoice_items WHERE invoice_id=?`).run(rowId);
      db.prepare(`DELETE FROM invoices WHERE id=?`).run(rowId);
    });
    tx(id);
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
    SELECT id, invoice_number, sold_to, directions, home_phone, cell_phone, installation_date, installed_by, installation_instructions, total_sale AS total, balance
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
      ocr_status: "processed",
      ocr_confidence: 0
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
  doc.text(`Email: ${inv.customer_email || inv.email || ""}`);
  doc.text(`Home: ${inv.home_phone || ""}  Cell: ${inv.cell_phone || ""}`);
  doc.text(`Order Date: ${inv.order_date || ""}   Install Date: ${inv.installation_date || ""}`);
  doc.text(`Installed By: ${inv.installed_by || ""}   Salesperson: ${inv.salesperson || ""}`);
  doc.moveDown();

  doc.fontSize(12).text("Items (legacy optional)");
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
  doc.fontSize(10).text(`Merchandise Total: $${Number(inv.merchandise_total || 0).toFixed(2)}`);
  doc.text(`Sales Tax: $${Number(inv.sales_tax || 0).toFixed(2)}`);
  doc.text(`Total Sale: $${Number(inv.total_sale || 0).toFixed(2)}`);
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
      ocr_status: "processed",
      ocr_confidence: 0
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
