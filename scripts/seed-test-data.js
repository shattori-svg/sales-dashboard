'use strict';

// Seeds 90 days of continuous test data ending at a specified date,
// so we can verify weekly aggregation logic with gap-free data.
// Usage: node scripts/seed-test-data.js [endDate=YYYY-MM-DD] [storeId=1001]

const path = require('path');
const Database = require('better-sqlite3');

const DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];
const DEPT_SHARE = { 'Grocery': 0.25, 'Fruit & Vegetable': 0.22, 'Fish & Seafood': 0.2, 'Meat': 0.15, 'Delicatessen': 0.17, 'Store Management': 0.01 };

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function generateReportForDate(dateStr, storeId) {
  // Seed-like deterministic variation per day
  const daySeed = parseInt(dateStr.replace(/-/g, ''), 10) % 97;
  const dayOfWeek = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun
  const weekendBoost = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.3 : 1.0;
  const baseTotal = Math.floor((40000 + daySeed * 1000) * weekendBoost); // 40K-140K THB/day
  const receiptCount = Math.floor(baseTotal / 200);
  const quantitySold = Math.floor(baseTotal / 50);

  const hourly = [];
  const hoursOpen = 13; // 09:00-22:00
  const perHour = Math.floor(baseTotal / hoursOpen);
  for (let h = 9; h < 22; h++) {
    const hh = String(h).padStart(2, '0');
    hourly.push({
      timeKey: hh + ':00',
      timeLabel: hh + ':00',
      netSales: perHour + (h % 3) * 500,
      grossSales: perHour + (h % 3) * 500,
      quantitySold: Math.floor((perHour + (h % 3) * 500) / 50),
      receiptCount: Math.floor((perHour + (h % 3) * 500) / 200),
    });
  }

  const totalRow = {
    netSales: baseTotal,
    grossSales: baseTotal,
    quantitySold,
    receiptCount,
  };

  const byDepartment = {};
  DEPARTMENTS.forEach(d => {
    const share = DEPT_SHARE[d];
    const deptSales = Math.floor(baseTotal * share);
    byDepartment[d] = {
      hourly: hourly.map(h => ({
        timeKey: h.timeKey,
        timeLabel: h.timeLabel,
        netSales: Math.floor(h.netSales * share),
        grossSales: Math.floor(h.grossSales * share),
        quantitySold: Math.floor(h.quantitySold * share),
        receiptCount: Math.floor(h.receiptCount * share),
      })),
      totalRow: {
        netSales: deptSales,
        grossSales: deptSales,
        quantitySold: Math.floor(quantitySold * share),
        receiptCount: Math.floor(receiptCount * share),
      },
    };
  });

  return {
    businessDate: dateStr,
    total: { hourly, totalRow },
    byDepartment,
    byProduct: {}, // empty for simplicity
  };
}

function main() {
  const endDate = process.argv[2] || '2026-04-15';
  const storeId = process.argv[3] || '1001';
  const numDays = parseInt(process.argv[4], 10) || 90;

  const dbPath = path.join(__dirname, '..', 'data', 'sales.db');
  const db = new Database(dbPath);
  const stmt = db.prepare(
    'INSERT INTO reports (store_id, business_date, data, is_final) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(store_id, business_date) DO UPDATE SET data = excluded.data, created_at = datetime(\'now\'), is_final = excluded.is_final'
  );

  const insertMany = db.transaction((items) => {
    for (const item of items) stmt.run(item.storeId, item.businessDate, JSON.stringify(item.data), 1);
  });

  const items = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const dateStr = addDays(endDate, -i);
    const report = generateReportForDate(dateStr, storeId);
    items.push({ storeId, businessDate: dateStr, data: report });
  }

  insertMany(items);

  console.log(`Seeded ${numDays} days of test data for store ${storeId} from ${addDays(endDate, -(numDays - 1))} to ${endDate}`);

  // Verify
  const count = db.prepare('SELECT COUNT(*) as c FROM reports WHERE store_id = ?').get(storeId);
  console.log(`Total reports for store ${storeId}:`, count.c);
  db.close();
}

main();
