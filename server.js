'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { parseSheet, parseCsv } = require('./parser');
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db = useSupabase ? require('./db-supabase') : require('./db');
const { getStores, saveStores, saveReport, getReport, getAvailableDates, getUploadLog, getBusinessHours, saveBusinessHours } = db;
const aiGemini = require('./ai-gemini');

const app = express();
const PORT = process.env.PORT || 3333;

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD ? String(process.env.LOGIN_PASSWORD).trim() : '';
const LOGIN_USER = process.env.LOGIN_USER ? String(process.env.LOGIN_USER).trim() : '';
const AUTH_ENABLED = LOGIN_PASSWORD.length > 0;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (AUTH_ENABLED) {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || LOGIN_PASSWORD,
      resave: false,
      saveUninitialized: false,
      name: 'sales_report_sid',
      cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
    })
  );
}

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (req.session && req.session.loggedIn) return next();
  const isApi = req.path.startsWith('/api/');
  if (isApi) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

if (AUTH_ENABLED) {
  app.get('/login', (req, res) => {
    if (req.session && req.session.loggedIn) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'login.html'), (err) => {
      if (err) res.status(500).send('Login page not found');
    });
  });

  app.post('/login', (req, res) => {
    const password = (req.body.password || '').trim();
    const user = (req.body.username || '').trim();
    const ok =
      password === LOGIN_PASSWORD && (LOGIN_USER === '' || user === LOGIN_USER);
    if (ok) {
      req.session.loggedIn = true;
      return res.redirect('/');
    }
    res.redirect('/login?error=1');
  });

  app.post('/logout', (req, res) => {
    req.session.destroy(() => {});
    res.redirect('/login');
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => {});
    res.redirect('/login');
  });
} else {
  app.get('/login', (req, res) => res.redirect('/'));
  app.get('/logout', (req, res) => res.redirect('/'));
  app.post('/logout', (req, res) => res.redirect('/'));
}

app.use(requireAuth);
app.get('/api/auth/status', (req, res) => {
  res.json({
    authEnabled: AUTH_ENABLED,
    loggedIn: !!(AUTH_ENABLED && req.session && req.session.loggedIn),
  });
});
app.use(express.static(path.join(__dirname)));

app.get('/setup', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'), (err) => {
    if (err) res.status(500).send('Setup page not found');
  });
});
app.get('/upload', (req, res) => res.redirect('/setup'));

