/**
 * Generate synthetic Item Sales test data and import it via the production
 * parser path (parseItemSalesExcel → saveReport).
 *
 * Usage:
 *   node scripts/generate-test-item-sales.js [businessDate] [storeId]
 *
 * Defaults: businessDate = today (YYYY-MM-DD), storeId = 'default'.
 *
 * Picks ~5 real items per department from the existing product master,
 * synthesises plausible quantity/sales numbers, writes an LS-Central style
 * "Item Sales" .xlsx into samples/, then imports it and prints a summary.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parseItemSalesExcel } = require('../parser');
const db = require('../db');

const businessDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const storeId = process.argv[3] || 'default';
const ITEMS_PER_DEPT = 5;

// Deterministic pseudo-random so reruns with same date give same numbers.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

(async () => {
  const master = await db.getProductMaster();
  if (!master || Object.keys(master).length === 0) {
    console.error('Product master is empty. Import a master first.');
    process.exit(1);
  }

  // Bucket master items by first digit of group code (= department).
  const buckets = {};
  Object.entries(master).forEach(([itemNo, v]) => {
    const groupCode = v.groupCode || '';
    const d = groupCode.charAt(0);
    if (!d || !'123456'.includes(d)) return;
    // Prefer items with realistic master cost+price so the export looks meaningful.
    if (!v.unitPrice || !v.unitCost) return;
    if (!buckets[d]) buckets[d] = [];
    buckets[d].push({ itemNo, ...v });
  });

  // Seed per businessDate so repeated runs are stable.
  const seed = businessDate.split('-').reduce((a, b) => a + Number(b), 0);
  const rand = mulberry32(seed * 1000 + 7);

  const picks = [];
  ['1', '2', '3', '4', '5', '6'].forEach((d) => {
    const pool = buckets[d] || [];
    for (let i = 0; i < Math.min(ITEMS_PER_DEPT, pool.length); i++) {
      // Sample without replacement.
      const idx = Math.floor(rand() * pool.length);
      const [picked] = pool.splice(idx, 1);
      if (picked) picks.push(picked);
    }
  });

  if (picks.length === 0) {
    console.error('Could not pick any items. Check master coverage.');
    process.exit(1);
  }

  // Build Item Sales rows in LS-Central style.
  // Headers parseItemSalesExcel recognises (case-insensitive contains match):
  //   No., Description, Qty.Sold(POS), Gross Sales(POS),
  //   Sales Amount(POS), Disc.Amount(POS), VAT(POS),
  //   Retail Product Code, Item Family Code, Item Category Code
  const header = [
    'No.', 'Description',
    'Qty.Sold(POS)', 'Gross Sales(POS)', 'Sales Amount(POS)',
    'Disc.Amount(POS)', 'VAT(POS)',
    'Retail Product Code', 'Item Category Code',
  ];

  const aoa = [header];
  let totalNet = 0;
  picks.forEach((item) => {
    // Synthesise qty: scale by department to mimic real distribution.
    const dept = item.groupCode.charAt(0);
    const baseQty = { '1': 60, '2': 30, '3': 15, '4': 20, '5': 25, '6': 80 }[dept] || 10;
    const qty = Math.max(1, Math.round(baseQty * (0.5 + rand())));

    const unitPrice = item.unitPrice || 10;
    // Apply small discount on ~30% of items.
    const discPct = rand() < 0.3 ? Math.round(rand() * 15) : 0;
    const grossSales = qty * unitPrice;
    const discAmount = Math.round(grossSales * discPct / 100);
    const netSalesExclVat = Math.round((grossSales - discAmount) / 1.07); // VAT 7% inclusive → exclusive
    const vatAmount = (grossSales - discAmount) - netSalesExclVat;

    totalNet += netSalesExclVat;
    aoa.push([
      item.itemNo,
      item.nameEng || item.itemNo,
      qty,
      grossSales,
      netSalesExclVat,
      discAmount,
      vatAmount,
      item.groupCode,           // Retail Product Code
      item.groupCode,           // Item Category Code (first digit determines dept)
    ]);
  });

  // Write xlsx into samples/ for traceability.
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Item Sales');
  const outPath = path.join(__dirname, '..', 'samples', `test_item_sales_${businessDate}.xlsx`);
  XLSX.writeFile(wb, outPath);
  console.log(`Wrote ${aoa.length - 1} rows → ${outPath}`);

  // Re-read the file as a Buffer and import via the production parser path.
  const buf = fs.readFileSync(outPath);
  const parsed = parseItemSalesExcel(buf, businessDate, storeId);
  if (!parsed || !parsed.byProduct) {
    console.error('parseItemSalesExcel returned no byProduct. Header detection failed?');
    process.exit(1);
  }
  console.log(`Parsed: ${Object.keys(parsed.byProduct).length} products, total net = ${parsed.total.totalRow.netSales}`);

  // Merge with existing report on this date if any (preserves hourly data).
  const existing = await db.getReport(businessDate, storeId);
  let merged;
  if (existing) {
    merged = Object.assign({}, existing, {
      byProduct: parsed.byProduct,
      _updatedAt: undefined,
      _isFinal: undefined,
    });
    console.log(`Merged into existing report for ${businessDate}.`);
  } else {
    merged = parsed;
    console.log(`Created new report for ${businessDate}.`);
  }

  await db.saveReport(businessDate, merged, storeId, false);
  console.log(`Saved. Synthetic grand total (net excl. VAT): ${totalNet} THB`);
  console.log(`Verify: GET /api/products/export?storeId=${storeId}&dateFrom=${businessDate}`);
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
