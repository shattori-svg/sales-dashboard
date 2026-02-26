'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'sales.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    store_id TEXT NOT NULL DEFAULT 'default',
    business_date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, business_date)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS masters (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// Migrate old schema (business_date PK only) to (store_id, business_date)
(function migrateReportsIfNeeded() {
  try {
    const info = db.prepare('PRAGMA table_info(reports)').all();
    const hasStoreId = info.some((c) => c.name === 'store_id');
    if (hasStoreId) return;
    const old = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reports'").get();
    if (!old) return;
    db.exec(`
      CREATE TABLE reports_new (
        store_id TEXT NOT NULL DEFAULT 'default',
        business_date TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (store_id, business_date)
      );
      INSERT INTO reports_new (store_id, business_date, data, created_at)
      SELECT 'default', business_date, data, created_at FROM reports;
      DROP TABLE reports;
      ALTER TABLE reports_new RENAME TO reports;
    `);
  } catch (e) {
    console.error('Migration reports:', e);
  }
})();

const STORES_KEY = 'stores';
const DEFAULT_STORES = [{ id: 'default', name: 'Default' }];

function getStores() {
  const row = db.prepare('SELECT value FROM masters WHERE key = ?').get(STORES_KEY);
  if (!row || !row.value) return Promise.resolve(DEFAULT_STORES);
  try {
    const parsed = JSON.parse(row.value);
    if (Array.isArray(parsed) && parsed.length > 0) return Promise.resolve(parsed);
  } catch (e) {}
  return Promise.resolve(DEFAULT_STORES);
}

function saveStores(stores) {
  if (!Array.isArray(stores) || stores.length === 0) stores = DEFAULT_STORES;
  const value = JSON.stringify(stores);
  db.prepare('INSERT INTO masters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    STORES_KEY,
    value
  );
  return Promise.resolve(stores);
}

function saveReport(businessDate, data, storeId = 'default') {
  const sid = String(storeId || 'default').trim() || 'default';
  const stmt = db.prepare(
    'INSERT INTO reports (store_id, business_date, data) VALUES (?, ?, ?) ON CONFLICT(store_id, business_date) DO UPDATE SET data = excluded.data, created_at = datetime(\'now\')'
  );
  stmt.run(sid, businessDate, JSON.stringify(data));
  return Promise.resolve();
}

function getReport(businessDate, storeId = 'default') {
  const sid = String(storeId || 'default').trim() || 'default';
  const row = db.prepare('SELECT data FROM reports WHERE store_id = ? AND business_date = ?').get(sid, businessDate);
  if (!row) return Promise.resolve(null);
  try {
    return Promise.resolve(typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
  } catch (e) {
    return Promise.resolve(null);
  }
}

function getAvailableDates(storeId = 'default') {
  const sid = String(storeId || 'default').trim() || 'default';
  const rows = db.prepare('SELECT business_date FROM reports WHERE store_id = ? ORDER BY business_date DESC').all(sid);
  return Promise.resolve(rows.map((r) => r.business_date));
}

function getUploadLog(limit = 200) {
  const rows = db.prepare(
    'SELECT store_id AS storeId, business_date AS businessDate, created_at AS receivedAt FROM reports ORDER BY created_at DESC LIMIT ?'
  ).all(Math.min(Number(limit) || 200, 500));
  return Promise.resolve(rows);
}

const BUSINESS_HOURS_KEY = 'business_hours';

function businessHoursKey(storeId) {
  const sid = String(storeId || 'default').trim() || 'default';
  return sid === 'default' ? BUSINESS_HOURS_KEY : 'bh:' + sid;
}

const DEFAULT_BUSINESS_HOURS = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { start: '00:00', end: '24:00' }])
);

function getBusinessHours(storeId) {
  const key = businessHoursKey(storeId);
  let row = db.prepare('SELECT value FROM masters WHERE key = ?').get(key);
  if ((!row || !row.value) && key !== BUSINESS_HOURS_KEY) {
    row = db.prepare('SELECT value FROM masters WHERE key = ?').get(BUSINESS_HOURS_KEY);
  }
  if (!row || !row.value) return Promise.resolve(DEFAULT_BUSINESS_HOURS);
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object') return Promise.resolve(parsed);
  } catch (e) {}
  return Promise.resolve(DEFAULT_BUSINESS_HOURS);
}

function saveBusinessHours(settings, storeId = 'default') {
  const key = businessHoursKey(storeId);
  const value = JSON.stringify(settings || DEFAULT_BUSINESS_HOURS);
  db.prepare('INSERT INTO masters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  );
  return Promise.resolve();
}

module.exports = {
  getStores,
  saveStores,
  saveReport,
  getReport,
  getAvailableDates,
  getUploadLog,
  getBusinessHours,
  saveBusinessHours,
};
