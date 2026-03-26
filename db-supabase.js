'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
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

function getStores() {
  return supabase
    .from(MASTERS_TABLE)
    .select('value')
    .eq('key', STORES_KEY)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (!row || row.value == null) return DEFAULT_STORES;
      const v = typeof row.value === 'object' ? row.value : JSON.parse(row.value);
      return Array.isArray(v) && v.length > 0 ? v : DEFAULT_STORES;
    });
}

function saveStores(stores) {
  if (!Array.isArray(stores) || stores.length === 0) stores = DEFAULT_STORES;
  return supabase
    .from(MASTERS_TABLE)
    .upsert({ key: STORES_KEY, value: stores }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) throw error;
      return stores;
    });
}

function getExchangeRate() {
  return supabase
    .from(MASTERS_TABLE)
    .select('value')
    .eq('key', EXCHANGE_RATE_KEY)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (!row || row.value == null) return { rate: null, updated_at: null };
      const v = typeof row.value === 'object' ? row.value : JSON.parse(row.value);
      const rate = v && typeof v.rate === 'number' && !Number.isNaN(v.rate) && v.rate > 0 ? v.rate : null;
      const updated_at = v && typeof v.updated_at === 'string' ? v.updated_at : null;
      return { rate, updated_at };
    });
}

function saveExchangeRate(rate) {
  const now = new Date().toISOString();
  const value = { rate: Number(rate), updated_at: now };
  return supabase
    .from(MASTERS_TABLE)
    .upsert({ key: EXCHANGE_RATE_KEY, value }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) throw error;
      return { rate: Number(rate), updated_at: now };
    });
}

function saveReport(businessDate, data, storeId = 'default', isFinal = false) {
  const sid = normStoreId(storeId);
  const row = {
    store_id: sid,
    business_date: businessDate,
    data,
    is_final: isFinal,
    created_at: new Date().toISOString(),
  };
  return supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'store_id,business_date' })
    .then(({ error }) => {
      if (error) throw error;
    });
}

function getReport(businessDate, storeId = 'default') {
  const sid = normStoreId(storeId);
  return supabase
    .from(TABLE)
    .select('data, created_at, is_final')
    .eq('store_id', sid)
    .eq('business_date', businessDate)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (!row || row.data == null) return null;
      const parsed = typeof row.data === 'object' ? row.data : JSON.parse(row.data);
      if (parsed && row.created_at) parsed._updatedAt = row.created_at;
      if (parsed) parsed._isFinal = !!row.is_final;
      return parsed;
    });
}

function getAvailableDates(storeId = 'default') {
  const sid = normStoreId(storeId);
  return supabase
    .from(TABLE)
    .select('business_date')
    .eq('store_id', sid)
    .order('business_date', { ascending: false })
    .then(({ data: rows, error }) => {
      if (error) throw error;
      return (rows || []).map((r) => r.business_date);
    });
}

function getUploadLog(limit = 200) {
  const cap = Math.min(Number(limit) || 200, 500);
  return supabase
    .from(TABLE)
    .select('store_id, business_date, created_at')
    .order('created_at', { ascending: false })
    .limit(cap)
    .then(({ data: rows, error }) => {
      if (error) throw error;
      return (rows || []).map((r) => ({
        storeId: r.store_id,
        businessDate: r.business_date,
        receivedAt: r.created_at,
      }));
    });
}

function businessHoursKey(storeId) {
  const sid = normStoreId(storeId);
  return sid === 'default' ? BUSINESS_HOURS_KEY : 'bh:' + sid;
}

function getProductMaster() {
  return supabase
    .from(MASTERS_TABLE)
    .select('value')
    .eq('key', PRODUCT_MASTER_KEY)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (!row || row.value == null) return {};
      const v = typeof row.value === 'object' ? row.value : JSON.parse(row.value);
      return v && typeof v === 'object' ? v : {};
    });
}

function saveProductMaster(master) {
  return supabase
    .from(MASTERS_TABLE)
    .upsert({ key: PRODUCT_MASTER_KEY, value: master }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) throw error;
      return master;
    });
}

function getBusinessHours(storeId) {
  const key = businessHoursKey(storeId);
  return supabase
    .from(MASTERS_TABLE)
    .select('value')
    .eq('key', key)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (row && row.value != null) {
        const v = typeof row.value === 'object' ? row.value : JSON.parse(row.value);
        if (v && typeof v === 'object') return Promise.resolve(v);
      }
      if (key !== BUSINESS_HOURS_KEY) {
        return supabase
          .from(MASTERS_TABLE)
          .select('value')
          .eq('key', BUSINESS_HOURS_KEY)
          .maybeSingle()
          .then(({ data: row2, error: err2 }) => {
            if (err2 || !row2 || row2.value == null) return DEFAULT_BUSINESS_HOURS;
            const v = typeof row2.value === 'object' ? row2.value : JSON.parse(row2.value);
            return v && typeof v === 'object' ? v : DEFAULT_BUSINESS_HOURS;
          });
      }
      return Promise.resolve(DEFAULT_BUSINESS_HOURS);
    });
}

