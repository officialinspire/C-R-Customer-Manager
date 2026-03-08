import fs from "fs";
import path from "path";
import express from "express";
import chokidar from "chokidar";
import multer from "multer";
import PDFDocument from "pdfkit";

import { openDb, computeTotals } from "./db.js";
import { ocrImage } from "./ocr.js";
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

function cleanFilePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function textOrBlank(value) {
  const v = String(value || "").trim();
  return v || "—";
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
    ocr_status: payload.ocr_status || "pending_review",
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

    const ocrResult = await ocrImage(sourceCandidate);
    const extracted = extractFromOCR(ocrResult.rawText, ocrResult);

    // Review-first: return a draft preview only; caller must explicitly save.
    res.json({
      ...existing,
      ...extracted,
      id,
      raw_text: ocrResult.rawText,
      source_filename: existing.source_filename || path.basename(sourceCandidate),
      source_path: existing.source_path || `/uploads/${path.basename(sourceCandidate)}`,
      ocr_status: "pending_review",
      ocr_confidence: Math.round(ocrResult.averageConfidence),
      ocr_fields: ocrResult.fields,
      low_confidence_fields: extracted.low_confidence_fields || ocrResult.lowConfidenceFields
    });
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

    try {
      const ocrResult = await ocrImage(dest);
      const extracted = extractFromOCR(ocrResult.rawText, ocrResult);

      // Review-first import: do not write to DB yet.
      res.json({
        ...extracted,
        id: null,
        raw_text: ocrResult.rawText,
        source_filename: safeName,
        source_path: `/uploads/${safeName}`,
        ocr_status: "pending_review",
        ocr_confidence: Math.round(ocrResult.averageConfidence),
        ocr_fields: ocrResult.fields,
        low_confidence_fields: extracted.low_confidence_fields || ocrResult.lowConfidenceFields
      });
    } catch (ocrError) {
      console.error(ocrError);
      res.status(422).json({
        error: "OCR failed",
        id: null,
        source_filename: safeName,
        source_path: `/uploads/${safeName}`,
        raw_text: "",
        ocr_status: "failed",
        ocr_confidence: 0,
        low_confidence_fields: []
      });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload/OCR failed" });
  }
});

