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
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now')),
    preferred_store TEXT,
    preferred_department TEXT,
    preferred_currency TEXT,
    preferred_language TEXT
  )
`);

(function addIsFinalColumnIfNeeded() {
  try {
    db.exec("ALTER TABLE reports ADD COLUMN is_final INTEGER DEFAULT 0");
  } catch (_) { /* already exists */ }
})();

(function addUserPreferencesColumnsIfNeeded() {
  try {
    const info = db.prepare('PRAGMA table_info(users)').all();
    const hasPreferredStore = info.some((c) => c.name === 'preferred_store');
    const hasDisplayName = info.some((c) => c.name === 'display_name');
    const hasPreferredCurrency = info.some((c) => c.name === 'preferred_currency');
    const hasPreferredLanguage = info.some((c) => c.name === 'preferred_language');
    if (!hasDisplayName) db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
    if (!hasPreferredStore) {
      db.exec('ALTER TABLE users ADD COLUMN preferred_store TEXT');
      db.exec('ALTER TABLE users ADD COLUMN preferred_department TEXT');
    }
    if (!hasPreferredCurrency) db.exec('ALTER TABLE users ADD COLUMN preferred_currency TEXT');
    if (!hasPreferredLanguage) db.exec('ALTER TABLE users ADD COLUMN preferred_language TEXT');
  } catch (e) {}
})();

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

db.exec(`
  CREATE TABLE IF NOT EXISTS product_groups (
    code TEXT PRIMARY KEY,
    description TEXT,
    description_tha TEXT,
    description_jpn TEXT
  )
