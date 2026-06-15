'use strict';

// Tests for GET /api/ai/hourly-forecast — the best-effort end-of-day forecast
// overlay. Regression guards for the 2026-06-14 incident: Gemini timeouts made
// this endpoint emit HTTP 500, which tripped Cloud Run's "5xx rate" alert and
// flooded ops with email. The forecast is optional (the frontend ignores
// failures), so:
//   - AI failures must return 200 { unavailable: true }, never 5xx.
//   - time-aware ("currentTime") calls must be cached and de-duplicated so a
//     burst of dashboard renders does not stampede Gemini.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Force SQLite in an isolated temp dir so the dev database is untouched.
process.env.DB_PROVIDER = 'sqlite';
process.env.LOG_LEVEL = 'silent';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-dash-test-'));
process.env.API_KEY = 'test-api-key';

// Disable Entra external auth (must happen before requiring server.js).
process.env.ENTRA_CLIENT_ID = '';
process.env.ENTRA_CLIENT_SECRET = '';
process.env.ENTRA_TENANT_ID = '';
process.env.ENTRA_REDIRECT_URI = '';

const request = require('supertest');
const aiGemini = require('../ai-gemini');
const app = require('../server');

const API_KEY = 'test-api-key';
const DATE = '2026-06-14';
const CURRENT_TIME = '2026-06-14T10:00:00.000Z';

// The endpoint guards on isAvailable(); force it true so we exercise the AI path
// regardless of whether GEMINI_API_KEY is set in the test environment. The
// generateHourlyForecast stub is restored after every test.
const realIsAvailable = aiGemini.isAvailable;
const realGenerate = aiGemini.generateHourlyForecast;
beforeAll(() => { aiGemini.isAvailable = () => true; });
afterAll(() => { aiGemini.isAvailable = realIsAvailable; });
afterEach(() => { aiGemini.generateHourlyForecast = realGenerate; });

function get(storeId, currentTime = CURRENT_TIME) {
  let url = `/api/ai/hourly-forecast?storeId=${encodeURIComponent(storeId)}&referenceDate=${DATE}`;
  if (currentTime != null) url += `&currentTime=${encodeURIComponent(currentTime)}`;
  return request(app).get(url).set('X-API-Key', API_KEY);
}

describe('GET /api/ai/hourly-forecast', () => {
  test('returns 200 { unavailable: true } (not 5xx) when Gemini fails', async () => {
    aiGemini.generateHourlyForecast = async () => { throw new Error('AI_TIMEOUT'); };
    const res = await get('err-store');
    expect(res.status).toBe(200);
    expect(res.body.unavailable).toBe(true);
  });

  test('returns 404 NO_DATA when the report is missing', async () => {
    aiGemini.generateHourlyForecast = async () => { throw new Error('NO_DATA'); };
    const res = await get('nodata-store');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NO_DATA');
  });

  test('returns 400 when referenceDate is missing', async () => {
    aiGemini.generateHourlyForecast = async () => ({});
    const res = await request(app)
      .get(`/api/ai/hourly-forecast?storeId=x&currentTime=${encodeURIComponent(CURRENT_TIME)}`)
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(400);
  });

  test('caches time-aware (currentTime) calls within a bucket — Gemini hit once', async () => {
    let calls = 0;
    aiGemini.generateHourlyForecast = async () => { calls += 1; return { forecastTotalNetSales: 1000 }; };
    const r1 = await get('cache-store');
    const r2 = await get('cache-store'); // same store/date/currentTime → same bucket
    expect(r1.status).toBe(200);
    expect(r1.body.forecastTotalNetSales).toBe(1000);
    expect(r2.body.forecastTotalNetSales).toBe(1000);
    expect(calls).toBe(1);
  });

  test('de-duplicates concurrent renders into a single in-flight Gemini call', async () => {
    let calls = 0;
    aiGemini.generateHourlyForecast = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { forecastTotalNetSales: 2000 };
    };
    const results = await Promise.all([get('herd-store'), get('herd-store'), get('herd-store')]);
    results.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body.forecastTotalNetSales).toBe(2000);
    });
    expect(calls).toBe(1);
  });
});
