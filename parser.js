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

/** Find column index for Store from header row (row 0). Returns -1 if not found. */
function findStoreColumn(headerRow) {
  if (!headerRow || !Array.isArray(headerRow)) return -1;
  const lower = (x) => (x == null ? '' : String(x).toLowerCase().trim());
  for (let i = 0; i < headerRow.length; i++) {
    const cell = lower(headerRow[i]);
    if (cell === 'store' || cell === 'store name' || cell === 'store name 2' || cell === '店舗' || cell === 'location' || (cell.includes('store') && !cell.includes('management'))) return i;
  }
  return -1;
}

/** Find column index by header: first column where cell (lowercased) includes any of the patterns and none of the exclude patterns. Returns -1 if not found. */
function findExcelColumn(headerRow, patterns, exclude) {
  if (!headerRow || !Array.isArray(headerRow) || !patterns || !patterns.length) return -1;
  const lower = (x) => (x == null ? '' : String(x).toLowerCase().trim());
  for (let i = 0; i < headerRow.length; i++) {
    const cell = lower(headerRow[i]);
    if (exclude && exclude.some((e) => cell.includes(e))) continue;
    for (const p of patterns) {
      if (cell.includes(p) || cell === p) return i;
    }
  }
  return -1;
}

/** Resolve Excel column indices from header row; fall back to COL defaults when not found. */
function resolveExcelColumns(headerRow) {
  const idx = (patterns, defaultVal, exclude) => {
    const i = findExcelColumn(headerRow, patterns, exclude);
    return i >= 0 ? i : defaultVal;
  };
  return {
    startTime: idx(['start time', 'start_time'], COL.Start_Time),
    endTime: idx(['end time', 'end_time'], COL.End_Time),
    businessDate: findBusinessDateColumn(headerRow),
    storeCol: findStoreColumn(headerRow),
    hourlyReceiptCount: idx(['hourly receipt', 'receipt count'], COL.HourlyReceiptCount),
    hourlyGrossSales: idx(['hourly gross', 'gross sales'], COL.HourlyGrossSales),
    hourlyNetSales: idx(['hourly net', 'net sales'], COL.HourlyNetSales),
    hourlyQuantitySold: idx(['hourly quantity', 'quantity sold'], COL.HourlyQuantitySold),
    departmentName: (() => {
      const a = findExcelColumn(headerRow, ['department_name', 'department name', '部門名']);
      if (a >= 0) return a;
      const b = findExcelColumn(headerRow, ['department', '部門', 'dept'], ['code']);
      return b >= 0 ? b : COL.Department_Name;
    })(),
    netSales: idx(['net sales'], COL.NetSales, ['hourly', 'total']),
    quantitySold: idx(['quantity sold'], COL.QuantitySold, ['hourly', 'total']),
    totalReceiptCount: idx(['total receipt'], COL.TotalReceiptCount),
    totalGrossSales: idx(['total gross'], COL.TotalGrossSales),
    totalNetSales: idx(['total net'], COL.TotalNetSales),
    totalQuantitySold: idx(['total quantity'], COL.TotalQuantitySold),
  };
}

/** True if value looks like a time (e.g. 10:00, 9:30). Avoids treating date/store as time. */
function isTimeLike(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s) || /^\d{1,2}:\d{2}\s*[aApP]?[mM]?$/.test(s);
}