`);

const STORES_KEY = 'stores';
const EXCHANGE_RATE_KEY = 'exchange_rate';
const PRODUCT_MASTER_KEY = 'product_master';
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

function getExchangeRate() {
  const row = db.prepare('SELECT value FROM masters WHERE key = ?').get(EXCHANGE_RATE_KEY);
  if (!row || !row.value) return Promise.resolve({ rate: null, updated_at: null });
  try {
    const parsed = JSON.parse(row.value);
    return Promise.resolve({
      rate: parsed && typeof parsed.rate === 'number' && !Number.isNaN(parsed.rate) && parsed.rate > 0 ? parsed.rate : null,
      updated_at: parsed && typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
    });
  } catch (e) {}
  return Promise.resolve({ rate: null, updated_at: null });
}

function saveExchangeRate(rate) {
  const now = new Date().toISOString();
  const value = JSON.stringify({ rate: Number(rate), updated_at: now });
  db.prepare('INSERT INTO masters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    EXCHANGE_RATE_KEY,
    value
  );
  return Promise.resolve({ rate: Number(rate), updated_at: now });
}

function getProductMaster() {
  const row = db.prepare('SELECT value FROM masters WHERE key = ?').get(PRODUCT_MASTER_KEY);
  if (!row || !row.value) return Promise.resolve({});
  try { return Promise.resolve(JSON.parse(row.value)); } catch (_) { return Promise.resolve({}); }
}

function getProductGroups() {
  const rows = db.prepare('SELECT code, description, description_tha, description_jpn FROM product_groups ORDER BY code').all();
  return Promise.resolve(rows);
}

function saveProductGroups(rows) {
  const stmt = db.prepare(
    'INSERT INTO product_groups (code, description, description_tha, description_jpn) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET description=excluded.description, description_tha=excluded.description_tha, description_jpn=excluded.description_jpn'
  );
  const insertMany = db.transaction((items) => { for (const r of items) stmt.run(r.code, r.description || '', r.description_tha || '', r.description_jpn || ''); });
  insertMany(rows);
  return Promise.resolve(rows.length);
}

function saveProductMaster(master) {
  db.prepare('INSERT INTO masters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    PRODUCT_MASTER_KEY, JSON.stringify(master)
  );
  return Promise.resolve(master);
}

function saveReport(businessDate, data, storeId = 'default', isFinal = false) {
  const sid = String(storeId || 'default').trim() || 'default';
  const stmt = db.prepare(
    'INSERT INTO reports (store_id, business_date, data, is_final) VALUES (?, ?, ?, ?) ON CONFLICT(store_id, business_date) DO UPDATE SET data = excluded.data, created_at = datetime(\'now\'), is_final = excluded.is_final'
  );
  stmt.run(sid, businessDate, JSON.stringify(data), isFinal ? 1 : 0);
  return Promise.resolve();
}

function getReport(businessDate, storeId = 'default') {
  const sid = String(storeId || 'default').trim() || 'default';
  const row = db.prepare('SELECT data, created_at, is_final FROM reports WHERE store_id = ? AND business_date = ?').get(sid, businessDate);
  if (!row) return Promise.resolve(null);
  try {
    const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    if (parsed && row.created_at) parsed._updatedAt = row.created_at;
    if (parsed) parsed._isFinal = !!row.is_final;
    return Promise.resolve(parsed);
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

// Users (id, username, password_hash, role, created_at)
function getUsers() {
  const rows = db.prepare('SELECT id, username, display_name, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language FROM users ORDER BY created_at ASC').all();
  return Promise.resolve(rows);
}

function getUserByUsername(username) {
  const row = db.prepare('SELECT id, username, display_name, password_hash, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language FROM users WHERE username = ?').get(
    String(username).trim()
  );
  return Promise.resolve(row || null);
}

function getUserById(id) {
  const row = db.prepare('SELECT id, username, display_name, password_hash, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language FROM users WHERE id = ?').get(id);
  return Promise.resolve(row || null);
}

function updateUserPreferences(id, { preferredStore, preferredDepartment, preferredCurrency, preferredLanguage }) {
  const row = db.prepare('SELECT id, preferred_store, preferred_department, preferred_currency, preferred_language FROM users WHERE id = ?').get(id);
  if (!row) return Promise.resolve(null);
  const storeVal = preferredStore !== undefined ? (preferredStore != null ? String(preferredStore).trim() : null) : row.preferred_store;
  const deptVal = preferredDepartment !== undefined ? (preferredDepartment != null ? String(preferredDepartment).trim() : null) : row.preferred_department;
  const currencyVal = preferredCurrency !== undefined ? (preferredCurrency != null ? String(preferredCurrency).trim() : null) : row.preferred_currency;
  const languageVal = preferredLanguage !== undefined ? (preferredLanguage != null ? String(preferredLanguage).trim() : null) : row.preferred_language;
  db.prepare('UPDATE users SET preferred_store = ?, preferred_department = ?, preferred_currency = ?, preferred_language = ? WHERE id = ?').run(
    storeVal,
    deptVal,
    currencyVal,
    languageVal,
    id
  );
  return getUserById(id);
}

function createUser({ username, displayName, passwordHash, role }) {
  const id = require('crypto').randomUUID();
  const un = String(username).trim();
  const dn = displayName != null ? String(displayName).trim() : null;
  const r = role === 'admin' ? 'admin' : 'user';
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).run(id, un, dn || null, passwordHash, r);
  return Promise.resolve({ id, username: un, display_name: dn || null, role: r });
}

function updateUser(id, { username, displayName, passwordHash, role }) {
  const row = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!row) return Promise.resolve(null);
  const updates = [];
  const params = [];
  if (username !== undefined) {
    updates.push('username = ?');
    params.push(String(username).trim());
  }
  if (passwordHash !== undefined && passwordHash !== '') {
    updates.push('password_hash = ?');
    params.push(passwordHash);
  }
  if (displayName !== undefined) {
    updates.push('display_name = ?');
    params.push(displayName != null ? String(displayName).trim() : null);
  }
  if (role !== undefined) {
    updates.push('role = ?');
    params.push(role === 'admin' ? 'admin' : 'user');
  }
  if (updates.length === 0) return getUserById(id);
  params.push(id);
  db.prepare('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?').run(...params);
  return getUserById(id);
}

function deleteUser(id) {
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return Promise.resolve(r.changes > 0);
}

function countUsers() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  return Promise.resolve(row ? row.n : 0);
}

function countAdmins() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get();
  return Promise.resolve(row ? row.n : 0);
}

module.exports = {
  getStores,
  saveStores,
  getExchangeRate,
  saveExchangeRate,
  getProductMaster,
  saveProductMaster,
  getProductGroups,
  saveProductGroups,
  updateUserPreferences,
  saveReport,
  getReport,
  getAvailableDates,
  getUploadLog,
  getBusinessHours,
  saveBusinessHours,
  getUsers,
  getUserByUsername,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  countUsers,
  countAdmins,
};
