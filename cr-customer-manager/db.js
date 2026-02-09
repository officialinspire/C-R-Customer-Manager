import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

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

  return db;
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
