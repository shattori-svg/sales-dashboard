'use strict';

// Tests for the admin audit trail: recordAudit/getAuditLog in the SQLite
// backend and the GET /api/audit-log endpoint.

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PROVIDER = 'sqlite';
process.env.LOG_LEVEL = 'silent';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-dash-test-'));
process.env.API_KEY = 'test-api-key';
process.env.ENTRA_CLIENT_ID = '';
process.env.ENTRA_CLIENT_SECRET = '';
process.env.ENTRA_TENANT_ID = '';
process.env.ENTRA_REDIRECT_URI = '';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

const API_KEY = 'test-api-key';

describe('audit log (db layer)', () => {
  test('recordAudit prepends newest-first and getAuditLog honors limit', async () => {
    await db.recordAudit({ ts: '2026-06-10T00:00:00Z', actor: 'a', action: 'login' });
    await db.recordAudit({ ts: '2026-06-10T00:01:00Z', actor: 'b', action: 'user_create' });
    const all = await db.getAuditLog(10);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // newest first
    expect(all[0].action).toBe('user_create');
    expect(all[1].action).toBe('login');
    const one = await db.getAuditLog(1);
    expect(one.length).toBe(1);
    expect(one[0].action).toBe('user_create');
  });
});

describe('GET /api/audit-log', () => {
  test('requires admin / API key (no key → not processed)', async () => {
    const res = await request(app).get('/api/audit-log');
    // With zero users the global auth serves login HTML; assert it is not the JSON payload.
    expect(res.body.entries).toBeUndefined();
  });

  test('returns entries with a valid API key', async () => {
    await db.recordAudit({ ts: '2026-06-10T00:02:00Z', actor: 'c', action: 'stores_update' });
    const res = await request(app).get('/api/audit-log?limit=5').set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries[0].action).toBe('stores_update');
  });
});
