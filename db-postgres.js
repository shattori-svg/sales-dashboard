'use strict';

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('PostgreSQL requires DATABASE_URL environment variable.');
}

function toBool(v, fallback) {
  if (v == null || String(v).trim() === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return fallback;
}

function getSslConfig() {
  const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
  if (!sslMode || sslMode === 'disable') return false;
  if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
    const rejectUnauthorized = toBool(process.env.PG_SSL_REJECT_UNAUTHORIZED, false);
    return { rejectUnauthorized };
  }
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString,
  ssl: getSslConfig(),
  max: Math.max(1, parseInt(process.env.PG_POOL_MAX || '10', 10) || 10),
  idleTimeoutMillis: Math.max(1000, parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10) || 30000),
});

const TABLE = 'reports';
const MASTERS_TABLE = 'masters';
const USERS_TABLE = 'users';
const BUSINESS_HOURS_KEY = 'business_hours';
const STORES_KEY = 'stores';
const EXCHANGE_RATE_KEY = 'exchange_rate';
const PRODUCT_MASTER_KEY = 'product_master';
const DEFAULT_STORES = [{ id: 'default', name: 'Default' }];
const DEFAULT_BUSINESS_HOURS = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { start: '00:00', end: '24:00' }])
);

function normStoreId(storeId) {
  return storeId == null || String(storeId).trim() === '' ? 'default' : String(storeId).trim();
}

function mapDbErr(err) {
  if (!err || typeof err !== 'object') return err;
  if (err.code === '23505' && !String(err.message || '').toLowerCase().includes('unique')) {
    err.message = 'unique constraint violation: ' + (err.detail || err.message || '');
  }
  return err;
}