app.get('/api/stores', async (req, res) => {
  try {
    const stores = await getStores();
    res.json({ stores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get stores.' });
  }
});

app.put('/api/stores', async (req, res) => {
  try {
    const stores = req.body && req.body.stores;
    if (!Array.isArray(stores)) {
      return res.status(400).json({ error: 'Body must be { stores: [ { id, name }, ... ] }.' });
    }
    const normalized = stores.map((s) => ({
      id: String(s && s.id != null ? s.id : '').trim() || 'default',
      name: String(s && s.name != null ? s.name : '').trim() || 'Store',
    }));
    if (normalized.length === 0) normalized.push({ id: 'default', name: 'Default' });
    await saveStores(normalized);
    res.json({ stores: normalized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to save stores.' });
  }
});

app.get('/api/business-hours', async (req, res) => {
  try {
    const storeId = (req.query.storeId || 'default').trim() || 'default';
    const settings = await getBusinessHours(storeId);
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get business hours.' });
  }
});

app.put('/api/business-hours', async (req, res) => {
  try {
    const storeId = (req.query.storeId || req.body.storeId || 'default').trim() || 'default';
    const settings = req.body && req.body.settings ? req.body.settings : req.body;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'Body must be an object (e.g. { "0": { "start": "09:00", "end": "21:00" }, ... }).' });
    }
    const normalized = {};
    for (let d = 0; d <= 6; d++) {
      const day = settings[String(d)] || settings[d];
      normalized[d] = {
        start: (day && day.start) ? String(day.start).trim() : '00:00',
        end: (day && day.end) ? String(day.end).trim() : '24:00',
      };
    }
    await saveBusinessHours(normalized, storeId);
    res.json(normalized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to save business hours.' });
  }
});

app.get('/api/dates', async (req, res) => {
  try {
    const storeId = (req.query.storeId || 'default').trim() || 'default';
    const dates = await getAvailableDates(storeId);
    res.json({ dates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get dates.' });
  }
});

app.get('/api/upload-log', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const logs = await getUploadLog(limit);
    res.json({ logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get upload log.' });
  }
});

function buildDailySummaryForReport(dateStr, report) {
  if (!report || !report.total || !report.total.hourly) return null;
  const hourly = report.total.hourly;
  let totalNetSales = 0;
  let receiptCount = 0;
  let quantitySold = 0;
  hourly.forEach((h) => {
    totalNetSales += h.netSales || 0;
    receiptCount += h.receiptCount || 0;
    quantitySold += h.quantitySold || 0;
  });
  const byDepartment = {};
  const DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];
  DEPARTMENTS.forEach((d) => {
    byDepartment[d] = 0;
    if (report.byDepartment && report.byDepartment[d] && report.byDepartment[d].hourly) {
      report.byDepartment[d].hourly.forEach((h) => {
        byDepartment[d] += h.netSales || 0;
      });
    }
  });
  return {
    date: dateStr,
    totalNetSales,
    receiptCount,
    quantitySold,
    hoursCount: hourly.length || 1,
    byDepartment,
  };
}

function parseDateYMD(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(String(str).trim())) return null;
  const d = new Date(String(str).trim() + 'T12:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

app.get('/api/daily-summary', async (req, res) => {
  try {
    const storeId = (req.query.storeId || 'default').trim() || 'default';
    const refStr = req.query.referenceDate;
    const startStr = req.query.startDate ? String(req.query.startDate).trim() : null;
    let daysList = [];
    if (startStr && refStr && /^\d{4}-\d{2}-\d{2}$/.test(startStr) && /^\d{4}-\d{2}-\d{2}$/.test(String(refStr).trim())) {
      const startD = parseDateYMD(startStr);
      const endD = parseDateYMD(refStr);
      if (startD && endD && startD <= endD) {
        const maxDays = 31;
        for (let d = new Date(startD); d <= endD && daysList.length < maxDays; d.setUTCDate(d.getUTCDate() + 1)) {
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          daysList.push(y + '-' + m + '-' + day);
        }
      }
    }
    if (daysList.length === 0) {
      const days = Math.min(31, Math.max(1, parseInt(req.query.days, 10) || 7));
      if (!refStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(refStr).trim())) {
        return res.status(400).json({ error: 'Query parameter referenceDate (YYYY-MM-DD) is required.' });
      }
      const endDate = String(refStr).trim();
      for (let i = days - 1; i >= 0; i--) {
        daysList.push(addDays(endDate, -i));
      }
    }
    const summaries = [];
    for (const d of daysList) {
      const report = await getReport(d, storeId);
      const sum = report ? buildDailySummaryForReport(d, report) : null;
      if (sum) summaries.push(sum);
    }
    res.json({ days: summaries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get daily summary.' });
  }
});

app.get('/api/report', async (req, res) => {
  try {
    const storeId = (req.query.storeId || 'default').trim() || 'default';
    const refDateStr = req.query.referenceDate;
    if (!refDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDateStr).trim())) {
      return res.status(400).json({ error: 'Query parameter referenceDate (YYYY-MM-DD) is required.' });
    }
    const date = String(refDateStr).trim();
    const yesterdayStr = addDays(date, -1);
    const lastWeekStr = addDays(date, -7);
    const today = await getReport(date, storeId);
    if (!today) {
      return res.status(404).json({ error: 'No report found for date ' + date + '.' });
    }
    const yesterday = await getReport(yesterdayStr, storeId);
    const lastWeek = await getReport(lastWeekStr, storeId);
    res.json({ today, yesterday: yesterday || null, lastWeek: lastWeek || null, referenceDate: date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get report.' });
  }
});

app.get('/api/ai/status', (req, res) => {
  res.json({ available: aiGemini.isAvailable() });
});

app.get('/api/ai/analyze', async (req, res) => {
  if (!aiGemini.isAvailable()) {
    return res.json({ ok: false, error: 'AI_NOT_CONFIGURED' });
  }
  const storeId = (req.query.storeId || 'default').trim() || 'default';
  const refDate = req.query.referenceDate;
  const lang = req.query.lang || 'en';
  if (!refDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDate).trim())) {
    return res.status(400).json({ ok: false, error: 'referenceDate (YYYY-MM-DD) is required.' });
  }
  try {
    const text = await aiGemini.generateAnalysis(getReport, storeId, String(refDate).trim(), lang);
    res.json({ ok: true, text });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown error';
    console.error('AI analyze error:', msg);
    if (msg === 'NO_DATA') return res.status(404).json({ ok: false, error: 'NO_DATA' });
    res.status(500).json({ ok: false, error: msg });
  }
});

app.get('/api/ai/forecast', async (req, res) => {
  if (!aiGemini.isAvailable()) {
    return res.json({ ok: false, error: 'AI_NOT_CONFIGURED' });
  }
  const storeId = (req.query.storeId || 'default').trim() || 'default';
  const refDate = req.query.referenceDate;
  const lang = req.query.lang || 'en';
  if (!refDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDate).trim())) {
    return res.status(400).json({ ok: false, error: 'referenceDate (YYYY-MM-DD) is required.' });
  }
  try {
    const text = await aiGemini.generateForecast(getReport, storeId, String(refDate).trim(), lang);
    res.json({ ok: true, text });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown error';
    console.error('AI forecast error:', msg);
    if (msg === 'NO_DATA') return res.status(404).json({ ok: false, error: 'NO_DATA' });
    res.status(500).json({ ok: false, error: msg });
  }
});

const HOURLY_FORECAST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const hourlyForecastCache = new Map();

app.get('/api/ai/hourly-forecast', async (req, res) => {
  if (!aiGemini.isAvailable()) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }
  const storeId = (req.query.storeId || 'default').trim() || 'default';
  const refDate = req.query.referenceDate;
  if (!refDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDate).trim())) {
    return res.status(400).json({ error: 'referenceDate (YYYY-MM-DD) is required.' });
  }
  const cacheKey = `${storeId}:${refDate}`;
  const cached = hourlyForecastCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < HOURLY_FORECAST_CACHE_TTL_MS) {
    return res.json(cached.data);
  }
  try {
    const data = await aiGemini.generateHourlyForecast(getReport, storeId, String(refDate).trim());
    hourlyForecastCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown error';
    console.error('AI hourly-forecast error:', msg);
    if (msg === 'NO_DATA') return res.status(404).json({ error: 'NO_DATA' });
    res.status(500).json({ error: msg });
  }
});

