import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 2;

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT,
      sold_to TEXT,
      directions TEXT,
      email TEXT,
      order_date TEXT,
      home_phone TEXT,
      cell_phone TEXT,
      installation_date TEXT,
      installed_by TEXT,
      salesperson TEXT,

      tax_rate REAL DEFAULT 0,
      deposit REAL DEFAULT 0,

      installation_instructions TEXT,
      notes TEXT,

      subtotal REAL DEFAULT 0,
      sales_tax REAL DEFAULT 0,
      total REAL DEFAULT 0,
      balance REAL DEFAULT 0,

      raw_text TEXT,
      source_filename TEXT,
      source_path TEXT,

      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_sold_to ON invoices(sold_to);
    CREATE INDEX IF NOT EXISTS idx_invoices_installation_date ON invoices(installation_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_updated_at ON invoices(updated_at);

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      line_no INTEGER DEFAULT 1,
      description TEXT,
      manufacturer TEXT,
      size TEXT,
      style TEXT,
      color TEXT,
      pad TEXT,
      rug_pad TEXT,
      qty REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      amount REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_items_invoice_id ON invoice_items(invoice_id);
  `);

  migrateSchema(db);

  return db;
}

function migrateSchema(db) {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) || 0);
  if (currentVersion >= SCHEMA_VERSION) return;

  // Migration path note:
  // v1 = original invoices + invoice_items schema.
  // v2 = adds form-first normalized tables while keeping v1 columns as compatibility mirrors.
  // Future versions should continue additive migrations and never drop legacy columns in-place.
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_forms (
      invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
      form_version TEXT DEFAULT 'paper-v1',

      header_invoice_number TEXT,

      customer_name TEXT,
      service_address TEXT,
      customer_email TEXT,

      order_date TEXT,
      home_phone TEXT,
      cell_phone TEXT,
      installation_date TEXT,
      installed_by TEXT,
      salesperson TEXT,

      manufacturer TEXT,
      size TEXT,
      style TEXT,
      color TEXT,
      pad TEXT,
      rug_pad TEXT,

      install_area_notes TEXT,

      merchandise_total REAL DEFAULT 0,
      sales_tax REAL DEFAULT 0,
      total_sale REAL DEFAULT 0,
      deposit REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      payment_method TEXT,

      buyer_signature_name TEXT,
      buyer_signature_date TEXT,

      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS form_install_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      line_no INTEGER DEFAULT 1,
      area_name TEXT,
      area_notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_form_install_areas_invoice_id ON form_install_areas(invoice_id);

    CREATE TABLE IF NOT EXISTS form_hear_about (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      channel_key TEXT NOT NULL,
      channel_label TEXT,
      checked INTEGER DEFAULT 1
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_form_hear_about_unique ON form_hear_about(invoice_id, channel_key);
  `);

  backfillLegacyRowsIntoForms(db);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function backfillLegacyRowsIntoForms(db) {
  const rows = db.prepare(`
    SELECT i.*, it.manufacturer, it.size, it.style, it.color, it.pad, it.rug_pad
    FROM invoices i
    LEFT JOIN invoice_items it ON it.invoice_id = i.id
    AND it.id = (
      SELECT id FROM invoice_items ii
      WHERE ii.invoice_id = i.id
      ORDER BY line_no ASC, id ASC
      LIMIT 1
    )
    WHERE NOT EXISTS (SELECT 1 FROM customer_forms cf WHERE cf.invoice_id = i.id)
  `).all();

  if (!rows.length) return;

  const insertForm = db.prepare(`
    INSERT INTO customer_forms (
      invoice_id, form_version, header_invoice_number,
      customer_name, service_address, customer_email,
      order_date, home_phone, cell_phone, installation_date, installed_by, salesperson,
      manufacturer, size, style, color, pad, rug_pad,
      install_area_notes,
      merchandise_total, sales_tax, total_sale, deposit, balance, payment_method,
      buyer_signature_name, buyer_signature_date,
      created_at, updated_at
    ) VALUES (
      @invoice_id, @form_version, @header_invoice_number,
      @customer_name, @service_address, @customer_email,
      @order_date, @home_phone, @cell_phone, @installation_date, @installed_by, @salesperson,
      @manufacturer, @size, @style, @color, @pad, @rug_pad,
      @install_area_notes,
      @merchandise_total, @sales_tax, @total_sale, @deposit, @balance, @payment_method,
      @buyer_signature_name, @buyer_signature_date,
      @created_at, @updated_at
    )
  `);

  const tx = db.transaction((records) => {
    for (const row of records) {
      insertForm.run({
        invoice_id: row.id,
        form_version: "paper-v1",
        header_invoice_number: row.invoice_number || "",
        customer_name: row.sold_to || "",
        service_address: row.directions || "",
        customer_email: row.email || "",
        order_date: row.order_date || "",
        home_phone: row.home_phone || "",
        cell_phone: row.cell_phone || "",
        installation_date: row.installation_date || "",
        installed_by: row.installed_by || "",
        salesperson: row.salesperson || "",
        manufacturer: row.manufacturer || "",
        size: row.size || "",
        style: row.style || "",
        color: row.color || "",
        pad: row.pad || "",
        rug_pad: row.rug_pad || "",
        install_area_notes: row.installation_instructions || "",
        merchandise_total: Number(row.subtotal || 0),
        sales_tax: Number(row.sales_tax || 0),
        total_sale: Number(row.total || 0),
        deposit: Number(row.deposit || 0),
        balance: Number(row.balance || 0),
        payment_method: "",
        buyer_signature_name: "",
        buyer_signature_date: "",
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString()
      });
    }
  });

  tx(rows);
}

