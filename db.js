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
db.exec(`
  CREATE TABLE IF NOT EXISTS masters (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

const BUSINESS_HOURS_KEY = 'business_hours';
const DEFAULT_BUSINESS_HOURS = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { start: '00:00', end: '24:00' }])
);

function getBusinessHours() {
  const row = db.prepare('SELECT value FROM masters WHERE key = ?').get(BUSINESS_HOURS_KEY);
  if (!row || !row.value) return Promise.resolve(DEFAULT_BUSINESS_HOURS);
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object') return Promise.resolve(parsed);
  } catch (e) {}
  return Promise.resolve(DEFAULT_BUSINESS_HOURS);
}

function saveBusinessHours(settings) {
  const value = JSON.stringify(settings || DEFAULT_BUSINESS_HOURS);
  db.prepare('INSERT INTO masters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    BUSINESS_HOURS_KEY,
    value
  );
  return Promise.resolve();
}

module.exports = { saveReport, getReport, getAvailableDates, getBusinessHours, saveBusinessHours };
