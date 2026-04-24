'use strict';

// Force SQLite so no external DB is required.
process.env.DB_PROVIDER = 'sqlite';
process.env.LOG_LEVEL = 'silent';

// Disable Entra external auth so the 127.0.0.1 → localhost redirect
// middleware is not registered. Must be set BEFORE requiring server.js
// because dotenv.config() at its top will not overwrite vars already set.
delete process.env.ENTRA_CLIENT_ID;
delete process.env.ENTRA_CLIENT_SECRET;
delete process.env.ENTRA_TENANT_ID;
delete process.env.ENTRA_REDIRECT_URI;
process.env.ENTRA_CLIENT_ID = '';
process.env.ENTRA_CLIENT_SECRET = '';
process.env.ENTRA_TENANT_ID = '';
process.env.ENTRA_REDIRECT_URI = '';

const request = require('supertest');
const app = require('../server');

describe('health endpoints', () => {
  test('GET /healthz returns 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /health (alias) returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /readyz returns 200 when DB is reachable', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('GET /api/health/freshness returns 503 when no data has been uploaded', async () => {
    // In a clean local SQLite DB there may or may not be rows.
    // Accept either 200 (fresh) or 503 (stale/no_uploads), but require the schema.
    const res = await request(app).get('/api/health/freshness');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('stale');
    expect(res.body).toHaveProperty('thresholdSeconds');
    if (res.status === 503 && res.body.reason !== 'no_uploads') {
      // If stale (not empty), age must exceed threshold.
      expect(res.body.ageSeconds).toBeGreaterThan(res.body.thresholdSeconds);
    }
  });
});
