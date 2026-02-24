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
    business_date TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function saveReport(businessDate, data) {
  const stmt = db.prepare(
    'INSERT INTO reports (business_date, data) VALUES (?, ?) ON CONFLICT(business_date) DO UPDATE SET data = excluded.data, created_at = datetime(\'now\')'
  );
  stmt.run(businessDate, JSON.stringify(data));
  return Promise.resolve();
}

function getReport(businessDate) {
  const row = db.prepare('SELECT data FROM reports WHERE business_date = ?').get(businessDate);
  if (!row) return Promise.resolve(null);
  try {
    return Promise.resolve(typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
  } catch (e) {
    return Promise.resolve(null);
  }
}

function getAvailableDates() {
  const rows = db.prepare('SELECT business_date FROM reports ORDER BY business_date DESC').all();
  return Promise.resolve(rows.map((r) => r.business_date));
}

module.exports = { saveReport, getReport, getAvailableDates };
