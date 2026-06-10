'use strict';

// Tests for POST /api/upload/item-costs — merges actual COGS (from BC value
// entries) into an existing report's byProduct.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Force SQLite in an isolated temp dir so the dev database is untouched.
process.env.DB_PROVIDER = 'sqlite';
process.env.LOG_LEVEL = 'silent';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-dash-test-'));
process.env.API_KEY = 'test-api-key';

// Disable Entra external auth (see health.test.js for why this must happen
// before requiring server.js).
process.env.ENTRA_CLIENT_ID = '';
process.env.ENTRA_CLIENT_SECRET = '';
process.env.ENTRA_TENANT_ID = '';
process.env.ENTRA_REDIRECT_URI = '';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

const API_KEY = 'test-api-key';
const DATE = '2026-06-09';
const STORE = '1001';

function seedReport() {
  return request(app)
    .post('/api/upload/item-sales-json')
    .set('X-API-Key', API_KEY)
    .send({
      businessDate: DATE,
      storeId: STORE,
      byProduct: {
        '10000013': { itemCode: '10000013', itemName: 'Item A', departmentName: 'Grocery', totalNetSales: 157.01, totalQuantitySold: 1 },
        '10000020': { itemCode: '10000020', itemName: 'Item B', departmentName: 'Meat', totalNetSales: 257.94, totalQuantitySold: 2 },
      },
    });
}

describe('POST /api/upload/item-costs', () => {
  beforeEach(async () => {
    const res = await seedReport();
    expect(res.status).toBe(200);
  });

  test('merges costs into existing byProduct and reports matched/unmatched', async () => {
    const res = await request(app)
      .post('/api/upload/item-costs')
      .set('X-API-Key', API_KEY)
      .send({
        businessDate: DATE,
        storeId: STORE,
        costs: { '10000013': 125.15, '10000020': 206.3, 'NO_SUCH_ITEM': 9.99 },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.matched).toBe(2);
    expect(res.body.unmatched).toBe(1);

    const report = await db.getReport(DATE, STORE);
    expect(report.byProduct['10000013'].costAmount).toBe(125.15);
    expect(report.byProduct['10000020'].costAmount).toBe(206.3);
    // Sales figures untouched by the cost merge.
    expect(report.byProduct['10000013'].totalNetSales).toBe(157.01);
  });

  test('is idempotent — re-upload overwrites costAmount instead of accumulating', async () => {
    const upload = () => request(app)
      .post('/api/upload/item-costs')
      .set('X-API-Key', API_KEY)
      .send({ businessDate: DATE, storeId: STORE, costs: { '10000013': 100 } });

    await upload();
    await upload();

    const report = await db.getReport(DATE, STORE);
    expect(report.byProduct['10000013'].costAmount).toBe(100);
  });

  test('returns 404 when no report exists for the date/store', async () => {
    const res = await request(app)
      .post('/api/upload/item-costs')
      .set('X-API-Key', API_KEY)
      .send({ businessDate: '2026-01-01', storeId: STORE, costs: { '10000013': 1 } });
    expect(res.status).toBe(404);
  });

  test('returns 400 on missing or invalid body', async () => {
    const bad = [
      {},
      { businessDate: 'not-a-date', costs: { a: 1 } },
      { businessDate: DATE, storeId: STORE, costs: {} },
      { businessDate: DATE, storeId: STORE, costs: [1, 2] },
    ];
    for (const body of bad) {
      const res = await request(app)
        .post('/api/upload/item-costs')
        .set('X-API-Key', API_KEY)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  test('does not process the merge without a valid API key', async () => {
    // With zero registered users the global requireAuth middleware serves the
    // login page (200 HTML) instead of 401/403 JSON, so assert on the outcome:
    // the handler must not run and the report must stay untouched.
    const res = await request(app)
      .post('/api/upload/item-costs')
      .send({ businessDate: DATE, storeId: STORE, costs: { '10000013': 999 } });
    expect(res.body.ok).not.toBe(true);

    const report = await db.getReport(DATE, STORE);
    expect(report.byProduct['10000013'].costAmount).toBeUndefined();
  });
});
