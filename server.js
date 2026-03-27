'use strict';

require('dotenv').config();

const path = require('path');
const XLSX = require('xlsx');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { parseSheet, parseCsv, parseItemSalesExcel, parseProductMasterExcel } = require('./parser');
const DB_PROVIDER = String(process.env.DB_PROVIDER || 'supabase').trim().toLowerCase();
const hasSupabaseConfig = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const hasPostgresConfig = !!process.env.DATABASE_URL;
let db;
let activeDatabaseLabel;
if (DB_PROVIDER === 'postgres') {
  if (!hasPostgresConfig) {
    console.warn('DB_PROVIDER=postgres requires DATABASE_URL. Falling back to SQLite.');
    db = require('./db');
    activeDatabaseLabel = 'SQLite (data/sales.db) [fallback]';
  } else {
    db = require('./db-postgres');
    activeDatabaseLabel = 'Cloud SQL (PostgreSQL)';
  }
} else if (DB_PROVIDER === 'supabase') {
  if (!hasSupabaseConfig) {
    console.warn('DB_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Falling back to SQLite.');
    db = require('./db');
    activeDatabaseLabel = 'SQLite (data/sales.db) [fallback]';
  } else {
    db = require('./db-supabase');
    activeDatabaseLabel = 'Supabase';
  }
} else if (DB_PROVIDER === 'sqlite') {
  db = require('./db');
  activeDatabaseLabel = 'SQLite (data/sales.db)';
} else {
  console.warn('Unsupported DB_PROVIDER: ' + DB_PROVIDER + '. Falling back to SQLite.');
  db = require('./db');
  activeDatabaseLabel = 'SQLite (data/sales.db) [fallback]';
}
const {
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
} = db;
const aiGemini = require('./ai-gemini');
const entraAuth = require('./entra-auth');

const app = express();
const PORT = process.env.PORT || 3333;
const EXTERNAL_AUTH_MODE = entraAuth.isEntraConfigured();
const EXTERNAL_AUTH_PASSWORD_HASH = 'EXTERNAL_AUTH';
const FX_FROM = 'THB';
const FX_TO = 'JPY';
const FX_TIMEZONE = 'Asia/Bangkok';
let fxRefreshInFlight = false;
let fxLastDailyRunDateKey = null;

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

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getEntraDisplayName(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const v = payload.name || payload.preferred_username || payload.email || null;
  return v != null ? String(v).trim() : null;
}

function sendLoginRequired(res) {
  const loginUrl = '/login?t=' + Date.now();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.status(200).send(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + loginUrl + '"><title>Sign in</title></head><body><p>Sign in required.</p><p><a href="' + loginUrl + '">Sign in</a></p></body></html>'
  );
}

