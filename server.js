'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');
const { parseSheet } = require('./parser');
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db = useSupabase ? require('./db-supabase') : require('./db');
const { saveReport, getReport, getAvailableDates } = db;

const app = express();
const PORT = process.env.PORT || 3333;

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
app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/dates', async (req, res) => {
  try {
    const dates = await getAvailableDates();
    res.json({ dates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get dates.' });
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

app.get('/api/daily-summary', async (req, res) => {
  try {
    const refStr = req.query.referenceDate;
    const days = Math.min(31, Math.max(1, parseInt(req.query.days, 10) || 7));
    if (!refStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(refStr).trim())) {
      return res.status(400).json({ error: 'Query parameter referenceDate (YYYY-MM-DD) is required.' });
    }
    const endDate = String(refStr).trim();
    const daysList = [];
    for (let i = days - 1; i >= 0; i--) {
      daysList.push(addDays(endDate, -i));
    }
    const summaries = [];
    for (const d of daysList) {
      const report = await getReport(d);
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
    const refDateStr = req.query.referenceDate;
    if (!refDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(refDateStr).trim())) {
      return res.status(400).json({ error: 'Query parameter referenceDate (YYYY-MM-DD) is required.' });
    }
    const date = String(refDateStr).trim();
    const yesterdayStr = addDays(date, -1);
    const lastWeekStr = addDays(date, -7);
    const today = await getReport(date);
    if (!today) {
      return res.status(404).json({ error: 'No report found for date ' + date + '.' });
    }
    const yesterday = await getReport(yesterdayStr);
    const lastWeek = await getReport(lastWeekStr);
    res.json({ today, yesterday: yesterday || null, lastWeek: lastWeek || null, referenceDate: date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to get report.' });
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
      const data = parseSheet(f.buffer);
      if (data && data.total && data.total.hourly && data.total.hourly.length > 0 && data.businessDate) {
        parsed.push({ businessDate: data.businessDate, data });
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

    let today = null;
    let yesterday = null;
    let lastWeek = null;

    for (const { businessDate, data } of parsed) {
      await saveReport(businessDate, data);
      console.log('Saved to DB:', businessDate);
      if (businessDate === refDateStr) today = data;
      else if (businessDate === yesterdayStr) yesterday = data;
      else if (businessDate === lastWeekStr) lastWeek = data;
    }

    if (!today) {
      return res.status(400).json({
        error: 'No file found for reference date ' + refDateStr + '. Upload a file whose BusinessDate is ' + refDateStr + '.',
      });
    }

    const savedDates = await getAvailableDates();
    res.json({ today, yesterday, lastWeek, referenceDate: refDateStr, savedDates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error processing files: ' + (err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log('Sales Reports server: http://localhost:' + PORT);
  if (useSupabase) console.log('Database: Supabase');
  else console.log('Database: SQLite (data/sales.db)');
});