/** Slugify store name for use as storeId (lowercase, spaces to hyphen, alphanumeric + hyphen). */
function slugifyStoreId(name) {
  if (name == null || String(name).trim() === '') return 'default';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'default';
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

  const headerRow = rows[0];
  const c = resolveExcelColumns(headerRow);

  const total = { hourly: [], totalRow: null };
  const byDept = {};
  DEPARTMENTS.forEach((d) => {
    byDept[d] = { hourly: [] };
  });

  let businessDate = null;
  let storeName = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (businessDate == null && row[c.businessDate] != null && String(row[c.businessDate]).trim() !== '') {
      businessDate = parseBusinessDate(row[c.businessDate]);
    }
    if (storeName == null && c.storeCol >= 0 && row[c.storeCol] != null && String(row[c.storeCol]).trim() !== '') {
      storeName = String(row[c.storeCol]).trim();
    }
    const startTime = row[c.startTime];
    const endTime = row[c.endTime];
    const startStr = startTime != null ? String(startTime).trim() : '';
    const endStr = endTime != null ? String(endTime).trim() : '';
    const isEmpty = !startStr && !endStr;
    const isTimeLikeRow = isTimeLike(startTime) && isTimeLike(endTime);

    if (isEmpty || !isTimeLikeRow) {
      const hasTotalReceipt = row[c.totalReceiptCount] != null && toNum(row[c.totalReceiptCount]) != null;
      if ((isEmpty || hasTotalReceipt) && hasTotalReceipt) {
        total.totalRow = {
          receiptCount: toNum(row[c.totalReceiptCount]),
          grossSales: toNum(row[c.totalGrossSales]),
          netSales: toNum(row[c.totalNetSales]),
          quantitySold: toNum(row[c.totalQuantitySold]),
        };
      }
      continue;
    }

    let gross = toNum(row[c.hourlyGrossSales]);
    let net = toNum(row[c.hourlyNetSales]);
    let receiptCount = toNum(row[c.hourlyReceiptCount]);
    let qty = toNum(row[c.hourlyQuantitySold]);
    if (gross == null) gross = 0;
    if (net == null) net = 0;
    if (receiptCount == null) receiptCount = 0;
    if (qty == null) qty = 0;

    const timeKey = startStr + '-' + endStr;
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

    const deptName = row[c.departmentName];
    if (deptName && byDept[deptName]) {
      const deptNet = toNum(row[c.netSales]) || 0;
      const deptQty = toNum(row[c.quantitySold]) || 0;
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

  const storeId = storeName ? slugifyStoreId(storeName) : 'default';
  return {
    businessDate,
    storeId: storeId || 'default',
    storeName: storeName || 'Default',
    total,
    byDepartment: byDept,
  };
}

/**
 * Department code (CSV) to name (app display).
 */
const DEPARTMENT_CODE_TO_NAME = {
  '01': 'Grocery',
  '02': 'Fruit & Vegetable',
  '03': 'Fish & Seafood',
  '04': 'Meat',
  '05': 'Delicatessen',
  '06': 'Store Management',
};

/**
 * Parse CSV in agreed format. Returns same shape as parseSheet():
 * { businessDate, storeId, storeName, total: { hourly, totalRow }, byDepartment }.
 * Header (column order): Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count
 */
function parseCsv(buffer) {
  const text = (buffer instanceof Buffer ? buffer.toString('utf8') : String(buffer))
    .replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine);
  const col = (name) => {
    const i = headers.findIndex((h) => (h || '').trim().toLowerCase() === name.toLowerCase());
    return i >= 0 ? i : -1;
  };
  const iDate = col('Business_Date');
  const iStore = col('Store_Id');
  const iStart = col('Start_Time');
  const iEnd = col('End_Time');
  const iDept = col('Department_Code');
  const iNet = col('Net_Sales');
  const iGross = col('Gross_Sales');
  const iQty = col('Quantity_Sold');
  const iReceipt = col('Receipt_Count');
  if (iDate < 0 || iStore < 0 || iDept < 0 || iNet < 0 || iQty < 0 || iReceipt < 0) return null;

  let businessDate = null;
  let storeId = '1001';
  const total = { hourly: [], totalRow: null };
  const byDept = {};
  DEPARTMENTS.forEach((d) => {
    byDept[d] = { hourly: [] };
  });
  const slotTotals = new Map();
  const hourlyTotalRows = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (idx) => (idx >= 0 && cells[idx] !== undefined ? String(cells[idx]).trim() : '');
    const getNum = (idx) => toNum(idx >= 0 ? cells[idx] : null);

    const startTime = get(iStart);
    const endTime = get(iEnd);
    const deptCode = get(iDept);

    if (!businessDate && get(iDate)) businessDate = parseBusinessDate(get(iDate)) || get(iDate);
    if (get(iStore)) storeId = String(get(iStore)).trim() || '1001';

    if (!startTime && !endTime) {
      if (deptCode === '00' || deptCode === '') {
        total.totalRow = {
          netSales: getNum(iNet),
          grossSales: getNum(iGross),
          quantitySold: getNum(iQty),
          receiptCount: getNum(iReceipt),
        };
      }
      continue;
    }

    const timeKey = startTime + '-' + endTime;
    const timeLabel = formatTimeRange(startTime, endTime);
    const netSales = getNum(iNet) || 0;
    const grossSales = getNum(iGross);
    const quantitySold = getNum(iQty) || 0;
    const receiptCount = getNum(iReceipt) || 0;

    if (deptCode === '00') {
      hourlyTotalRows.push({
        timeKey,
        timeLabel,
        grossSales: grossSales != null ? grossSales : null,
        netSales,
        quantitySold,
        receiptCount,
      });
      continue;
    }

    const deptName = DEPARTMENT_CODE_TO_NAME[deptCode];
    if (deptName && byDept[deptName]) {
      byDept[deptName].hourly.push({
        timeKey,
        timeLabel,
        grossSales: grossSales != null ? grossSales : null,
        netSales,
        quantitySold,
        receiptCount: null,
      });
      if (!slotTotals.has(timeKey)) {
        slotTotals.set(timeKey, { netSales: 0, quantitySold: 0, receiptCount, timeLabel });
      }
      const agg = slotTotals.get(timeKey);
      agg.netSales += netSales;
      agg.quantitySold += quantitySold;
    }
  }

  if (hourlyTotalRows.length > 0) {
    total.hourly = hourlyTotalRows;
  } else {
    slotTotals.forEach((agg, timeKey) => {
      total.hourly.push({
        timeKey,
        timeLabel: agg.timeLabel,
        grossSales: null,
        netSales: agg.netSales,
        quantitySold: agg.quantitySold,
        receiptCount: agg.receiptCount,
      });
    });
  }

  total.hourly.sort(sortByTimeKey);
  Object.keys(byDept).forEach((k) => {
    byDept[k].hourly.sort(sortByTimeKey);
  });

  return {
    businessDate: businessDate || '',
    storeId: storeId || '1001',
    storeName: storeId,
    total,
    byDepartment: byDept,
  };
}

function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let s = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          i++;
          if (line[i] === '"') {
            s += '"';
            i++;
          } else break;
        } else {
          s += line[i];
          i++;
        }
      }
      out.push(s);
    } else {
      let s = '';
      while (i < line.length && line[i] !== ',') {
        s += line[i];
        i++;
      }
      out.push(s.trim());
      if (i < line.length) i++;
    }
  }
  return out;
}

module.exports = { parseSheet, parseCsv };