function sendRedirectToEntra(res) {
  const state = entraAuth.createSignedState();
  const url = entraAuth.getAuthorizationUrl(state);
  if (!url || url.indexOf('login.microsoftonline.com') === -1) {
    return res.status(500).send('Misconfiguration: Entra URL invalid');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.redirect(302, url);
}

function toBool(v, fallback) {
  if (v == null || String(v).trim() === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return fallback;
}

function getBangkokDateKeyAndTime() {
  const now = new Date();
  const dateKey = now.toLocaleDateString('en-CA', { timeZone: FX_TIMEZONE });
  const hhmm = now.toLocaleTimeString('en-GB', { timeZone: FX_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = String(hhmm || '00:00').split(':');
  return {
    dateKey,
    hour: parseInt(parts[0], 10) || 0,
    minute: parseInt(parts[1], 10) || 0,
  };
}

async function refreshExchangeRateFromFrankfurter(reason) {
  if (fxRefreshInFlight) return;
  fxRefreshInFlight = true;
  try {
    const url = `https://api.frankfurter.app/latest?from=${FX_FROM}&to=${FX_TO}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text();
      throw new Error('Frankfurter error ' + res.status + ': ' + body);
    }
    const data = await res.json();
    const rate = Number(data && data.rates ? data.rates[FX_TO] : NaN);
    if (!rate || Number.isNaN(rate) || rate <= 0) {
      throw new Error('Invalid FX rate from Frankfurter');
    }
    await saveExchangeRate(rate);
    console.log(`[FX] Updated ${FX_FROM}->${FX_TO}=${rate} (${reason})`);
  } catch (err) {
    console.error('[FX] Update failed:', err.message || err);
  } finally {
    fxRefreshInFlight = false;
  }
}

function startExchangeRateScheduler() {
  const enabled = toBool(process.env.EXCHANGE_RATE_AUTO_UPDATE, true);
  if (!enabled) {
    console.log('[FX] Auto update disabled (EXCHANGE_RATE_AUTO_UPDATE=false)');
    return;
  }
  const dailyHour = Math.max(0, Math.min(23, parseInt(process.env.EXCHANGE_RATE_DAILY_HOUR || '0', 10) || 0));
  const dailyMinute = Math.max(0, Math.min(59, parseInt(process.env.EXCHANGE_RATE_DAILY_MINUTE || '5', 10) || 5));
  const checkIntervalMs = Math.max(60 * 1000, parseInt(process.env.EXCHANGE_RATE_CHECK_INTERVAL_MS || String(5 * 60 * 1000), 10) || (5 * 60 * 1000));

  console.log(`[FX] Scheduler ON (${FX_TIMEZONE} ${String(dailyHour).padStart(2, '0')}:${String(dailyMinute).padStart(2, '0')})`);
  refreshExchangeRateFromFrankfurter('startup');

  setInterval(() => {
    const now = getBangkokDateKeyAndTime();
    const reached = now.hour > dailyHour || (now.hour === dailyHour && now.minute >= dailyMinute);
    if (reached && fxLastDailyRunDateKey !== now.dateKey) {
      fxLastDailyRunDateKey = now.dateKey;
      refreshExchangeRateFromFrankfurter('daily');
    }
  }, checkIntervalMs);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'sales-report-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'sales_report_sid',
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' },
  })
);

if (EXTERNAL_AUTH_MODE) {
  app.use((req, res, next) => {
    if (req.hostname === '127.0.0.1') {
      const hostHeader = req.get('host') || '';
      const portPart = hostHeader.replace(/^127\.0\.0\.1/, '') || (':' + (process.env.PORT || 3333));
      return res.redirect(302, 'http://localhost' + portPart + (req.originalUrl || req.url || '/'));
    }
    next();
  });
}

function checkBasicAuth(req) {
  const header = req.headers && req.headers['authorization'];
  if (!header || !header.startsWith('Basic ')) return false;
  const b64 = header.slice(6);
  let decoded;
  try { decoded = Buffer.from(b64, 'base64').toString('utf8'); } catch (_) { return false; }
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  const expectedUser = process.env.ERP_UPLOAD_USERNAME || '';
  const expectedPass = process.env.ERP_UPLOAD_PASSWORD || '';
  return expectedUser && expectedPass && user === expectedUser && pass === expectedPass;
}

function checkApiKey(req) {
  const key = req.headers['x-api-key'];
  return !!(key && process.env.API_KEY && key === process.env.API_KEY);
}

function requireAuth(req, res, next) {
  const isStatic = /\.(css|js|ico|png|jpg|jpeg|gif|svg|woff2?|ttf|eot)$/i.test(req.path);
  if (isStatic) return next();
  if (req.path === '/login' || req.path === '/login/') return next();
  if (req.method === 'POST' && req.path === '/api/upload') return next();
  if (req.method === 'POST' && req.path === '/api/upload/final' && checkBasicAuth(req)) return next();
  if (req.path === '/auth/callback') return next();

  // Session check first — Entra users have no DB row, so countUsers() may be 0
  if (req.session && req.session.loggedIn) return next();

  // API key authentication
  if (checkApiKey(req)) return next();

  countUsers()
    .then((n) => {
      if (n === 0 && !EXTERNAL_AUTH_MODE) {
        if (req.path === '/api/auth/status' || req.path === '/api/bootstrap-admin')
          return next();
        return sendLoginRequired(res);
      }
      if (n === 0 && EXTERNAL_AUTH_MODE) {
        if (req.path === '/api/auth/status') return next();
        return sendRedirectToEntra(res);
      }
      const isApi = req.path.startsWith('/api/');
      if (isApi) return res.status(401).json({ error: 'Unauthorized' });
      return EXTERNAL_AUTH_MODE ? sendRedirectToEntra(res) : sendLoginRequired(res);
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    });
}

function requireAdmin(req, res, next) {
  if (req.method === 'POST' && req.path === '/api/upload') return next();
  if (req.method === 'POST' && req.path === '/api/upload/final' && checkBasicAuth(req)) return next();
  if (req.session && req.session.role === 'admin') return next();
  if (checkApiKey(req)) return next();
  const isApi = req.path.startsWith('/api/');
  if (isApi) return res.status(403).json({ error: 'Forbidden' });
  res.redirect('/');
}

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/login', (req, res) => {
  if (req.session && req.session.loggedIn) return res.redirect('/');
  if (EXTERNAL_AUTH_MODE) {
    if (req.query && req.query.loggedout === '1') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(200).send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signed out</title></head><body>' +
        '<p>Signed out.</p><p><a href="/login?signin=1">Sign in again</a></p></body></html>'
      );
    }
    if (req.query && req.query.error === 'auth_failed') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(200).send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authentication failed</title></head><body>' +
        '<p>Authentication failed. <a href="/login">Try again</a></p></body></html>'
      );
    }
    if (req.query && req.query.code && req.query.state) {
      return res.redirect('/auth/callback?' + new URLSearchParams(req.query).toString());
    }
    if (!(req.query && req.query.signin === '1')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(200).send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>' +
        '<p>Sign in required.</p><p><a href="/login?signin=1">Sign in with Microsoft</a></p></body></html>'
      );
    }
    return sendRedirectToEntra(res);
  }
  res.sendFile(path.join(__dirname, 'login.html'), (err) => {
    if (err) res.status(500).send('Login page not found');
  });
});

app.get('/auth/callback', async (req, res) => {
  if (!EXTERNAL_AUTH_MODE) return res.redirect('/login');
  const { code, state } = req.query;
  if (!code || !state) {
    const errMsg = req.query.error_description || req.query.error || 'Missing code or state';
    return res.status(400).send('Invalid or missing state or code: ' + String(errMsg));
  }
  if (!entraAuth.verifySignedState(state)) {
    return res.status(400).send('Invalid or expired state. Please try logging in again.');
  }
  try {
    const tokens = await entraAuth.exchangeCodeForTokens(code);
    const idToken = tokens.id_token;
    if (!idToken) return res.status(400).send('No id_token in response');
    const decoded = await entraAuth.validateIdToken(idToken);
    const email = entraAuth.getEmailFromPayload(decoded);
    if (!entraAuth.isAllowedEmail(email)) {
      return res.status(403).send('Access denied: only users from ' + entraAuth.getAllowedDomain() + ' are allowed');
    }
    let user = await getUserByUsername(email);
    if (!user) {
      const totalUsers = await countUsers();
      if (totalUsers === 0) {
        const created = await createUser({
          username: email,
          displayName: getEntraDisplayName(decoded),
          passwordHash: EXTERNAL_AUTH_PASSWORD_HASH,
          role: 'admin',
        });
        user = await getUserById(created.id);
        req.session.needsProfileSetup = true;
      } else {
        const created = await createUser({
          username: email,
          displayName: getEntraDisplayName(decoded),
          passwordHash: EXTERNAL_AUTH_PASSWORD_HASH,
          role: 'user',
        });
        user = await getUserById(created.id);
        req.session.needsProfileSetup = true;
      }
    }
    if (!user) return res.status(403).send('Access denied: user is not registered in User Master.');
    req.session.loggedIn = true;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.displayName = user.display_name || null;
    req.session.role = user.role === 'admin' ? 'admin' : 'user';
    req.session.save((err) => {
      if (err) {
        console.error('Entra session save error:', err);
        return res.redirect('/login?error=auth_failed');
      }
      res.redirect('/');
    });
  } catch (err) {
    console.error('Entra callback error:', err);
    return res.redirect('/login?error=auth_failed');
  }
});

app.post('/login', (req, res) => {
  if (EXTERNAL_AUTH_MODE) {
    return res.redirect('/login');
  }
  const password = (req.body.password || '').trim();
  const username = (req.body.username || '').trim();
  if (!username || !password) return res.redirect('/login?error=1');
  getUserByUsername(username)
    .then((user) => {
      if (!user) return res.redirect('/login?error=1');
      return bcrypt.compare(password, user.password_hash).then((ok) => {
        if (!ok) return res.redirect('/login?error=1');
        req.session.loggedIn = true;
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.displayName = user.display_name || null;
        req.session.role = user.role;
        req.session.needsProfileSetup = false;
        res.redirect('/');
      });
    })
    .catch((err) => {
      console.error(err);
      res.redirect('/login?error=1');
    });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sales_report_sid');
    res.redirect('/login?loggedout=1');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sales_report_sid');
    res.redirect('/login?loggedout=1');
  });
});

// Serve static assets (CSS, JS, images) before auth so login page can load styles
const staticAssetExt = /\.(css|js|ico|png|jpg|jpeg|gif|svg|woff2?|ttf|eot)$/i;
app.use((req, res, next) => {
  if (staticAssetExt.test(req.path)) {
    return express.static(path.join(__dirname))(req, res, (err) => {
      if (err) next(err);
      else next();
    });
  }
  next();
});

app.use(requireAuth);

app.get('/api/auth/status', async (req, res) => {
  const loggedIn = !!(req.session && req.session.loggedIn);
  const role = req.session && req.session.role ? req.session.role : null;
  const userId = req.session && req.session.userId ? req.session.userId : null;
  let username = req.session && req.session.username ? req.session.username : null;
  let displayName = req.session && req.session.displayName ? req.session.displayName : null;
  let preferredStore = null;
  let preferredDepartment = null;
  let preferredCurrency = null;
  let preferredLanguage = null;
  const needsProfileSetup = !!(req.session && req.session.needsProfileSetup);

  if (loggedIn) {
    if (userId) {
      try {
        const user = await getUserById(userId);
        if (user) {
          username = user.username;
          displayName = user.display_name || null;
          preferredStore = user.preferred_store || null;
          preferredDepartment = user.preferred_department || null;
          preferredCurrency = user.preferred_currency || null;
          preferredLanguage = user.preferred_language || null;
        }
      } catch (e) {}
    }
    return res.json({
      authEnabled: true,
      externalAuth: EXTERNAL_AUTH_MODE,
      loggedIn: true,
      role,
      userId,
      username,
      displayName,
      preferredStore,
      preferredDepartment,
      preferredCurrency,
      preferredLanguage,
      needsProfileSetup,
    });
  }

  const n = await countUsers();
  if (n === 0) {
    if (EXTERNAL_AUTH_MODE) {
      return res.json({ authEnabled: true, externalAuth: true, loggedIn: false, bootstrap: false, role: null });
    }
    return res.json({ authEnabled: false, externalAuth: false, loggedIn: false, bootstrap: true, role: null });
  }
  res.json({
    authEnabled: true,
    externalAuth: EXTERNAL_AUTH_MODE,
    loggedIn: false,
    role: null,
    userId: null,
    username: null,
    displayName: null,
    preferredStore: null,
    preferredDepartment: null,
    preferredCurrency: null,
    preferredLanguage: null,
    needsProfileSetup: false,
  });
});

app.put('/api/me/preferences', async (req, res) => {
  if (!req.session || !req.session.loggedIn || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const storeId = req.body.storeId != null ? String(req.body.storeId).trim() : null;
  const department = req.body.department != null ? String(req.body.department).trim() : null;
  const currency = req.body.currency != null ? String(req.body.currency).trim().toUpperCase() : null;
  const language = req.body.language != null ? String(req.body.language).trim().toLowerCase() : null;
  try {
    await updateUserPreferences(req.session.userId, {
      preferredStore: storeId || null,
      preferredDepartment: department || null,
      preferredCurrency: (currency === 'THB' || currency === 'JPY') ? currency : null,
      preferredLanguage: (language === 'ja' || language === 'en' || language === 'th') ? language : null,
    });
    req.session.needsProfileSetup = false;
    return res.json({ ok: true });
  } catch (err) {
    console.error('Update preferences error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save preferences' });
  }
});

app.post('/api/bootstrap-admin', async (req, res) => {
  if (EXTERNAL_AUTH_MODE) return res.status(403).json({ error: 'Use Entra ID login when Entra is configured' });
  const n = await countUsers();
  if (n > 0) return res.status(403).json({ error: 'Bootstrap only when no users' });
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await createUser({ username, passwordHash, role: 'admin' });
    req.session.loggedIn = true;
    req.session.userId = created.id;
    req.session.username = created.username;
    req.session.displayName = created.display_name || null;
    req.session.role = 'admin';
    req.session.needsProfileSetup = false;
    res.status(201).json({ ok: true, redirect: '/' });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err && err.message && err.message.includes('unique'))) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create admin' });
  }
});

app.use(express.static(path.join(__dirname), { etag: false, lastModified: false, setHeaders: (res, filePath) => { if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store'); } }));

app.get('/setup', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'), (err) => {
    if (err) res.status(500).send('Setup page not found');
  });
});
app.get('/upload', (req, res) => res.redirect('/setup'));

app.get('/api/stores', async (req, res) => {
  try {
    const [stores, exchange] = await Promise.all([getStores(), getExchangeRate()]);
    res.json({
      stores,
      exchangeRate: exchange.rate,
      exchangeRateUpdatedAt: exchange.updated_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get stores.' });
  }
});

app.put('/api/stores', requireAdmin, async (req, res) => {
  try {
    const stores = req.body && req.body.stores;
    if (!Array.isArray(stores)) {
      return res.status(400).json({ error: 'Body must be { stores: [ { id, name }, ... ], exchange_rate? }.' });
    }
    const normalized = stores.map((s) => ({
      id: String(s && s.id != null ? s.id : '').trim() || 'default',
      name: String(s && s.name != null ? s.name : '').trim() || 'Store',
    }));
    if (normalized.length === 0) normalized.push({ id: 'default', name: 'Default' });
    const reqRate = req.body.exchange_rate != null ? Number(req.body.exchange_rate) : NaN;
    if (typeof reqRate === 'number' && !Number.isNaN(reqRate) && reqRate > 0) {
      await saveExchangeRate(reqRate);
    }
    await saveStores(normalized);
    const exchange = await getExchangeRate();
    res.json({
      stores: normalized,
      exchangeRate: exchange.rate,
      exchangeRateUpdatedAt: exchange.updated_at,
    });
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

app.put('/api/business-hours', requireAdmin, async (req, res) => {
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

app.get('/api/upload-log', requireAdmin, async (req, res) => {
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
  const department = (req.query.department || 'Total').trim() || 'Total';
  const lang = req.query.lang || 'en';
  if (!refDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDate).trim())) {
    return res.status(400).json({ ok: false, error: 'referenceDate (YYYY-MM-DD) is required.' });
  }
  try {
    const text = await aiGemini.generateAnalysis(getReport, storeId, String(refDate).trim(), lang, department);
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
  const department = (req.query.department || 'Total').trim() || 'Total';
  const lang = req.query.lang || 'en';
  if (!refDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDate).trim())) {
    return res.status(400).json({ ok: false, error: 'referenceDate (YYYY-MM-DD) is required.' });
  }
  try {
    const text = await aiGemini.generateForecast(getReport, storeId, String(refDate).trim(), lang, department);
    res.json({ ok: true, text });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown error';
    console.error('AI forecast error:', msg);
    if (msg === 'NO_DATA') return res.status(404).json({ ok: false, error: 'NO_DATA' });
    res.status(500).json({ ok: false, error: msg });
  }
});

app.get('/api/ai/today', async (req, res) => {
  if (!aiGemini.isAvailable()) {
    return res.json({ ok: false, error: 'AI_NOT_CONFIGURED' });
  }
  const storeId = (req.query.storeId || 'default').trim() || 'default';
  const refDate = req.query.referenceDate;
  const department = (req.query.department || 'Total').trim() || 'Total';
  const lang = req.query.lang || 'en';
  const currentTime = req.query.currentTime || null;
  if (!refDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDate).trim())) {
    return res.status(400).json({ ok: false, error: 'referenceDate (YYYY-MM-DD) is required.' });
  }
  try {
    const text = await aiGemini.generateTodayInsight(getReport, storeId, String(refDate).trim(), currentTime, lang, department);
    res.json({ ok: true, text });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown error';
    console.error('AI today insight error:', msg);
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
  const currentTime = (req.query.currentTime || '').trim() || null;
  if (!refDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDate).trim())) {
    return res.status(400).json({ error: 'referenceDate (YYYY-MM-DD) is required.' });
  }
  const cacheKey = `${storeId}:${refDate}`;
  const cached = !currentTime ? hourlyForecastCache.get(cacheKey) : null;
  if (cached && Date.now() - cached.ts < HOURLY_FORECAST_CACHE_TTL_MS) {
    return res.json(cached.data);
  }
  try {
    const data = await aiGemini.generateHourlyForecast(getReport, storeId, String(refDate).trim(), currentTime);
    if (!currentTime) hourlyForecastCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown error';
    console.error('AI hourly-forecast error:', msg);
    if (msg === 'NO_DATA') return res.status(404).json({ error: 'NO_DATA' });
    res.status(500).json({ error: msg });
  }
});

async function handleUpload(req, res, isFinal) {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required.' });
    }

    const parsed = [];
    for (const f of files) {
      if (!f.buffer) continue;
      const isCsv = (f.originalname || '').toLowerCase().endsWith('.csv');
      let results;
      try {
        if (isCsv) {
          const arr = parseCsv(f.buffer);
          results = arr; // array or null
        } else {
          const single = parseSheet(f.buffer);
          results = single ? [single] : null;
        }
      } catch (parseErr) {
        const msg = parseErr && (parseErr.message || String(parseErr));
        console.error('Parse error for file:', f.originalname || 'unknown', msg, parseErr && parseErr.stack);
        return res.status(400).json({
          error: (isCsv ? 'Failed to parse CSV: ' : 'Failed to parse Excel: ') + (msg || 'Invalid or unsupported file.'),
        });
      }
      if (!results) continue;
      for (const data of results) {
        const hasHourly = data && data.total && data.total.hourly && data.total.hourly.length > 0;
        const hasTotalRow = data && data.total && data.total.totalRow;
        if (data && data.total && data.businessDate && (hasHourly || hasTotalRow)) {
          const storeId = (data.storeId && String(data.storeId).trim()) || 'default';
          const storeName = (data.storeName && String(data.storeName).trim()) || 'Default';
          parsed.push({ businessDate: data.businessDate, data, storeId, storeName });
        }
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

    for (const { businessDate, data, storeId } of parsed) {
      await saveReport(businessDate, data, storeId, isFinal);
      console.log('Saved to DB:', storeId, businessDate, isFinal ? '(final)' : '(provisional)');
    }

    if (isFinal) {
      // ERP 確定値: 保存確認のみ返す
      const saved = parsed.map((p) => ({ storeId: p.storeId, businessDate: p.businessDate }));
      return res.json({ ok: true, saved });
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
}

app.post('/api/upload', requireAdmin, upload.array('files', 10), (req, res) => handleUpload(req, res, false));

app.post('/api/upload/final', requireAdmin, upload.array('files', 10), (req, res) => handleUpload(req, res, true));

app.post('/api/upload/item-sales', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: 'Excel file is required (field name: file).' });
    }
    const businessDate = req.body && req.body.businessDate ? String(req.body.businessDate).trim() : '';
    if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      return res.status(400).json({ error: 'businessDate (YYYY-MM-DD) is required.' });
    }
    const storeId = (req.body && req.body.storeId ? String(req.body.storeId).trim() : '') || 'default';

    let itemSalesData;
    try {
      itemSalesData = parseItemSalesExcel(file.buffer, businessDate, storeId);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Failed to parse Item Sales Excel: ' + (parseErr && parseErr.message || String(parseErr)) });
    }
    if (!itemSalesData) {
      return res.status(400).json({ error: 'No valid Item Sales data found in the file. Check that the file is an LS-Central Item Sales report.' });
    }

    // Merge byProduct into existing report for this store/date
    let existing = null;
    try {
      existing = await getReport(businessDate, storeId);
    } catch (_) {}

    let merged;
    if (existing) {
      // Keep existing report data; replace byProduct with Item Sales data
      merged = Object.assign({}, existing, {
        byProduct: itemSalesData.byProduct,
        _updatedAt: undefined,
        _isFinal: undefined,
      });
    } else {
      merged = itemSalesData;
    }

    await saveReport(businessDate, merged, storeId, false);
    console.log('Item Sales imported:', storeId, businessDate, Object.keys(itemSalesData.byProduct).length, 'products');

    const savedDates = await getAvailableDates(storeId);
    res.json({
      ok: true,
      storeId,
      businessDate,
      productCount: Object.keys(itemSalesData.byProduct).length,
      savedDates,
    });
  } catch (err) {
    const msg = err && (err.message || String(err));
    console.error('Item Sales upload error:', msg);
    res.status(500).json({ error: 'Error processing Item Sales file: ' + (msg || 'Unknown error') });
  }
});

// JSON-based Item Sales upload (bypasses xlsx parsing)
// Accepts pre-parsed byProduct data as JSON — much faster for automated pipelines.
// Body: { businessDate: "YYYY-MM-DD", storeId: "...", byProduct: { "itemCode": {...}, ... } }
app.post('/api/upload/item-sales-json', requireAdmin, express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const { businessDate, storeId: rawStoreId, byProduct } = req.body || {};
    if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate).trim())) {
      return res.status(400).json({ error: 'businessDate (YYYY-MM-DD) is required.' });
    }
    if (!byProduct || typeof byProduct !== 'object' || Object.keys(byProduct).length === 0) {
      return res.status(400).json({ error: 'byProduct object is required and must not be empty.' });
    }
    const storeId = (rawStoreId ? String(rawStoreId).trim() : '') || 'default';
    const bDate = String(businessDate).trim();

    // Build department totals from byProduct
    const DEPT_MAP_REV = {
      'Grocery': true, 'Fruit & Vegetable': true, 'Fish & Seafood': true,
      'Meat': true, 'Delicatessen': true, 'Store Management': true,
    };
    const DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];
    const deptTotals = {};
    let totalNet = 0, totalGross = 0, totalQty = 0;

    for (const [code, p] of Object.entries(byProduct)) {
      const dn = p.departmentName || '';
      if (!DEPT_MAP_REV[dn]) continue;
      const ns = Number(p.totalNetSales) || 0;
      const gs = Number(p.totalGrossSales) || 0;
      const qs = Number(p.totalQuantitySold) || 0;
      const da = Number(p.totalDiscountAmount) || 0;
      if (!deptTotals[dn]) deptTotals[dn] = { netSales: 0, grossSales: 0, quantitySold: 0, discountAmount: 0 };
      deptTotals[dn].netSales += ns;
      deptTotals[dn].grossSales += gs;
      deptTotals[dn].quantitySold += qs;
      deptTotals[dn].discountAmount += da;
      totalNet += ns;
      totalGross += gs;
      totalQty += qs;
    }

    const byDepartment = {};
    DEPARTMENTS.forEach(d => { byDepartment[d] = { hourly: [] }; });
    Object.entries(deptTotals).forEach(([dn, t]) => {
      byDepartment[dn] = {
        hourly: [],
        totalRow: { netSales: t.netSales, grossSales: t.grossSales, quantitySold: t.quantitySold, receiptCount: null, discountAmount: t.discountAmount || undefined },
      };
    });

    const itemSalesData = {
      businessDate: bDate,
      storeId,
      storeName: storeId,
      total: { totalRow: { netSales: totalNet, grossSales: totalGross, quantitySold: totalQty, receiptCount: null }, hourly: [] },
      byDepartment,
      byProduct,
    };

    let existing = null;
    try { existing = await getReport(bDate, storeId); } catch (_) {}

    let merged;
    if (existing) {
      merged = Object.assign({}, existing, { byProduct: itemSalesData.byProduct, _updatedAt: undefined, _isFinal: undefined });
    } else {
      merged = itemSalesData;
    }

    await saveReport(bDate, merged, storeId, false);
    console.log('Item Sales (JSON) imported:', storeId, bDate, Object.keys(byProduct).length, 'products');

    const savedDates = await getAvailableDates(storeId);
    res.json({ ok: true, storeId, businessDate: bDate, productCount: Object.keys(byProduct).length, savedDates });
  } catch (err) {
    const msg = err && (err.message || String(err));
    console.error('Item Sales JSON upload error:', msg);
    res.status(500).json({ error: 'Error processing Item Sales JSON: ' + (msg || 'Unknown error') });
  }
});

app.get('/api/product-master', async (req, res) => {
  try {
    const master = await getProductMaster();
    res.json({ master });
  } catch (err) {
    res.status(500).json({ error: err && err.message || 'Server error' });
  }
});

app.get('/api/products/export', requireAuth, async (req, res) => {
  const storeId = req.query.storeId || 'default';
  const dateFrom = (req.query.dateFrom || '').trim();
  const dateTo = (req.query.dateTo || dateFrom).trim();
  const deptFilter = (req.query.dept || '').trim();

  if (!dateFrom || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    return res.status(400).json({ error: 'dateFrom (YYYY-MM-DD) is required.' });
  }

  // Build date list (max 90 days)
  const dates = [];
  let cur = new Date(dateFrom + 'T00:00:00');
  const end = new Date((dateTo || dateFrom) + 'T00:00:00');
  while (cur <= end && dates.length <= 90) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  try {
    const [reports, master] = await Promise.all([
      Promise.all(dates.map((d) => db.getReport(d, storeId).catch(() => null))),
      db.getProductMaster(),
    ]);

    // Aggregate byProduct across dates
    const merged = {};
    reports.forEach((report) => {
      if (!report || !report.byProduct) return;
      Object.keys(report.byProduct).forEach((itemCode) => {
        const p = report.byProduct[itemCode];
        if (!merged[itemCode]) {
          merged[itemCode] = {
            itemCode,
            itemName: p.itemName || '',
            departmentName: p.departmentName || '',
            totalNetSales: 0,
            totalQuantitySold: 0,
          };
        }
        merged[itemCode].totalNetSales += Number(p.totalNetSales) || 0;
        merged[itemCode].totalQuantitySold += Number(p.totalQuantitySold) || 0;
      });
    });

    let products = Object.values(merged);
    if (deptFilter) products = products.filter((p) => p.departmentName === deptFilter);
    products.sort((a, b) => b.totalNetSales - a.totalNetSales);

    const grandTotal = products.reduce((s, p) => s + p.totalNetSales, 0);

    const rows = [['Barcode', 'Item Name', 'Department', 'Net Sales (THB)', 'Qty Sold', 'Unit Price (THB)', 'Share %']];
    products.forEach((p) => {
      const m = master[p.itemCode] || {};
      const barcode = m.barcodeNo || p.itemCode;
      const name = m.nameEng || p.itemName || p.itemCode;
      const unitPrice = p.totalQuantitySold > 0 ? Math.round(p.totalNetSales / p.totalQuantitySold) : '';
      const share = grandTotal > 0 ? parseFloat((p.totalNetSales / grandTotal * 100).toFixed(2)) : 0;
      rows.push([barcode, name, p.departmentName, p.totalNetSales, p.totalQuantitySold, unitPrice, share]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Products');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const suffix = dateTo && dateTo !== dateFrom ? `_to_${dateTo}` : '';
    const filename = `products_${dateFrom}${suffix}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('products/export error:', err);
    res.status(500).json({ error: err && err.message || 'Server error' });
  }
});

app.post('/api/product-master/import', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: 'Excel file is required (field name: file).' });
    }
    let master;
    try {
      master = parseProductMasterExcel(file.buffer);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Failed to parse product master: ' + (parseErr && parseErr.message || String(parseErr)) });
    }
    if (!master) {
      return res.status(400).json({ error: 'No valid product master data found. Check that the file is an LS-Central Item list export with columns: Item No., Barcode No., Description (ENG).' });
    }
    await saveProductMaster(master);
    const count = Object.keys(master).length;
    console.log('Product master imported:', count, 'items');
    res.json({ ok: true, count });
  } catch (err) {
    const msg = err && (err.message || String(err));
    console.error('Product master import error:', msg);
    res.status(500).json({ error: 'Error processing product master: ' + (msg || 'Unknown error') });
  }
});

