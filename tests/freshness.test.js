'use strict';

// Tests for the business-hours gate on GET /api/health/freshness.
//
// The freshness probe emits a `data_stale` log event + HTTP 503 when the latest
// upload is older than the threshold — but ONLY during the store's operating
// hours. Outside business hours (overnight, or within the grace period after
// opening) a missing upload is expected and must NOT alert (no 503, no
// data_stale). That gate is what stops the early-morning alert-email storm.
//
// Unit tests drive the pure isWithinBusinessHours() helper with explicit
// minutes/weekday/grace so they are fully deterministic. Integration tests hit
// the endpoint to prove the gate is wired in; STALE_THRESHOLD_SECONDS = -1 makes
// every report "stale" (age 0 > -1) so we exercise the gate, not the age math,
// and FRESHNESS_OPEN_GRACE_MINUTES = 0 keeps the window bounds independent of the
// wall-clock time the suite happens to run at (grace itself is unit-tested).

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PROVIDER = 'sqlite';
process.env.LOG_LEVEL = 'silent';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-dash-test-'));
process.env.API_KEY = 'test-api-key';
process.env.STALE_THRESHOLD_SECONDS = '-1';
process.env.FRESHNESS_OPEN_GRACE_MINUTES = '0';
process.env.ENTRA_CLIENT_ID = '';
process.env.ENTRA_CLIENT_SECRET = '';
process.env.ENTRA_TENANT_ID = '';
process.env.ENTRA_REDIRECT_URI = '';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

const API_KEY = 'test-api-key';
const STORE = 'S1';
const DATE = '2026-06-16';
const within = app.isWithinBusinessHours;

describe('isWithinBusinessHours (unit)', () => {
  // Monday (weekday 1) 09:00–22:00, grace 60 → effective open 10:00 (600),
  // close 22:00 (1320).
  const MON = { 1: { start: '09:00', end: '22:00' } };

  test('before open + grace → false', () => {
    expect(within(MON, 9 * 60, 1, 60)).toBe(false);  // 09:00, still in grace
    expect(within(MON, 0, 1, 60)).toBe(false);        // overnight
  });
  test('at/after open + grace and before close → true', () => {
    expect(within(MON, 600, 1, 60)).toBe(true);       // 10:00 exactly
    expect(within(MON, 1319, 1, 60)).toBe(true);      // 21:59
  });
  test('at/after close → false', () => {
    expect(within(MON, 1320, 1, 60)).toBe(false);     // 22:00
    expect(within(MON, 1440, 1, 60)).toBe(false);
  });
  test('grace 0 makes open == start', () => {
    expect(within(MON, 540, 1, 0)).toBe(true);        // 09:00 with no grace
    expect(within(MON, 539, 1, 0)).toBe(false);       // 08:59
  });
  test('only the matching weekday is consulted', () => {
    expect(within(MON, 600, 2, 60)).toBe(true);       // Tuesday undefined → always-on
  });
  test('24h window (00:00–24:00) is within all day', () => {
    const allDay = { 1: { start: '00:00', end: '24:00' } };
    expect(within(allDay, 0, 1, 0)).toBe(true);
    expect(within(allDay, 1439, 1, 0)).toBe(true);
  });
  test('missing/misconfigured settings fall back to always-on', () => {
    expect(within(undefined, 100, 1, 60)).toBe(true);
    expect(within({}, 100, 1, 60)).toBe(true);
    expect(within({ 1: { start: '22:00', end: '09:00' } }, 700, 1, 60)).toBe(true); // end <= start
  });
});

function bangkokNowMinutes() {
  const hhmm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(min) {
  const c = Math.max(0, Math.min(1440, min));
  if (c === 1440) return '24:00';
  return String(Math.floor(c / 60)).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0');
}

function allDays(start, end) {
  const out = {};
  for (let d = 0; d <= 6; d++) out[d] = { start, end };
  return out;
}

function probe() {
  return request(app).get('/api/health/freshness').set('X-API-Key', API_KEY);
}

describe('GET /api/health/freshness — gate wired to the endpoint', () => {
  beforeAll(async () => {
    // Seed a report so getUploadLog() returns S1 as the latest upload.
    const res = await request(app)
      .post('/api/upload/item-sales-json')
      .set('X-API-Key', API_KEY)
      .send({ businessDate: DATE, storeId: STORE, byProduct: { 1: { itemCode: '1', itemName: 'A', departmentName: 'Grocery', totalNetSales: 10, totalQuantitySold: 1 } } });
    expect(res.status).toBe(200);
  });

  test('within hours + stale → 503 alerting', async () => {
    await db.saveBusinessHours(allDays('00:00', '24:00'), STORE); // open all day, grace 0 → always within
    const res = await probe();
    expect(res.status).toBe(503);
    expect(res.body.alerting).toBe(true);
    expect(res.body.outsideHours).toBe(false);
    expect(res.body.stale).toBe(true);
  });

  test('outside hours + stale → 200, suppressed (no alert)', async () => {
    const now = bangkokNowMinutes();
    let start;
    let end;
    if (now >= 200) { start = now - 180; end = now - 60; }   // window in the past → after close
    else { start = now + 60; end = now + 180; }               // window in the future → before open
    await db.saveBusinessHours(allDays(toHHMM(start), toHHMM(end)), STORE);
    const res = await probe();
    expect(res.status).toBe(200);
    expect(res.body.outsideHours).toBe(true);
    expect(res.body.alerting).toBe(false);
    expect(res.body.ok).toBe(true);
  });
});
