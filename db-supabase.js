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

module.exports = { saveReport, getReport, getAvailableDates };