function saveBusinessHours(settings, storeId = 'default') {
  const key = businessHoursKey(storeId);
  const value = settings || DEFAULT_BUSINESS_HOURS;
  return supabase
    .from(MASTERS_TABLE)
    .upsert({ key, value }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) throw error;
    });
}

function getUsers() {
  return supabase
    .from(USERS_TABLE)
    .select('id, username, display_name, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language')
    .order('created_at', { ascending: true })
    .then(({ data: rows, error }) => {
      if (error) throw error;
      return rows || [];
    });
}

function getUserByUsername(username) {
  const un = String(username).trim();
  return supabase
    .from(USERS_TABLE)
    .select('id, username, display_name, password_hash, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language')
    .eq('username', un)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      return row || null;
    });
}

function getUserById(id) {
  return supabase
    .from(USERS_TABLE)
    .select('id, username, display_name, password_hash, role, created_at, preferred_store, preferred_department, preferred_currency, preferred_language')
    .eq('id', id)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      return row || null;
    });
}

function updateUserPreferences(id, { preferredStore, preferredDepartment, preferredCurrency, preferredLanguage }) {
  const body = {};
  if (preferredStore !== undefined) body.preferred_store = preferredStore != null ? String(preferredStore).trim() : null;
  if (preferredDepartment !== undefined) body.preferred_department = preferredDepartment != null ? String(preferredDepartment).trim() : null;
  if (preferredCurrency !== undefined) body.preferred_currency = preferredCurrency != null ? String(preferredCurrency).trim() : null;
  if (preferredLanguage !== undefined) body.preferred_language = preferredLanguage != null ? String(preferredLanguage).trim() : null;
  if (Object.keys(body).length === 0) return getUserById(id);
  return supabase
    .from(USERS_TABLE)
    .update(body)
    .eq('id', id)
    .select()
    .single()
    .then(({ data: row, error }) => {
      if (error) throw error;
      return row
        ? {
            id: row.id,
            username: row.username,
            role: row.role,
            preferred_store: row.preferred_store,
            preferred_department: row.preferred_department,
            preferred_currency: row.preferred_currency,
            preferred_language: row.preferred_language
          }
        : null;
    });
}

function createUser({ username, displayName, passwordHash, role }) {
  const id = require('crypto').randomUUID();
  const un = String(username).trim();
  const dn = displayName != null ? String(displayName).trim() : null;
  const r = role === 'admin' ? 'admin' : 'user';
  return supabase
    .from(USERS_TABLE)
    .insert({ id, username: un, display_name: dn || null, password_hash: passwordHash, role: r })
    .select('id, username, display_name, role')
    .single()
    .then(({ data: row, error }) => {
      if (error) throw error;
      return row;
    });
}

function updateUser(id, { username, displayName, passwordHash, role }) {
  const body = {};
  if (username !== undefined) body.username = String(username).trim();
  if (displayName !== undefined) body.display_name = displayName != null ? String(displayName).trim() : null;
  if (passwordHash !== undefined && passwordHash !== '') body.password_hash = passwordHash;
  if (role !== undefined) body.role = role === 'admin' ? 'admin' : 'user';
  if (Object.keys(body).length === 0) return getUserById(id);
  return supabase
    .from(USERS_TABLE)
    .update(body)
    .eq('id', id)
    .select()
    .single()
    .then(({ data: row, error }) => {
      if (error) throw error;
      return row ? { id: row.id, username: row.username, display_name: row.display_name, password_hash: row.password_hash, role: row.role, created_at: row.created_at } : null;
    });
}

function deleteUser(id) {
  return supabase
    .from(USERS_TABLE)
    .delete()
    .eq('id', id)
    .then(({ error }) => {
      if (error) throw error;
      return true;
    });
}

function countUsers() {
  return supabase
    .from(USERS_TABLE)
    .select('*', { count: 'exact', head: true })
    .then(({ count, error }) => {
      if (error) throw error;
      return count || 0;
    });
}

function countAdmins() {
  return supabase
    .from(USERS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('role', 'admin')
    .then(({ count, error }) => {
      if (error) throw error;
      return count || 0;
    });
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
};
