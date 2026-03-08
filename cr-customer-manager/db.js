import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 4;

const REQUIRED_INVOICE_COLUMNS = {
  invoice_number: "TEXT",
  sold_to: "TEXT",
  directions: "TEXT",
  customer_email: "TEXT",
  order_date: "TEXT",
  home_phone: "TEXT",
  cell_phone: "TEXT",
  installation_date: "TEXT",
  installed_by: "TEXT",
  salesperson: "TEXT",

  heard_ad: "INTEGER DEFAULT 0",
  heard_radio: "INTEGER DEFAULT 0",
  heard_friend: "INTEGER DEFAULT 0",
  heard_internet: "INTEGER DEFAULT 0",
  heard_walkin: "INTEGER DEFAULT 0",

  manufacturer: "TEXT",
  size: "TEXT",
  style: "TEXT",
  color: "TEXT",
  pad: "TEXT",
  rug_pad: "TEXT",
  unit_price: "REAL DEFAULT 0",
  amount: "REAL DEFAULT 0",

  install_lvg_rm: "INTEGER DEFAULT 0",
  install_din_rm: "INTEGER DEFAULT 0",
  install_bdrm1: "INTEGER DEFAULT 0",
  install_bdrm2: "INTEGER DEFAULT 0",
  install_bdrm3: "INTEGER DEFAULT 0",
  install_bdrm4: "INTEGER DEFAULT 0",
  install_hall: "INTEGER DEFAULT 0",
  install_stairs: "INTEGER DEFAULT 0",
  install_closet: "INTEGER DEFAULT 0",
  install_basement: "INTEGER DEFAULT 0",
  install_fam_rm: "INTEGER DEFAULT 0",
  installation_instructions: "TEXT",

  merchandise_total: "REAL DEFAULT 0",
  sales_tax: "REAL DEFAULT 0",
  total_sale: "REAL DEFAULT 0",
  deposit: "REAL DEFAULT 0",
  balance: "REAL DEFAULT 0",
  payment_cash: "INTEGER DEFAULT 0",
  payment_check: "INTEGER DEFAULT 0",
  payment_charge: "INTEGER DEFAULT 0",
  payment_financing: "INTEGER DEFAULT 0",

  buyer_name: "TEXT",
  buyer_date: "TEXT",
  notes: "TEXT",

  raw_text: "TEXT",
  source_filename: "TEXT",
  source_path: "TEXT",
  ocr_status: "TEXT DEFAULT 'pending'",
  ocr_confidence: "REAL DEFAULT 0",

  created_at: "TEXT",
  updated_at: "TEXT",

  // Legacy compatibility columns kept for older UI payloads.
  email: "TEXT",
  tax_rate: "REAL DEFAULT 0",
  subtotal: "REAL DEFAULT 0",
  total: "REAL DEFAULT 0"
};

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
      customer_email TEXT,
      order_date TEXT,
      home_phone TEXT,
      cell_phone TEXT,
      installation_date TEXT,
      installed_by TEXT,
      salesperson TEXT,

      heard_ad INTEGER DEFAULT 0,
      heard_radio INTEGER DEFAULT 0,
      heard_friend INTEGER DEFAULT 0,
      heard_internet INTEGER DEFAULT 0,
      heard_walkin INTEGER DEFAULT 0,

      manufacturer TEXT,
      size TEXT,
      style TEXT,
      color TEXT,
      pad TEXT,
      rug_pad TEXT,
      unit_price REAL DEFAULT 0,
      amount REAL DEFAULT 0,

      install_lvg_rm INTEGER DEFAULT 0,
      install_din_rm INTEGER DEFAULT 0,
      install_bdrm1 INTEGER DEFAULT 0,
      install_bdrm2 INTEGER DEFAULT 0,
      install_bdrm3 INTEGER DEFAULT 0,
      install_bdrm4 INTEGER DEFAULT 0,
      install_hall INTEGER DEFAULT 0,
      install_stairs INTEGER DEFAULT 0,
      install_closet INTEGER DEFAULT 0,
      install_basement INTEGER DEFAULT 0,
      install_fam_rm INTEGER DEFAULT 0,
      installation_instructions TEXT,

      merchandise_total REAL DEFAULT 0,
      sales_tax REAL DEFAULT 0,
      total_sale REAL DEFAULT 0,
      deposit REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      payment_cash INTEGER DEFAULT 0,
      payment_check INTEGER DEFAULT 0,
      payment_charge INTEGER DEFAULT 0,
      payment_financing INTEGER DEFAULT 0,

      buyer_name TEXT,
      buyer_date TEXT,
      notes TEXT,

      raw_text TEXT,
      source_filename TEXT,
      source_path TEXT,
      ocr_status TEXT DEFAULT 'pending',
      ocr_confidence REAL DEFAULT 0,

      created_at TEXT,
      updated_at TEXT,

      email TEXT,
      tax_rate REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      total REAL DEFAULT 0
    );

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
  runMigrations(db);
  ensureIndexes(db);
  return db;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationSteps = [
    {
      id: "2026-01-source-path-and-dates-normalization",
      run() {
        db.exec(`
          UPDATE invoices
          SET
            source_path = CASE
              WHEN source_path IS NULL THEN ''
              WHEN source_path LIKE '/uploads/%' THEN source_path
              WHEN source_filename IS NOT NULL AND TRIM(source_filename) <> '' THEN '/uploads/' || source_filename
              ELSE ''
            END,
            order_date = CASE
              WHEN order_date IS NULL THEN ''
              WHEN order_date GLOB '____-__-__*' THEN SUBSTR(order_date, 1, 10)
              ELSE order_date
            END,
            installation_date = CASE
              WHEN installation_date IS NULL THEN ''
              WHEN installation_date GLOB '____-__-__*' THEN SUBSTR(installation_date, 1, 10)
              ELSE installation_date
            END,
            buyer_date = CASE
              WHEN buyer_date IS NULL THEN ''
              WHEN buyer_date GLOB '____-__-__*' THEN SUBSTR(buyer_date, 1, 10)
              ELSE buyer_date
            END
        `);
      }
    }
  ];

  const hasMigration = db.prepare(`SELECT id FROM schema_migrations WHERE id=?`);
  const insertMigration = db.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, datetime('now'))`);

  const tx = db.transaction(() => {
    for (const step of migrationSteps) {
      if (hasMigration.get(step.id)) continue;
      step.run();
      insertMigration.run(step.id);
    }
  });

  tx();
}

function migrateSchema(db) {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) || 0);
  const tableInfo = db.prepare(`PRAGMA table_info(invoices)`).all();
  const existing = new Set(tableInfo.map((c) => c.name));

  const tx = db.transaction(() => {
    for (const [name, type] of Object.entries(REQUIRED_INVOICE_COLUMNS)) {
      if (existing.has(name)) continue;
      db.exec(`ALTER TABLE invoices ADD COLUMN ${name} ${type}`);
    }

    // Backfill new canonical columns from legacy values when present.
    db.exec(`
      UPDATE invoices
      SET
        customer_email = COALESCE(NULLIF(customer_email, ''), email, ''),
        merchandise_total = COALESCE(merchandise_total, subtotal, 0),
        total_sale = COALESCE(total_sale, total, 0),
        balance = COALESCE(balance, total - deposit, 0),
        updated_at = COALESCE(updated_at, created_at, datetime('now')),
        created_at = COALESCE(created_at, updated_at, datetime('now'))
    `);

    // If legacy rows only have item lines, copy first line material fields to invoice.
    db.exec(`
      UPDATE invoices
      SET
        manufacturer = COALESCE(NULLIF(manufacturer, ''), (
          SELECT manufacturer FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), ''),
        size = COALESCE(NULLIF(size, ''), (
          SELECT size FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), ''),
        style = COALESCE(NULLIF(style, ''), (
          SELECT style FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), ''),
        color = COALESCE(NULLIF(color, ''), (
          SELECT color FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), ''),
        pad = COALESCE(NULLIF(pad, ''), (
          SELECT pad FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), ''),
        rug_pad = COALESCE(NULLIF(rug_pad, ''), (
          SELECT rug_pad FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), ''),
        unit_price = COALESCE(unit_price, (
          SELECT unit_price FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), 0),
        amount = COALESCE(amount, (
          SELECT amount FROM invoice_items ii WHERE ii.invoice_id = invoices.id ORDER BY line_no ASC, id ASC LIMIT 1
        ), 0)
    `);
  });

  tx();

  if (currentVersion < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

function ensureIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number_nonempty_unique
      ON invoices(invoice_number)
      WHERE invoice_number IS NOT NULL AND TRIM(invoice_number) <> '';
    CREATE INDEX IF NOT EXISTS idx_invoices_sold_to ON invoices(sold_to);
    CREATE INDEX IF NOT EXISTS idx_invoices_installation_date ON invoices(installation_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_updated_at ON invoices(updated_at);
    CREATE INDEX IF NOT EXISTS idx_invoices_home_phone ON invoices(home_phone);
    CREATE INDEX IF NOT EXISTS idx_invoices_cell_phone ON invoices(cell_phone);
  `);
}

export function getInvoiceForm(_db, _invoiceId) {
  // Legacy response shape for old clients; canonical data now lives on invoices row.
  return null;
}

export function upsertInvoiceForm() {
  // No-op. Form fields now persist directly on invoices.
}

export function computeTotals(payload) {
  const merchandise_total = round2(Number(payload.merchandise_total ?? payload.subtotal ?? payload.amount ?? 0));
  const sales_tax = round2(Number(payload.sales_tax ?? 0));
  const inferredTotal = round2(merchandise_total + sales_tax);
  const total_sale = round2(Number(payload.total_sale ?? payload.total ?? inferredTotal));
  const deposit = round2(Number(payload.deposit ?? 0));
  const balance = round2(Number(payload.balance ?? (total_sale - deposit)));

  return {
    merchandise_total,
    sales_tax,
    total_sale,
    deposit,
    balance,
    // Legacy mirrors
    subtotal: merchandise_total,
    total: total_sale
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
