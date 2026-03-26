const fs = require('fs');
const XLSX = require('xlsx');

const INPUT = 'Item Sales (2).xlsx';
const OUTPUT = 'item_sales_2_importable.csv';
const BUSINESS_DATE = '2026-03-16';
const STORE_ID = '1001';
const START_TIME = '10:00';
const END_TIME = '11:00';

function mapCategoryToDepartmentCode(categoryCode) {
  const s = String(categoryCode == null ? '' : categoryCode).trim();
  if (!s) return '01';
  const first = s[0];
  if (first === '1') return '01'; // Grocery
  if (first === '2') return '02'; // Fruit & Vegetable
  if (first === '3') return '03'; // Fish & Seafood
  if (first === '4') return '04'; // Meat
  if (first === '5') return '05'; // Delicatessen
  if (first === '6') return '06'; // Store Management
  return '01';
}

function toNum(v) {
  const n = Number(String(v == null ? '' : v).replace(/,/g, '').trim() || '0');
  return Number.isFinite(n) ? n : 0;
}

function csvEscape(s) {
  const text = String(s == null ? '' : s);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const wb = XLSX.readFile(INPUT);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
if (!rows.length) throw new Error('No rows found in input workbook.');

const header = rows[0].map((v) => String(v).trim());
const idx = (name) => header.findIndex((h) => h === name);

const iNo = idx('No.');
const iDesc = idx('Description');
const iQty = idx('Qty. Sold (POS)');
const iGross = idx('Gross Sales (POS)');
const iNet = idx('Sales Amount (POS)');
const iCategory = idx('Item Category Code');

if ([iNo, iDesc, iQty, iGross, iNet, iCategory].some((i) => i < 0)) {
  throw new Error('Required columns are missing in Item Sales sheet.');
}

const products = [];
let totalNet = 0;
let totalGross = 0;
let totalQty = 0;
const deptAgg = new Map();

for (let r = 1; r < rows.length; r++) {
  const row = rows[r] || [];
  const code = String(row[iNo] || '').trim();
  const name = String(row[iDesc] || '').trim();
  const categoryCode = String(row[iCategory] || '').trim();
  const departmentCode = mapCategoryToDepartmentCode(categoryCode);
  const qty = toNum(row[iQty]);
  const gross = toNum(row[iGross]);
  const net = toNum(row[iNet]);
  if (!code || !name) continue;
  if (net === 0 && gross === 0 && qty === 0) continue;

  products.push({ code, name, qty, gross, net, categoryCode, departmentCode });
  totalNet += net;
  totalGross += gross;
  totalQty += qty;
  if (!deptAgg.has(departmentCode)) {
    deptAgg.set(departmentCode, { net: 0, gross: 0, qty: 0 });
  }
  const agg = deptAgg.get(departmentCode);
  agg.net += net;
  agg.gross += gross;
  agg.qty += qty;
}

const lines = [];
lines.push('Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count,Item_Code,Item_Name');
lines.push([BUSINESS_DATE, STORE_ID, '00', '', '', totalNet.toFixed(2), totalGross.toFixed(2), totalQty.toFixed(2), '0', '', ''].join(','));
lines.push([BUSINESS_DATE, STORE_ID, '00', START_TIME, END_TIME, totalNet.toFixed(2), totalGross.toFixed(2), totalQty.toFixed(2), '0', '', ''].join(','));
for (const deptCode of ['01', '02', '03', '04', '05', '06']) {
  const agg = deptAgg.get(deptCode);
  if (!agg) continue;
  lines.push([
    BUSINESS_DATE,
    STORE_ID,
    deptCode,
    START_TIME,
    END_TIME,
    agg.net.toFixed(2),
    agg.gross.toFixed(2),
    agg.qty.toFixed(2),
    '0',
    '',
    '',
  ].join(','));
}

for (const p of products) {
  lines.push([
    BUSINESS_DATE,
    STORE_ID,
    p.departmentCode,
    START_TIME,
    END_TIME,
    p.net.toFixed(2),
    p.gross.toFixed(2),
    p.qty.toFixed(2),
    '0',
    csvEscape(p.code),
    csvEscape(p.name),
  ].join(','));
}

fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
console.log(JSON.stringify({
  output: OUTPUT,
  products: products.length,
  departments: Array.from(deptAgg.keys()).sort(),
  rows: lines.length - 1,
  totalNet: Number(totalNet.toFixed(2)),
  totalGross: Number(totalGross.toFixed(2)),
  totalQty: Number(totalQty.toFixed(2)),
}, null, 2));