async function getStores() {
  try {
    const r = await pool.query(`SELECT value FROM ${MASTERS_TABLE} WHERE key = $1`, [STORES_KEY]);
    if (!r.rows[0] || r.rows[0].value == null) return DEFAULT_STORES;
    const v = r.rows[0].value;
    return Array.isArray(v) && v.length > 0 ? v : DEFAULT_STORES;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function saveStores(stores) {
  if (!Array.isArray(stores) || stores.length === 0) stores = DEFAULT_STORES;
  try {
    await pool.query(
      `INSERT INTO ${MASTERS_TABLE} (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [STORES_KEY, JSON.stringify(stores)]
    );
    return stores;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getExchangeRate() {
  try {
    const r = await pool.query(`SELECT value FROM ${MASTERS_TABLE} WHERE key = $1`, [EXCHANGE_RATE_KEY]);
    if (!r.rows[0] || r.rows[0].value == null) return { rate: null, updated_at: null };
    const v = r.rows[0].value || {};
    const rate = v && typeof v.rate === 'number' && !Number.isNaN(v.rate) && v.rate > 0 ? v.rate : null;
    const updated_at = v && typeof v.updated_at === 'string' ? v.updated_at : null;
    return { rate, updated_at };
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function saveExchangeRate(rate) {
  const now = new Date().toISOString();
  const value = { rate: Number(rate), updated_at: now };
  try {
    await pool.query(
      `INSERT INTO ${MASTERS_TABLE} (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [EXCHANGE_RATE_KEY, JSON.stringify(value)]
    );
    return { rate: Number(rate), updated_at: now };
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function saveReport(businessDate, data, storeId = 'default', isFinal = false) {
  const sid = normStoreId(storeId);
  try {
    await pool.query(
      `INSERT INTO ${TABLE} (store_id, business_date, data, created_at, is_final)
       VALUES ($1, $2, $3::jsonb, NOW(), $4)
       ON CONFLICT (store_id, business_date)
       DO UPDATE SET data = EXCLUDED.data, created_at = NOW(), is_final = EXCLUDED.is_final`,
      [sid, businessDate, JSON.stringify(data), isFinal]
    );
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getReport(businessDate, storeId = 'default') {
  const sid = normStoreId(storeId);
  try {
    const r = await pool.query(
      `SELECT data, created_at, is_final FROM ${TABLE} WHERE store_id = $1 AND business_date = $2 LIMIT 1`,
      [sid, businessDate]
    );
    if (!r.rows[0]) return null;
    const parsed = r.rows[0].data;
    if (parsed && r.rows[0].created_at) parsed._updatedAt = r.rows[0].created_at;
    if (parsed) parsed._isFinal = !!r.rows[0].is_final;
    return parsed;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getAvailableDates(storeId = 'default') {
  const sid = normStoreId(storeId);
  try {
    const r = await pool.query(
      `SELECT business_date FROM ${TABLE}
       WHERE store_id = $1
       ORDER BY business_date DESC`,
      [sid]
    );
    return r.rows.map((row) => row.business_date);
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getUploadLog(limit = 200) {
  const cap = Math.min(Number(limit) || 200, 500);
  try {
    const r = await pool.query(
      `SELECT store_id, business_date, created_at
       FROM ${TABLE}
       ORDER BY created_at DESC
       LIMIT $1`,
      [cap]
    );
    return r.rows.map((row) => ({
      storeId: row.store_id,
      businessDate: row.business_date,
      receivedAt: row.created_at,
    }));
  } catch (err) {
    throw mapDbErr(err);
  }
}

function businessHoursKey(storeId) {
  const sid = normStoreId(storeId);
  return sid === 'default' ? BUSINESS_HOURS_KEY : 'bh:' + sid;
}

async function getProductMaster() {
  try {
    const r = await pool.query(`SELECT value FROM ${MASTERS_TABLE} WHERE key = $1`, [PRODUCT_MASTER_KEY]);
    if (!r.rows[0] || r.rows[0].value == null) return {};
    const v = r.rows[0].value;
    return v && typeof v === 'object' ? v : {};
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function saveProductMaster(master) {
  try {
    await pool.query(
      `INSERT INTO ${MASTERS_TABLE} (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [PRODUCT_MASTER_KEY, JSON.stringify(master)]
    );
    return master;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getBusinessHours(storeId) {
  const key = businessHoursKey(storeId);
  try {
    const r = await pool.query(`SELECT value FROM ${MASTERS_TABLE} WHERE key = $1 LIMIT 1`, [key]);
    if (r.rows[0] && r.rows[0].value != null && typeof r.rows[0].value === 'object') {
      return r.rows[0].value;
    }
    if (key !== BUSINESS_HOURS_KEY) {
      const fallback = await pool.query(`SELECT value FROM ${MASTERS_TABLE} WHERE key = $1 LIMIT 1`, [BUSINESS_HOURS_KEY]);
      if (fallback.rows[0] && fallback.rows[0].value != null && typeof fallback.rows[0].value === 'object') {
        return fallback.rows[0].value;
      }
    }
    return DEFAULT_BUSINESS_HOURS;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function saveBusinessHours(settings, storeId = 'default') {
  const key = businessHoursKey(storeId);
  const value = settings || DEFAULT_BUSINESS_HOURS;
  try {
    await pool.query(
      `INSERT INTO ${MASTERS_TABLE} (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getUsers() {
  try {
    const r = await pool.query(
      `SELECT id, username, display_name, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language
       FROM ${USERS_TABLE}
       ORDER BY created_at ASC`
    );
    return r.rows;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getUserByUsername(username) {
  const un = String(username).trim();
  try {
    const r = await pool.query(
      `SELECT id, username, display_name, password_hash, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language
       FROM ${USERS_TABLE}
       WHERE username = $1
       LIMIT 1`,
      [un]
    );
    return r.rows[0] || null;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getUserById(id) {
  try {
    const r = await pool.query(
      `SELECT id, username, display_name, password_hash, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language
       FROM ${USERS_TABLE}
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function updateUserPreferences(id, { preferredStore, preferredDepartment, preferredCurrency, preferredLanguage }) {
  const updates = [];
  const params = [];
  if (preferredStore !== undefined) {
    updates.push(`preferred_store = $${updates.length + 1}`);
    params.push(preferredStore != null ? String(preferredStore).trim() : null);
  }
  if (preferredDepartment !== undefined) {
    updates.push(`preferred_department = $${updates.length + 1}`);
    params.push(preferredDepartment != null ? String(preferredDepartment).trim() : null);
  }
  if (preferredCurrency !== undefined) {
    updates.push(`preferred_currency = $${updates.length + 1}`);
    params.push(preferredCurrency != null ? String(preferredCurrency).trim() : null);
  }
  if (preferredLanguage !== undefined) {
    updates.push(`preferred_language = $${updates.length + 1}`);
    params.push(preferredLanguage != null ? String(preferredLanguage).trim() : null);
  }
  if (updates.length === 0) return getUserById(id);
  params.push(id);
  try {
    const r = await pool.query(
      `UPDATE ${USERS_TABLE}
       SET ${updates.join(', ')}
       WHERE id = $${updates.length + 1}
       RETURNING id, username, role, preferred_store, preferred_department, preferred_currency, preferred_language`,
      params
    );
    return r.rows[0] || null;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function createUser({ username, displayName, passwordHash, role }) {
  const id = require('crypto').randomUUID();
  const un = String(username).trim();
  const dn = displayName != null ? String(displayName).trim() : null;
  const r = role === 'admin' ? 'admin' : 'user';
  try {
    const result = await pool.query(
      `INSERT INTO ${USERS_TABLE} (id, username, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, display_name, role`,
      [id, un, dn || null, passwordHash, r]
    );
    return result.rows[0];
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function updateUser(id, { username, displayName, passwordHash, role }) {
  const updates = [];
  const params = [];
  if (username !== undefined) {
    updates.push(`username = $${updates.length + 1}`);
    params.push(String(username).trim());
  }
  if (displayName !== undefined) {
    updates.push(`display_name = $${updates.length + 1}`);
    params.push(displayName != null ? String(displayName).trim() : null);
  }
  if (passwordHash !== undefined && passwordHash !== '') {
    updates.push(`password_hash = $${updates.length + 1}`);
    params.push(passwordHash);
  }
  if (role !== undefined) {
    updates.push(`role = $${updates.length + 1}`);
    params.push(role === 'admin' ? 'admin' : 'user');
  }
  if (updates.length === 0) return getUserById(id);
  params.push(id);
  try {
    const result = await pool.query(
      `UPDATE ${USERS_TABLE}
       SET ${updates.join(', ')}
       WHERE id = $${updates.length + 1}
       RETURNING id, username, display_name, password_hash, role, created_at`,
      params
    );
    return result.rows[0] || null;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function deleteUser(id) {
  try {
    const result = await pool.query(`DELETE FROM ${USERS_TABLE} WHERE id = $1`, [id]);
    return result.rowCount > 0;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function countUsers() {
  try {
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM ${USERS_TABLE}`);
    return result.rows[0] ? result.rows[0].n : 0;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function countAdmins() {
  try {
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM ${USERS_TABLE} WHERE role = 'admin'`);
    return result.rows[0] ? result.rows[0].n : 0;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function getProductGroups() {
  try {
    const result = await pool.query('SELECT code, description, description_tha, description_jpn FROM product_groups ORDER BY code');
    return result.rows;
  } catch (err) {
    throw mapDbErr(err);
  }
}

async function saveProductGroups(rows) {
  if (!rows || rows.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        'INSERT INTO product_groups (code, description, description_tha, description_jpn) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description, description_tha=EXCLUDED.description_tha, description_jpn=EXCLUDED.description_jpn',
        [r.code, r.description || '', r.description_tha || '', r.description_jpn || '']
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw mapDbErr(err);
  } finally {
    client.release();
  }
}

module.exports = {
  getStores,
  saveStores,
  getExchangeRate,
  saveExchangeRate,
  getProductMaster,
  saveProductMaster,
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
  updateUserPreferences,
  deleteUser,
  countUsers,
  countAdmins,
  getProductGroups,
  saveProductGroups,
};
