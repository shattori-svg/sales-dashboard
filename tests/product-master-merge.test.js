'use strict';

// Tests for POST /api/product-master/merge — upserts BC-syncable fields while
// preserving manual-only fields (nameTha, brand*, sizeSpec*, deptCode).

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

describe('POST /api/product-master/merge', () => {
  beforeEach(async () => {
    await db.saveProductMaster({
      '10000002': {
        barcodeNo: '4902777000001', nameEng: 'Old Name', nameTha: 'ชื่อไทย', nameJpn: 'チョコベビー',
        deptCode: '01', groupCode: '110101',
        brandEng: 'Meiji', brandTha: 'เมจิ', brandJpn: '明治',
        sizeSpecEng: '32g', sizeSpecTha: '32 กรัม', sizeSpecJpn: '32g',
        vendorNo: '11100030', unitCost: 30, unitPrice: 60,
      },
    });
  });

  test('updates synced fields and preserves manual-only fields', async () => {
    const res = await request(app)
      .post('/api/product-master/merge')
      .set('X-API-Key', API_KEY)
      .send({
        items: {
          '10000002': { nameEng: 'New Name', vendorNo: '22200099', unitCost: 36.7, unitPrice: 69, lastDirectCost: 51.59, groupCode: '110102' },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(0);

    const master = await db.getProductMaster();
    const m = master['10000002'];
    // Synced fields updated
    expect(m.nameEng).toBe('New Name');
    expect(m.vendorNo).toBe('22200099');
    expect(m.unitCost).toBe(36.7);
    expect(m.unitPrice).toBe(69);
    expect(m.lastDirectCost).toBe(51.59);
    expect(m.groupCode).toBe('110102');
    // Manual-only fields untouched
    expect(m.nameTha).toBe('ชื่อไทย');
    expect(m.nameJpn).toBe('チョコベビー');
    expect(m.brandEng).toBe('Meiji');
    expect(m.sizeSpecTha).toBe('32 กรัม');
    expect(m.deptCode).toBe('01');
    // Existing barcode kept when feed sends none
    expect(m.barcodeNo).toBe('4902777000001');
  });

  test('empty strings from the feed never blank out existing values', async () => {
    const res = await request(app)
      .post('/api/product-master/merge')
      .set('X-API-Key', API_KEY)
      .send({ items: { '10000002': { nameEng: '', barcodeNo: '  ', vendorNo: null } } });

    expect(res.status).toBe(200);
    const master = await db.getProductMaster();
    expect(master['10000002'].nameEng).toBe('Old Name');
    expect(master['10000002'].barcodeNo).toBe('4902777000001');
    expect(master['10000002'].vendorNo).toBe('11100030');
  });

  test('zero cost from BC overwrites (numbers follow BC as source of truth)', async () => {
    await request(app)
      .post('/api/product-master/merge')
      .set('X-API-Key', API_KEY)
      .send({ items: { '10000002': { unitCost: 0 } } });

    const master = await db.getProductMaster();
    expect(master['10000002'].unitCost).toBe(0);
    expect(master['10000002'].unitPrice).toBe(60);
  });

  test('creates new items with empty manual fields', async () => {
    const res = await request(app)
      .post('/api/product-master/merge')
      .set('X-API-Key', API_KEY)
      .send({
        items: {
          'NEW001': { nameEng: 'Brand New Item', barcodeNo: '4900000000001', unitPrice: 100 },
        },
      });

    expect(res.body.created).toBe(1);
    const master = await db.getProductMaster();
    expect(master['NEW001'].nameEng).toBe('Brand New Item');
    expect(master['NEW001'].barcodeNo).toBe('4900000000001');
    expect(master['NEW001'].unitPrice).toBe(100);
    expect(master['NEW001'].nameTha).toBe('');
    expect(master['NEW001'].brandEng).toBe('');
    // Pre-existing item untouched
    expect(master['10000002'].nameEng).toBe('Old Name');
  });

  test('returns 400 on missing or invalid body', async () => {
    for (const body of [{}, { items: {} }, { items: [1] }]) {
      const res = await request(app)
        .post('/api/product-master/merge')
        .set('X-API-Key', API_KEY)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  test('does not process without a valid API key', async () => {
    const res = await request(app)
      .post('/api/product-master/merge')
      .send({ items: { '10000002': { nameEng: 'Hacked' } } });
    expect(res.body.ok).not.toBe(true);

    const master = await db.getProductMaster();
    expect(master['10000002'].nameEng).toBe('Old Name');
  });
});