app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required.' });
    }

    const parsed = [];
    for (const f of files) {
      if (!f.buffer) continue;
      const isCsv = (f.originalname || '').toLowerCase().endsWith('.csv');
      let data;
      try {
        data = isCsv ? parseCsv(f.buffer) : parseSheet(f.buffer);
      } catch (parseErr) {
        const msg = parseErr && (parseErr.message || String(parseErr));
        console.error('Parse error for file:', f.originalname || 'unknown', msg, parseErr && parseErr.stack);
        return res.status(400).json({
          error: (isCsv ? 'Failed to parse CSV: ' : 'Failed to parse Excel: ') + (msg || 'Invalid or unsupported file.'),
        });
      }
      const hasHourly = data && data.total && data.total.hourly && data.total.hourly.length > 0;
      const hasTotalRow = data && data.total && data.total.totalRow;
      if (data && data.total && data.businessDate && (hasHourly || hasTotalRow)) {
        const storeId = (data.storeId && String(data.storeId).trim()) || 'default';
        const storeName = (data.storeName && String(data.storeName).trim()) || 'Default';
        parsed.push({ businessDate: data.businessDate, data, storeId, storeName });
      }
    }

    if (parsed.length === 0) {
      return res.status(400).json({ error: 'No valid file with BusinessDate and hourly data found.' });
    }

    const referenceDate = (req.body && req.body.referenceDate) || (req.query && req.query.referenceDate);
    let refDateStr;
    if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(String(referenceDate).trim())) {
      refDateStr = String(referenceDate).trim();
    } else {
      refDateStr = parsed.map((p) => p.businessDate).sort().pop();
    }

    const yesterdayStr = addDays(refDateStr, -1);
    const lastWeekStr = addDays(refDateStr, -7);

    for (const { businessDate, data, storeId, storeName } of parsed) {
      await saveReport(businessDate, data, storeId);
      console.log('Saved to DB:', storeId, businessDate);
    }

    const refItem = parsed.find((p) => p.businessDate === refDateStr);
    const refStoreId = refItem ? refItem.storeId : parsed[0].storeId;
    let today = (refItem && refItem.data) || null;
    let yesterday = parsed.find((p) => p.businessDate === yesterdayStr && p.storeId === refStoreId);
    let lastWeek = parsed.find((p) => p.businessDate === lastWeekStr && p.storeId === refStoreId);
    yesterday = yesterday ? yesterday.data : null;
    lastWeek = lastWeek ? lastWeek.data : null;

    const storesSeen = new Map(parsed.map((p) => [p.storeId, p.storeName]));

    if (!today) {
      return res.status(400).json({
        error: 'No file found for reference date ' + refDateStr + '. Upload a file whose BusinessDate is ' + refDateStr + '.',
      });
    }

    const existingStores = await getStores();
    const byId = new Map(existingStores.map((s) => [s.id, s]));
    storesSeen.forEach((name, id) => {
      if (!byId.has(id)) byId.set(id, { id, name });
    });
    const merged = Array.from(byId.values());
    if (merged.length > 0) await saveStores(merged);

    const savedDates = await getAvailableDates(refStoreId);
    res.json({ today, yesterday, lastWeek, referenceDate: refDateStr, savedDates, storeId: refStoreId });
  } catch (err) {
    const msg = err && (err.message || String(err));
    const stack = err && err.stack;
    console.error('Upload error:', msg);
    if (stack) console.error(stack);
    res.status(500).json({ error: 'Error processing files: ' + (msg || 'Unknown error') });
  }
});

app.listen(PORT, () => {
  console.log('Sales Reports server: http://localhost:' + PORT);
  if (useSupabase) console.log('Database: Supabase');
  else console.log('Database: SQLite (data/sales.db)');
});