// User master (admin only)
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await getUsers();
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get users.' });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const username = (req.body.username || '').trim();
  const displayName = req.body.displayName != null ? String(req.body.displayName).trim() : null;
  const password = (req.body.password || '').trim();
  const role = (req.body.role === 'admin' ? 'admin' : 'user');
  const preferredStore = req.body.preferredStore ? String(req.body.preferredStore).trim() : null;
  const preferredDepartment = req.body.preferredDepartment ? String(req.body.preferredDepartment).trim() : null;
  const preferredCurrency = req.body.preferredCurrency ? String(req.body.preferredCurrency).trim() : null;
  const preferredLanguage = req.body.preferredLanguage ? String(req.body.preferredLanguage).trim() : null;
  if (!username) return res.status(400).json({ error: 'Username is required.' });
  if (!EXTERNAL_AUTH_MODE && (!password || password.length < 6)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  try {
    const passwordHash = EXTERNAL_AUTH_MODE ? EXTERNAL_AUTH_PASSWORD_HASH : await bcrypt.hash(password, 10);
    const created = await createUser({ username, displayName, passwordHash, role });
    if (preferredStore || preferredDepartment || preferredCurrency || preferredLanguage) {
      await updateUserPreferences(created.id, { preferredStore, preferredDepartment, preferredCurrency, preferredLanguage });
    }
    const user = await getUserById(created.id);
    res.status(201).json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      preferred_store: user.preferred_store,
      preferred_department: user.preferred_department,
      preferred_currency: user.preferred_currency,
      preferred_language: user.preferred_language
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err && err.message && err.message.includes('unique'))) {
      return res.status(400).json({ error: 'Username already exists.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create user.' });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const username = req.body.username !== undefined ? String(req.body.username).trim() : undefined;
  const displayName = req.body.displayName !== undefined ? (req.body.displayName != null ? String(req.body.displayName).trim() : null) : undefined;
  const password = req.body.password !== undefined ? String(req.body.password).trim() : undefined;
  const role = req.body.role !== undefined ? (req.body.role === 'admin' ? 'admin' : 'user') : undefined;
  const preferredStore = req.body.preferredStore !== undefined ? (req.body.preferredStore ? String(req.body.preferredStore).trim() : null) : undefined;
  const preferredDepartment = req.body.preferredDepartment !== undefined ? (req.body.preferredDepartment ? String(req.body.preferredDepartment).trim() : null) : undefined;
  const preferredCurrency = req.body.preferredCurrency !== undefined ? (req.body.preferredCurrency ? String(req.body.preferredCurrency).trim() : null) : undefined;
  const preferredLanguage = req.body.preferredLanguage !== undefined ? (req.body.preferredLanguage ? String(req.body.preferredLanguage).trim() : null) : undefined;
  if (!id) return res.status(400).json({ error: 'User id is required.' });
  const admins = await countAdmins();
  const existing = await getUserById(id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  if (existing.role === 'admin' && role === 'user' && admins <= 1) {
    return res.status(400).json({ error: 'Cannot change the last admin to user.' });
  }
  try {
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (displayName !== undefined) updates.displayName = displayName;
    if (role !== undefined) updates.role = role;
    if (!EXTERNAL_AUTH_MODE && password && password.length >= 6) {
      updates.passwordHash = await bcrypt.hash(password, 10);
    }
    if (Object.keys(updates).length > 0) {
      await updateUser(id, updates);
    }
    if (preferredStore !== undefined || preferredDepartment !== undefined || preferredCurrency !== undefined || preferredLanguage !== undefined) {
      await updateUserPreferences(id, {
        preferredStore: preferredStore !== undefined ? preferredStore : existing.preferred_store,
        preferredDepartment: preferredDepartment !== undefined ? preferredDepartment : existing.preferred_department,
        preferredCurrency: preferredCurrency !== undefined ? preferredCurrency : existing.preferred_currency,
        preferredLanguage: preferredLanguage !== undefined ? preferredLanguage : existing.preferred_language,
      });
    }
    const updated = await getUserById(id);
    res.json({
      id: updated.id,
      username: updated.username,
      display_name: updated.display_name,
      role: updated.role,
      preferred_store: updated.preferred_store,
      preferred_department: updated.preferred_department,
      preferred_currency: updated.preferred_currency,
      preferred_language: updated.preferred_language
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err && err.message && err.message.includes('unique'))) {
      return res.status(400).json({ error: 'Username already exists.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update user.' });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'User id is required.' });
  if (req.session.userId === id) return res.status(400).json({ error: 'Cannot delete your own account.' });
  const user = await getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') {
    const admins = await countAdmins();
    if (admins <= 1) return res.status(400).json({ error: 'Cannot delete the last admin.' });
  }
  try {
    await deleteUser(id);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete user.' });
  }
});

app.listen(PORT, () => {
  console.log('Sales Reports server: http://localhost:' + PORT);
  console.log('Database: ' + activeDatabaseLabel);
  startExchangeRateScheduler();
});
              