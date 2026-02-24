'use strict';

const XLSX = require('xlsx');

const COL = {
  Start_Time: 0,
  End_Time: 1,
  BusinessDate: 2,
  HourlyReceiptCount: 7,
  HourlyGrossSales: 8,
  HourlyNetSales: 9,
  HourlyQuantitySold: 10,
  Department_Name: 13,
  NetSales: 14,
  QuantitySold: 15,
  TotalReceiptCount: 17,
  TotalGrossSales: 18,
  TotalNetSales: 19,
  TotalQuantitySold: 20,
};

const DEPARTMENTS = [
  'Grocery',
  'Fruit & Vegetable',
  'Fish & Seafood',
  'Meat',
  'Delicatessen',
  'Store Management',
];

function toNum(v) {
  if (v === null || v === undefined || v === '' || v === 'NULL') return null;
  if (typeof v === 'number' && !isNaN(v)) return v;
  const s = String(v).trim().replace(/,/g, '');
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** Parse BusinessDate from Excel (serial number or string) to YYYY-MM-DD. */
function parseBusinessDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && !isNaN(v)) {
    const serial = Math.floor(v);
    const d = new Date((serial - 25569) * 86400 * 1000);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  const s = String(v).trim();
  const matchYMD = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matchYMD) return matchYMD[1] + '-' + matchYMD[2] + '-' + matchYMD[3];
  const matchDMY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (matchDMY) return matchDMY[3] + '-' + matchDMY[2].padStart(2, '0') + '-' + matchDMY[1].padStart(2, '0');
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** Find column index for Business Date from header row (row 0). */
function findBusinessDateColumn(headerRow) {
  if (!headerRow || !Array.isArray(headerRow)) return COL.BusinessDate;
  const lower = (x) => (x == null ? '' : String(x).toLowerCase());
  for (let i = 0; i < headerRow.length; i++) {
    const cell = lower(headerRow[i]);
    if (cell.includes('business') && cell.includes('date')) return i;
  }
  return COL.BusinessDate;
}

function formatTimeRange(start, end) {
  const s = start != null ? String(start).trim() : '';
  const e = end != null ? String(end).trim() : '';
  if (s && e) return s + ' - ' + e;
  return s || e || '';
}

const TIME_ORDER = [
  '00:00-01:00', '01:00-02:00', '02:00-03:00', '03:00-04:00', '04:00-05:00',
  '05:00-06:00', '06:00-07:00', '07:00-08:00', '08:00-09:00', '09:00-10:00',
  '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00',
  '15:00-16:00', '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00',
  '20:00-21:00', '21:00-22:00', '22:00-23:00', '23:00-00:00',
];

function sortByTimeKey(a, b) {
  const ai = TIME_ORDER.indexOf(a.timeKey);
  const bi = TIME_ORDER.indexOf(b.timeKey);
  if (ai !== -1 && bi !== -1) return ai - bi;
  return (a.timeKey || '').localeCompare(b.timeKey || '');
}

/**
 * Parse LS-Central "Daily Sales Report (Hourly Sales by Department)" Excel buffer.
 * Returns { total: { hourly, totalRow }, byDepartment: { [name]: { hourly } } } or null.
 */
function parseSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets['Data'] || workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return null;

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
  if (!rows.length) return null;

  const businessDateCol = findBusinessDateColumn(rows[0]);

  const total = { hourly: [], totalRow: null };
  const byDept = {};
  DEPARTMENTS.forEach((d) => {
    byDept[d] = { hourly: [] };
  });

  let businessDate = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (businessDate == null && row[businessDateCol] != null && String(row[businessDateCol]).trim() !== '') {
      businessDate = parseBusinessDate(row[businessDateCol]);
    }
    const startTime = row[COL.Start_Time];
    const endTime = row[COL.End_Time];

    if (startTime === null || startTime === undefined || startTime === 'NULL' || String(startTime).trim() === '') {
      if (row[COL.TotalReceiptCount] != null && toNum(row[COL.TotalReceiptCount]) != null) {
        total.totalRow = {
          receiptCount: toNum(row[COL.TotalReceiptCount]),
          grossSales: toNum(row[COL.TotalGrossSales]),
          netSales: toNum(row[COL.TotalNetSales]),
          quantitySold: toNum(row[COL.TotalQuantitySold]),
        };
      }
      continue;
    }

    let gross = toNum(row[COL.HourlyGrossSales]);
    let net = toNum(row[COL.HourlyNetSales]);
    let receiptCount = toNum(row[COL.HourlyReceiptCount]);
    let qty = toNum(row[COL.HourlyQuantitySold]);
    if (gross == null) gross = 0;
    if (net == null) net = 0;
    if (receiptCount == null) receiptCount = 0;
    if (qty == null) qty = 0;

    const timeKey = String(startTime).trim() + '-' + String(endTime).trim();
    const existingTotal = total.hourly.find((h) => h.timeKey === timeKey);
    if (!existingTotal) {
      total.hourly.push({
        timeKey,
        timeLabel: formatTimeRange(startTime, endTime),
        grossSales: gross,
        netSales: net,
        receiptCount,
        quantitySold: qty,
      });
    }

    const deptName = row[COL.Department_Name];
    if (deptName && byDept[deptName]) {
      const deptNet = toNum(row[COL.NetSales]) || 0;
      const deptQty = toNum(row[COL.QuantitySold]) || 0;
      byDept[deptName].hourly.push({
        timeKey,
        timeLabel: formatTimeRange(startTime, endTime),
        grossSales: null,
        netSales: deptNet,
        receiptCount,
        quantitySold: deptQty,
      });
    }
  }

  total.hourly.sort(sortByTimeKey);
  Object.keys(byDept).forEach((k) => {
    byDept[k].hourly.sort(sortByTimeKey);
  });

  return { businessDate, total, byDepartment: byDept };
}

module.exports = { parseSheet };
