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
const BUSINESS_HOURS_KEY = 'business_hours';
const STORES_KEY = 'stores';
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

function saveReport(businessDate, data, storeId = 'default') {
  const sid = normStoreId(storeId);
  const row = {
    store_id: sid,
    business_date: businessDate,
    data,
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
    .select('data')
    .eq('store_id', sid)
    .eq('business_date', businessDate)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (!row || row.data == null) return null;
      return typeof row.data === 'object' ? row.data : JSON.parse(row.data);
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