export function getInvoiceForm(db, invoiceId) {
  const form = db.prepare(`SELECT * FROM customer_forms WHERE invoice_id=?`).get(invoiceId);
  if (!form) return null;

  const install_areas = db
    .prepare(`SELECT id, line_no, area_name, area_notes FROM form_install_areas WHERE invoice_id=? ORDER BY line_no ASC, id ASC`)
    .all(invoiceId);

  const hear_about = db
    .prepare(`SELECT channel_key, channel_label, checked FROM form_hear_about WHERE invoice_id=? ORDER BY id ASC`)
    .all(invoiceId)
    .map((row) => ({
      key: row.channel_key,
      label: row.channel_label || row.channel_key,
      checked: !!row.checked
    }));

  return { ...form, install_areas, hear_about };
}

export function upsertInvoiceForm(db, invoiceId, formPayload, fallbackLegacy, nowIso) {
  const firstItem = Array.isArray(fallbackLegacy?.items) && fallbackLegacy.items.length ? fallbackLegacy.items[0] : {};
  const incoming = formPayload || {};

  const normalized = {
    invoice_id: invoiceId,
    form_version: "paper-v1",
    header_invoice_number: incoming.header_invoice_number ?? fallbackLegacy.invoice_number ?? "",
    customer_name: incoming.customer_name ?? fallbackLegacy.sold_to ?? "",
    service_address: incoming.service_address ?? fallbackLegacy.directions ?? "",
    customer_email: incoming.customer_email ?? fallbackLegacy.email ?? "",
    order_date: incoming.order_date ?? fallbackLegacy.order_date ?? "",
    home_phone: incoming.home_phone ?? fallbackLegacy.home_phone ?? "",
    cell_phone: incoming.cell_phone ?? fallbackLegacy.cell_phone ?? "",
    installation_date: incoming.installation_date ?? fallbackLegacy.installation_date ?? "",
    installed_by: incoming.installed_by ?? fallbackLegacy.installed_by ?? "",
    salesperson: incoming.salesperson ?? fallbackLegacy.salesperson ?? "",
    manufacturer: incoming.manufacturer ?? firstItem.manufacturer ?? "",
    size: incoming.size ?? firstItem.size ?? "",
    style: incoming.style ?? firstItem.style ?? "",
    color: incoming.color ?? firstItem.color ?? "",
    pad: incoming.pad ?? firstItem.pad ?? "",
    rug_pad: incoming.rug_pad ?? firstItem.rug_pad ?? "",
    install_area_notes: incoming.install_area_notes ?? fallbackLegacy.installation_instructions ?? "",
    merchandise_total: Number(incoming.merchandise_total ?? fallbackLegacy.subtotal ?? 0),
    sales_tax: Number(incoming.sales_tax ?? fallbackLegacy.sales_tax ?? 0),
    total_sale: Number(incoming.total_sale ?? fallbackLegacy.total ?? 0),
    deposit: Number(incoming.deposit ?? fallbackLegacy.deposit ?? 0),
    balance: Number(incoming.balance ?? fallbackLegacy.balance ?? 0),
    payment_method: incoming.payment_method ?? "",
    buyer_signature_name: incoming.buyer_signature_name ?? "",
    buyer_signature_date: incoming.buyer_signature_date ?? "",
    created_at: nowIso,
    updated_at: nowIso
  };

  const existing = db.prepare(`SELECT invoice_id, created_at FROM customer_forms WHERE invoice_id=?`).get(invoiceId);
  if (existing?.created_at) normalized.created_at = existing.created_at;

  db.prepare(`
    INSERT INTO customer_forms (
      invoice_id, form_version, header_invoice_number,
      customer_name, service_address, customer_email,
      order_date, home_phone, cell_phone, installation_date, installed_by, salesperson,
      manufacturer, size, style, color, pad, rug_pad,
      install_area_notes,
      merchandise_total, sales_tax, total_sale, deposit, balance, payment_method,
      buyer_signature_name, buyer_signature_date,
      created_at, updated_at
    ) VALUES (
      @invoice_id, @form_version, @header_invoice_number,
      @customer_name, @service_address, @customer_email,
      @order_date, @home_phone, @cell_phone, @installation_date, @installed_by, @salesperson,
      @manufacturer, @size, @style, @color, @pad, @rug_pad,
      @install_area_notes,
      @merchandise_total, @sales_tax, @total_sale, @deposit, @balance, @payment_method,
      @buyer_signature_name, @buyer_signature_date,
      @created_at, @updated_at
    )
    ON CONFLICT(invoice_id) DO UPDATE SET
      form_version=excluded.form_version,
      header_invoice_number=excluded.header_invoice_number,
      customer_name=excluded.customer_name,
      service_address=excluded.service_address,
      customer_email=excluded.customer_email,
      order_date=excluded.order_date,
      home_phone=excluded.home_phone,
      cell_phone=excluded.cell_phone,
      installation_date=excluded.installation_date,
      installed_by=excluded.installed_by,
      salesperson=excluded.salesperson,
      manufacturer=excluded.manufacturer,
      size=excluded.size,
      style=excluded.style,
      color=excluded.color,
      pad=excluded.pad,
      rug_pad=excluded.rug_pad,
      install_area_notes=excluded.install_area_notes,
      merchandise_total=excluded.merchandise_total,
      sales_tax=excluded.sales_tax,
      total_sale=excluded.total_sale,
      deposit=excluded.deposit,
      balance=excluded.balance,
      payment_method=excluded.payment_method,
      buyer_signature_name=excluded.buyer_signature_name,
      buyer_signature_date=excluded.buyer_signature_date,
      updated_at=excluded.updated_at
  `).run(normalized);

  db.prepare(`DELETE FROM form_install_areas WHERE invoice_id=?`).run(invoiceId);
  const addArea = db.prepare(`
    INSERT INTO form_install_areas (invoice_id, line_no, area_name, area_notes)
    VALUES (@invoice_id, @line_no, @area_name, @area_notes)
  `);
  const areas = Array.isArray(incoming.install_areas) ? incoming.install_areas : [];
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i] || {};
    addArea.run({
      invoice_id: invoiceId,
      line_no: Number(area.line_no || i + 1),
      area_name: String(area.area_name || "").slice(0, 200),
      area_notes: String(area.area_notes || "").slice(0, 1000)
    });
  }

  db.prepare(`DELETE FROM form_hear_about WHERE invoice_id=?`).run(invoiceId);
  const addHear = db.prepare(`
    INSERT INTO form_hear_about (invoice_id, channel_key, channel_label, checked)
    VALUES (@invoice_id, @channel_key, @channel_label, @checked)
  `);
  const heard = Array.isArray(incoming.hear_about) ? incoming.hear_about : [];
  for (const item of heard) {
    if (!item?.key) continue;
    addHear.run({
      invoice_id: invoiceId,
      channel_key: String(item.key).slice(0, 120),
      channel_label: String(item.label || item.key).slice(0, 200),
      checked: item.checked === false ? 0 : 1
    });
  }
}

export function computeTotals(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const subtotal = items.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);

  const taxRate = Number(payload.tax_rate || 0) / 100;
  const sales_tax = round2(subtotal * taxRate);

  const total = round2(subtotal + sales_tax);
  const deposit = Number(payload.deposit || 0);
  const balance = round2(total - deposit);

  return {
    subtotal: round2(subtotal),
    sales_tax,
    total,
    balance
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