app.get("/api/invoices/:id/pdf", (req, res) => {
  const inv = getInvoice(Number(req.params.id));
  if (!inv) return res.status(404).end();

  const safeInvoice = cleanFilePart(inv.invoice_number || `invoice-${inv.id}`) || `invoice-${inv.id}`;
  const safeCustomer = cleanFilePart(inv.sold_to || "customer") || "customer";
  const fileName = `cr-work-order-form_${safeInvoice}_${safeCustomer}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

  const doc = new PDFDocument({ margin: 24, size: "LETTER" });
  doc.pipe(res);

  const drawField = (label, value, x, y, width, opts = {}) => {
    const fieldHeight = opts.height || 22;
    const labelSize = opts.labelSize || 7;
    const valueSize = opts.valueSize || 10;
    doc.font("Helvetica-Bold").fontSize(labelSize).fillColor("#333").text(label.toUpperCase(), x + 4, y + 2, {
      width: width - 8
    });
    doc.rect(x, y + 10, width, fieldHeight).lineWidth(0.8).stroke("#222");
    doc.font("Helvetica").fontSize(valueSize).fillColor("#000").text(textOrBlank(value), x + 4, y + 15, {
      width: width - 8,
      height: fieldHeight - 4,
      ellipsis: true
    });
  };

  const drawCheck = (label, checked, x, y) => {
    doc.rect(x, y, 10, 10).lineWidth(0.8).stroke("#222");
    if (checked) {
      doc.moveTo(x + 2, y + 5).lineTo(x + 4, y + 8).lineTo(x + 8, y + 2).lineWidth(1.4).stroke("#111");
    }
    doc.font("Helvetica").fontSize(8).fillColor("#111").text(label, x + 14, y - 1);
  };

  const width = doc.page.width;
  const contentLeft = 24;
  const contentRight = width - 24;
  const contentWidth = contentRight - contentLeft;
  const colGap = 8;
  const leftCol = 460;
  const rightCol = contentWidth - leftCol - colGap;

  let y = 24;
  doc.font("Helvetica-Bold").fontSize(17).text("C&R CARPET & RUG", contentLeft, y);
  doc.font("Helvetica").fontSize(9).text("WORK ORDER / SALES FORM", contentLeft, y + 20);
  drawField("Invoice #", inv.invoice_number, contentRight - 180, y - 2, 180, { valueSize: 12 });

  y += 42;
  doc.rect(contentLeft, y, contentWidth, 20).lineWidth(0.8).stroke("#222");
  doc.font("Helvetica-Bold").fontSize(8).text("Lead Source", contentLeft + 6, y + 6);
  drawCheck("Ad", inv.heard_ad, contentLeft + 90, y + 5);
  drawCheck("Radio", inv.heard_radio, contentLeft + 150, y + 5);
  drawCheck("Friend", inv.heard_friend, contentLeft + 220, y + 5);
  drawCheck("Internet", inv.heard_internet, contentLeft + 300, y + 5);
  drawCheck("Walk-in", inv.heard_walkin, contentLeft + 390, y + 5);

  y += 26;
  drawField("Sold To", inv.sold_to, contentLeft, y, 300);
  drawField("Date", inv.order_date, contentLeft + 308, y, 110);
  drawField("Salesperson", inv.salesperson, contentLeft + 426, y, 162);

  y += 36;
  drawField("Directions / Address", inv.directions, contentLeft, y, 420);
  drawField("Customer Email", inv.customer_email || inv.email, contentLeft + 428, y, 160);

  y += 36;
  drawField("Home Phone", inv.home_phone, contentLeft, y, 145);
  drawField("Cell Phone", inv.cell_phone, contentLeft + 153, y, 145);
  drawField("Installation Date", inv.installation_date, contentLeft + 306, y, 140);
  drawField("Installed By", inv.installed_by, contentLeft + 454, y, 134);

  y += 38;
  doc.rect(contentLeft, y, leftCol, 190).lineWidth(0.8).stroke("#222");
  doc.font("Helvetica-Bold").fontSize(8).text("Merchandise", contentLeft + 6, y + 4);

  drawField("Manufacturer", inv.manufacturer, contentLeft + 8, y + 16, 168);
  drawField("Size", inv.size, contentLeft + 184, y + 16, 86);
  drawField("Style", inv.style, contentLeft + 278, y + 16, 174);
  drawField("Color", inv.color, contentLeft + 8, y + 52, 130);
  drawField("Pad", inv.pad, contentLeft + 146, y + 52, 150);
  drawField("Rug Pad", inv.rug_pad, contentLeft + 304, y + 52, 148);
  drawField("Unit Price", money(inv.unit_price), contentLeft + 8, y + 88, 150);
  drawField("Amount", money(inv.amount), contentLeft + 166, y + 88, 150);

  doc.font("Helvetica-Bold").fontSize(8).text("Install Room Grid", contentLeft + 8, y + 130);
  const rooms = [
    ["LVG RM", inv.install_lvg_rm], ["DIN RM", inv.install_din_rm], ["FAM RM", inv.install_fam_rm],
    ["BDRM 1", inv.install_bdrm1], ["BDRM 2", inv.install_bdrm2], ["BDRM 3", inv.install_bdrm3],
    ["BDRM 4", inv.install_bdrm4], ["HALL", inv.install_hall], ["STAIRS", inv.install_stairs],
    ["CLOSET", inv.install_closet], ["BASEMENT", inv.install_basement]
  ];
  rooms.forEach(([label, checked], index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawCheck(label, checked, contentLeft + 8 + (col * 145), y + 144 + (row * 14));
  });

  const rightX = contentLeft + leftCol + colGap;
  doc.rect(rightX, y, rightCol, 190).lineWidth(0.8).stroke("#222");
  doc.font("Helvetica-Bold").fontSize(8).text("Totals & Payment", rightX + 6, y + 4);
  drawField("Merchandise Total", money(inv.merchandise_total), rightX + 8, y + 16, rightCol - 16);
  drawField("Sales Tax", money(inv.sales_tax), rightX + 8, y + 52, rightCol - 16);
  drawField("Total Sale", money(inv.total_sale), rightX + 8, y + 88, rightCol - 16);
  drawField("Deposit", money(inv.deposit), rightX + 8, y + 124, rightCol - 16);
  drawField("Balance", money(inv.balance), rightX + 8, y + 160, rightCol - 16);

  y += 198;
  doc.rect(contentLeft, y, contentWidth, 44).lineWidth(0.8).stroke("#222");
  doc.font("Helvetica-Bold").fontSize(8).text("Payment Method", contentLeft + 6, y + 4);
  drawCheck("Cash", inv.payment_cash, contentLeft + 110, y + 6);
  drawCheck("Check", inv.payment_check, contentLeft + 180, y + 6);
  drawCheck("Charge", inv.payment_charge, contentLeft + 255, y + 6);
  drawCheck("Financing", inv.payment_financing, contentLeft + 338, y + 6);
  drawField("Buyer Name", inv.buyer_name, contentLeft + 8, y + 20, 360);
  drawField("Buyer Date", inv.buyer_date, contentLeft + 376, y + 20, 212);

  y += 50;
  const notesTitleY = y;
  const notesBoxHeight = 86;
  doc.rect(contentLeft, notesTitleY, contentWidth, notesBoxHeight).lineWidth(0.8).stroke("#222");
  doc.font("Helvetica-Bold").fontSize(8).text("Notes / Install Instructions", contentLeft + 6, notesTitleY + 4);

  const notesText = [inv.installation_instructions, inv.notes].filter(Boolean).join("\n\n");
  const notesX = contentLeft + 8;
  const notesY = notesTitleY + 16;
  const notesWidth = contentWidth - 16;
  const notesHeight = notesBoxHeight - 20;
  const lineHeight = 11;
  const maxLines = Math.floor(notesHeight / lineHeight);
  const wrapped = notesText ? doc.heightOfString(notesText, { width: notesWidth, lineGap: 1 }) : 0;
  const visibleHeight = maxLines * lineHeight;
  const hasOverflow = wrapped > visibleHeight;

  doc.font("Helvetica").fontSize(9).fillColor("#111").text(notesText || "—", notesX, notesY, {
    width: notesWidth,
    height: notesHeight,
    ellipsis: hasOverflow ? "…" : false,
    lineGap: 1
  });

  if (hasOverflow) {
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text("Notes / Install Instructions (continued)", contentLeft, 32);
    doc.font("Helvetica").fontSize(10).text(`Invoice ${textOrBlank(inv.invoice_number)}  •  ${textOrBlank(inv.sold_to)}`, contentLeft, 50);
    doc.rect(contentLeft, 72, contentWidth, doc.page.height - 96).lineWidth(0.8).stroke("#222");
    doc.font("Helvetica").fontSize(10).text(notesText, contentLeft + 10, 82, {
      width: contentWidth - 20,
      height: doc.page.height - 116,
      lineGap: 2
    });
  }

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

    // Review-first: inbox watcher only archives scans to uploads.
    console.log(`[WATCHER] queued for review: ${safeName}`);
  } catch (e) {
    console.error("[WATCHER] failed:", e);
  }
});

app.listen(PORT, () => {
  console.log(`Running: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Drop scans into: ${INBOX_DIR}`);
});
