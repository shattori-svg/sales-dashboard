'use strict';

/**
 * Reads "Daily Sales Report (Hourly Sales by Department)" Excel and outputs
 * CSV in the agreed format:
 * Business_Date, Store_Id, Start_Time, End_Time, Department_Code, Net_Sales, Gross_Sales, Quantity_Sold, Receipt_Count
 * - Department_Code 00 = day total row (only row with empty Start_Time/End_Time)
 * - 01-06 = department (Grocery, Fruit & Vegetable, Fish & Seafood, Meat, Delicatessen, Store Management)
 * - No hourly Total rows; store totals are derived from department sums.
 */

const fs = require('fs');
const path = require('path');
const { parseSheet } = require('../parser');

const DEPARTMENT_NAME_TO_CODE = {
  'Grocery': '01',
  'Fruit & Vegetable': '02',
  'Fish & Seafood': '03',
  'Meat': '04',
  'Delicatessen': '05',
  'Store Management': '06',
};

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function run(inputPath, outputPath) {
  const absIn = path.resolve(inputPath);
  if (!fs.existsSync(absIn)) {
    console.error('File not found:', absIn);
    process.exit(1);
  }

  const buffer = fs.readFileSync(absIn);
  const data = parseSheet(buffer);
  if (!data || !data.total) {
    console.error('Could not parse Excel or no data found.');
    process.exit(1);
  }

  const storeId = (data.storeId && String(data.storeId).trim()) || '1001';
  const businessDate = data.businessDate || '';

  const rows = [];
  rows.push('Business_Date,Store_Id,Start_Time,End_Time,Department_Code,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count');

  // 1) Day total row (Department_Code 00)
  const tr = data.total.totalRow;
  if (tr) {
    rows.push([
      escapeCsv(businessDate),
      escapeCsv(storeId),
      '',
      '',
      '00',
      escapeCsv(tr.netSales),
      escapeCsv(tr.grossSales),
      escapeCsv(tr.quantitySold),
      escapeCsv(tr.receiptCount),
    ].join(','));
  }

  // 2) Hourly department rows (01-06). One row per (timeSlot, department).
  const byDept = data.byDepartment || {};
  for (const [deptName, code] of Object.entries(DEPARTMENT_NAME_TO_CODE)) {
    const deptData = byDept[deptName];
    if (!deptData || !deptData.hourly || !deptData.hourly.length) continue;
    for (const h of deptData.hourly) {
      const [startTime = '', endTime = ''] = (h.timeKey || '').split('-');
      rows.push([
        escapeCsv(businessDate),
        escapeCsv(storeId),
        escapeCsv(startTime.trim()),
        escapeCsv(endTime.trim()),
        code,
        escapeCsv(h.netSales),
        escapeCsv(h.grossSales != null ? h.grossSales : ''),
        escapeCsv(h.quantitySold),
        escapeCsv(h.receiptCount),
      ].join(','));
    }
  }

  const out = rows.join('\r\n') + '\r\n';
  const outAbs = outputPath ? path.resolve(outputPath) : path.join(path.dirname(absIn), path.basename(absIn, '.xlsx') + '.csv');
  fs.writeFileSync(outAbs, '\uFEFF' + out, 'utf8'); // BOM for Excel
  console.log('Written:', outAbs);
  console.log('Rows:', rows.length - 1);
}

const input = process.argv[2] || path.join(__dirname, '..', 'Daily Sales Report (Hourly Sales by Department) (34).xlsx');
const output = process.argv[3];
run(input, output);
