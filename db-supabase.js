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
const DEFAULT_BUSINESS_HOURS = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { start: '00:00', end: '24:00' }])
);

function saveReport(businessDate, data) {
  const row = {
    business_date: businessDate,
    data,
    created_at: new Date().toISOString(),
  };
  return supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'business_date' })
    .then(({ error }) => {
      if (error) throw error;
    });
}

function getReport(businessDate) {
  return supabase
    .from(TABLE)
    .select('data')
    .eq('business_date', businessDate)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (!row || row.data == null) return null;
      return typeof row.data === 'object' ? row.data : JSON.parse(row.data);
    });
}

function getAvailableDates() {
  return supabase
    .from(TABLE)
    .select('business_date')
    .order('business_date', { ascending: false })
    .then(({ data: rows, error }) => {
      if (error) throw error;
      return (rows || []).map((r) => r.business_date);
    });
}

function getBusinessHours() {
  return supabase
    .from(MASTERS_TABLE)
    .select('value')
    .eq('key', BUSINESS_HOURS_KEY)
    .maybeSingle()
    .then(({ data: row, error }) => {
      if (error) throw error;
      if (!row || row.value == null) return DEFAULT_BUSINESS_HOURS;
      const v = typeof row.value === 'object' ? row.value : JSON.parse(row.value);
      return v && typeof v === 'object' ? v : DEFAULT_BUSINESS_HOURS;
    });
}

function saveBusinessHours(settings) {
  const value = settings || DEFAULT_BUSINESS_HOURS;
  return supabase
    .from(MASTERS_TABLE)
    .upsert({ key: BUSINESS_HOURS_KEY, value }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) throw error;
    });
}

module.exports = { saveReport, getReport, getAvailableDates, getBusinessHours, saveBusinessHours };
