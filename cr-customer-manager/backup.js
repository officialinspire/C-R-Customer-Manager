import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dest);
}

export async function runDailyBackup(dbPath, uploadsDir, backupDir) {
  void uploadsDir;
  const date = formatLocalDate(new Date());
  const dayDir = path.join(backupDir, date);
  fs.mkdirSync(dayDir, { recursive: true });

  const dbBaseName = path.basename(dbPath);
  const mainBackupPath = path.join(dayDir, dbBaseName);
  copyIfExists(dbPath, mainBackupPath);
  copyIfExists(`${dbPath}-wal`, path.join(dayDir, `${dbBaseName}-wal`));
  copyIfExists(`${dbPath}-shm`, path.join(dayDir, `${dbBaseName}-shm`));

  const db = new Database(dbPath, { readonly: true });
  const invoices = db.prepare("SELECT * FROM invoices ORDER BY id ASC").all();
  db.close();

  const jsonPath = path.join(dayDir, "invoices-export.json");
  fs.writeFileSync(jsonPath, JSON.stringify(invoices, null, 2));

  const cutoff = Date.now() - (30 * DAY_MS);
  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const parsed = new Date(`${entry.name}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) continue;
    if (parsed.getTime() >= cutoff) continue;
    fs.rmSync(path.join(backupDir, entry.name), { recursive: true, force: true });
  }

  return {
    date,
    dbPath: mainBackupPath,
    jsonPath,
    invoiceCount: invoices.length
  };
}

export function scheduleDaily(dbPath, uploadsDir, backupDir) {
  let timer = null;
  let cancelled = false;

  const scheduleNext = (delay) => {
    timer = setTimeout(async () => {
      try {
        await runDailyBackup(dbPath, uploadsDir, backupDir);
      } catch (error) {
        console.error("[Backup] Daily backup failed:", error.message);
      }

      if (!cancelled) {
        scheduleNext(DAY_MS);
      }
    }, delay);
  };

  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  scheduleNext(next.getTime() - now.getTime());

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
