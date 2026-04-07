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
    itemCode: findExcelColumn(headerRow, ['item_code', 'item code', 'barcode', 'sku']),
    itemName: findExcelColumn(headerRow, ['item_name', 'item name', '商品名']),
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

/** Normalize time from CSV: 4-digit (e.g. 0000, 0100, 1000) -> HH:00 for timeKey/display. */
function normalizeTimeForCsv(t) {
  if (t == null || t === '') return '';
  const s = String(t).trim();
  if (/^\d{4}$/.test(s)) {
    const h = s.slice(0, 2);
    const m = s.slice(2, 4);
    return h + ':' + (m === '00' ? '00' : m);
  }
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  return s;
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
  const byProduct = {};
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
      // 日別商品行（時間なし + Item_Code あり）
      if (isEmpty && c.itemCode >= 0) {
        const itemCode = row[c.itemCode] != null ? String(row[c.itemCode]).trim() : '';
        const itemName = c.itemName >= 0 && row[c.itemName] != null ? String(row[c.itemName]).trim() : '';
        const deptName = row[c.departmentName];
        if (itemCode && deptName) {
          if (!byProduct[itemCode]) {
            byProduct[itemCode] = { itemCode, itemName, departmentCode: '', departmentName: deptName, totalNetSales: 0, totalQuantitySold: 0 };
          }
          byProduct[itemCode].totalNetSales += toNum(row[c.totalNetSales]) || 0;
          byProduct[itemCode].totalQuantitySold += toNum(row[c.totalQuantitySold]) || 0;
        }
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
    const itemCode = c.itemCode >= 0 && row[c.itemCode] != null ? String(row[c.itemCode]).trim() : '';
    const itemName = c.itemName >= 0 && row[c.itemName] != null ? String(row[c.itemName]).trim() : '';

    if (itemCode && deptName) {
      // 商品行: byProduct にのみ書き込む（byDepartment には加算しない）
      const deptNet = toNum(row[c.netSales]) || 0;
      const deptQty = toNum(row[c.quantitySold]) || 0;
      if (!byProduct[itemCode]) {
        byProduct[itemCode] = { itemCode, itemName, departmentCode: '', departmentName: deptName, totalNetSales: 0, totalQuantitySold: 0 };
      }
      byProduct[itemCode].totalNetSales += deptNet;
      byProduct[itemCode].totalQuantitySold += deptQty;
    } else if (deptName && byDept[deptName]) {
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
    byProduct: Object.keys(byProduct).length > 0 ? byProduct : undefined,
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
 * Parse CSV in agreed format.
 * Returns an array of per-store result objects (same shape as parseSheet()), or null on failure.
 * Header (column order): Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count[,Discount_Amount,Item_Code,Cost_Amount]
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
  const iItem = col('Item_Code');
  const iItemName = col('Item_Name');
  const iDiscount = col('Discount_Amount');
  const iCost = col('Cost_Amount');
  if (iDate < 0 || iStore < 0 || iDept < 0 || iNet < 0 || iQty < 0 || iReceipt < 0) return null;

  // Accumulate results per storeId
  const storeMap = new Map(); // storeId -> store accumulator

  function getOrCreateStore(sid) {
    if (!storeMap.has(sid)) {
      const byDept = {};
      DEPARTMENTS.forEach((d) => { byDept[d] = { hourly: [] }; });
      storeMap.set(sid, {
        businessDate: null,
        storeId: sid,
        total: { hourly: [], totalRow: null },
        byDept,
        byProduct: {},
        slotTotals: new Map(),
        hourlyTotalRows: [],
      });
    }
    return storeMap.get(sid);
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (idx) => (idx >= 0 && cells[idx] !== undefined ? String(cells[idx]).trim() : '');
    const getNum = (idx) => toNum(idx >= 0 ? cells[idx] : null);

    const startRaw = get(iStart);
    const endRaw = get(iEnd);
    const deptCode = get(iDept);
    const rawStore = get(iStore);
    const sid = rawStore || '1001';
    const store = getOrCreateStore(sid);

    if (!store.businessDate && get(iDate)) store.businessDate = parseBusinessDate(get(iDate)) || get(iDate);

    if (!startRaw && !endRaw) {
      if (deptCode === '00' || deptCode === '') {
        store.total.totalRow = {
          netSales: getNum(iNet),
          grossSales: getNum(iGross),
          quantitySold: getNum(iQty),
          receiptCount: getNum(iReceipt),
          ...(iDiscount >= 0 && { discountAmount: getNum(iDiscount) }),
          ...(iCost >= 0 && { costAmount: getNum(iCost) }),
        };
      } else {
        const deptName = DEPARTMENT_CODE_TO_NAME[deptCode];
        const itemCode = iItem >= 0 ? get(iItem) : '';
        const itemName = iItemName >= 0 ? get(iItemName) : '';
        if (itemCode && deptName) {
          // 商品日計行: byProduct にのみ書き込む
          if (!store.byProduct[itemCode]) {
            store.byProduct[itemCode] = { itemCode, itemName, departmentCode: deptCode, departmentName: deptName, totalNetSales: 0, totalQuantitySold: 0 };
          }
          store.byProduct[itemCode].totalNetSales += getNum(iNet) || 0;
          store.byProduct[itemCode].totalQuantitySold += getNum(iQty) || 0;
          if (iDiscount >= 0) store.byProduct[itemCode].discountAmount = (store.byProduct[itemCode].discountAmount || 0) + (getNum(iDiscount) || 0);
          if (iCost >= 0) store.byProduct[itemCode].costAmount = (store.byProduct[itemCode].costAmount || 0) + (getNum(iCost) || 0);
        } else if (deptName && store.byDept[deptName]) {
          // 部門日計行: discountAmount / costAmount を daily に格納
          store.byDept[deptName].daily = {
            netSales: getNum(iNet),
            grossSales: getNum(iGross),
            quantitySold: getNum(iQty),
            ...(iDiscount >= 0 && { discountAmount: getNum(iDiscount) }),
            ...(iCost >= 0 && { costAmount: getNum(iCost) }),
          };
        }
      }
      continue;
    }

    const startTime = normalizeTimeForCsv(startRaw) || startRaw;
    const endTime = normalizeTimeForCsv(endRaw) || endRaw;
    const timeKey = startTime + '-' + endTime;
    const timeLabel = formatTimeRange(startTime, endTime);
    const netSales = getNum(iNet) || 0;
    const grossSales = getNum(iGross);
    const quantitySold = getNum(iQty) || 0;
    const receiptCount = getNum(iReceipt) || 0;

    if (deptCode === '00') {
      const slot = {
        timeKey,
        timeLabel,
        grossSales: grossSales != null ? grossSales : null,
        netSales,
        quantitySold,
        receiptCount,
      };
      if (iDiscount >= 0) slot.discountAmount = getNum(iDiscount);
      store.hourlyTotalRows.push(slot);
      continue;
    }

    const deptName = DEPARTMENT_CODE_TO_NAME[deptCode];
    const itemCode = iItem >= 0 ? get(iItem) : '';
    const itemName = iItemName >= 0 ? get(iItemName) : '';

    if (itemCode && deptName) {
      // 商品行（時間帯あり）: byProduct にのみ書き込む（byDepartment には加算しない）
      if (!store.byProduct[itemCode]) {
        store.byProduct[itemCode] = { itemCode, itemName, departmentCode: deptCode, departmentName: deptName, totalNetSales: 0, totalQuantitySold: 0 };
      }
      store.byProduct[itemCode].totalNetSales += netSales;
      store.byProduct[itemCode].totalQuantitySold += quantitySold;
    } else if (deptName && store.byDept[deptName]) {
      store.byDept[deptName].hourly.push({
        timeKey,
        timeLabel,
        grossSales: grossSales != null ? grossSales : null,
        netSales,
        quantitySold,
        receiptCount,
      });
      if (!store.slotTotals.has(timeKey)) {
        store.slotTotals.set(timeKey, { netSales: 0, quantitySold: 0, receiptCount, timeLabel });
      }
      const agg = store.slotTotals.get(timeKey);
      agg.netSales += netSales;
      agg.quantitySold += quantitySold;
    }
  }

  const results = [];
  for (const store of storeMap.values()) {
    const { total, byDept, byProduct, slotTotals, hourlyTotalRows } = store;
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
    Object.keys(byDept).forEach((k) => { byDept[k].hourly.sort(sortByTimeKey); });
    results.push({
      businessDate: store.businessDate || '',
      storeId: store.storeId || '1001',
      storeName: store.storeId,
      total,
      byDepartment: byDept,
      byProduct: Object.keys(byProduct).length > 0 ? byProduct : undefined,
    });
  }

  return results.length > 0 ? results : null;
}

/**
 * Parse LS-Central product master Excel (Item list export).
 * Returns a map of { [itemNo]: { barcodeNo, nameEng, nameTha, nameJpn, deptCode } }, or null.
 *
 * Expected header columns: Department Code, Barcode No., Item No.,
 *   Description (ENG), Description (THA), Description (JPN)
 *
 * @param {Buffer} buffer Excel file buffer
 * @returns {object|null}
 */
function parseProductMasterExcel(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    return null;
  }

  const sheetName = workbook.SheetNames.includes('Item')
    ? 'Item'
    : workbook.SheetNames[0];
  if (!sheetName) return null;

  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  if (!rows || rows.length < 2) return null;

  const lc = (v) => (v == null ? '' : String(v).toLowerCase().trim());
  let headerIdx = -1;
  const colMap = {};

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = row.map(lc);
    const hasBarcode = cells.some((c) => c === 'barcode no.' || c === 'barcode no');
    const hasItemNo = cells.some((c) => c === 'item no.' || c === 'item no');
    if (hasBarcode && hasItemNo) {
      headerIdx = i;
      cells.forEach((c, idx) => {
        if (c === 'department code') colMap.deptCode = idx;
        else if (c === 'barcode no.' || c === 'barcode no') colMap.barcodeNo = idx;
        else if (c === 'item no.' || c === 'item no') colMap.itemNo = idx;
        else if (c === 'description (eng)') colMap.nameEng = idx;
        else if (c === 'description (tha)') colMap.nameTha = idx;
        else if (c === 'description (jpn)') colMap.nameJpn = idx;
        else if (c === 'retail product group code' || c === 'product group code' || c === 'item group code') colMap.groupCode = idx;
      });
      break;
    }
  }

  if (headerIdx < 0 || colMap.itemNo == null || colMap.barcodeNo == null) return null;

  const master = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const itemNo = row[colMap.itemNo] != null ? String(row[colMap.itemNo]).trim() : '';
    if (!itemNo) continue;
    master[itemNo] = {
      barcodeNo: colMap.barcodeNo != null && row[colMap.barcodeNo] != null ? String(row[colMap.barcodeNo]).trim() : '',
      nameEng: colMap.nameEng != null && row[colMap.nameEng] != null ? String(row[colMap.nameEng]).trim() : '',
      nameTha: colMap.nameTha != null && row[colMap.nameTha] != null ? String(row[colMap.nameTha]).trim() : '',
      nameJpn: colMap.nameJpn != null && row[colMap.nameJpn] != null ? String(row[colMap.nameJpn]).trim() : '',
      deptCode: colMap.deptCode != null && row[colMap.deptCode] != null ? String(row[colMap.deptCode]).trim() : '',
      groupCode: colMap.groupCode != null && row[colMap.groupCode] != null ? String(row[colMap.groupCode]).trim() : '',
    };
  }

  return Object.keys(master).length > 0 ? master : null;
}

/**
 * Parse LS-Central classification master Excel files.
 * Auto-detects file type (Retail Class / Divisions / Item Categories / Product Groups)
 * based on column headers and assigns the correct level and parent_code.
 *
 * Level hierarchy:
 *   1 = Retail Class List     (no parent column)
 *   2 = Divisions             (Retail Class Code → parent)
 *   3 = Retail Item Categories (Division Code → parent)
 *   4 = Retail Product Groups  (Item Category Code → parent)
 *
 * @param {Buffer} buffer Excel file buffer
 * @returns {{ rows: object[], level: number }|null}
 */
function parseClassificationExcel(buffer) {
  let wb;
  try { wb = XLSX.read(buffer, { type: 'buffer' }); } catch (e) { return null; }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return null;
  const ws = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!rawRows || rawRows.length < 2) return null;

  const lc = (v) => (v == null ? '' : String(v).toLowerCase().trim());
  const headers = rawRows[0].map(lc);
  const col = (name) => headers.indexOf(name);

  const iCode    = col('code');
  const iDesc    = col('description');
  const iDescTha = col('description (tha)');
  const iDescJpn = col('description (jpn)');
  if (iCode < 0 || iDesc < 0) return null;

  // Detect level by unique parent-reference column
  const iItemCategoryCode = col('item category code'); // Product Groups → level 4
  const iDivisionCode     = col('division code');      // Item Categories → level 3
  const iRetailClassCode  = col('retail class code');  // Divisions → level 2
  // Retail Class List has none of the above → level 1

  let level, parentColIdx;
  if (iItemCategoryCode >= 0) {
    level = 4; parentColIdx = iItemCategoryCode;
  } else if (iDivisionCode >= 0) {
    level = 3; parentColIdx = iDivisionCode;
  } else if (iRetailClassCode >= 0) {
    level = 2; parentColIdx = iRetailClassCode;
  } else {
    level = 1; parentColIdx = -1;
  }

  const rows = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row) continue;
    const code = row[iCode] != null ? String(row[iCode]).trim() : '';
    if (!code) continue;
    const parentCode = parentColIdx >= 0 && row[parentColIdx] != null
      ? String(row[parentColIdx]).trim() || null
      : null;
    rows.push({
      code,
      description:     iDesc    >= 0 && row[iDesc]    != null ? String(row[iDesc]).trim()    : '',
      description_tha: iDescTha >= 0 && row[iDescTha] != null ? String(row[iDescTha]).trim() : '',
      description_jpn: iDescJpn >= 0 && row[iDescJpn] != null ? String(row[iDescJpn]).trim() : '',
      parent_code: parentCode,
      level,
    });
  }

  return rows.length > 0 ? { rows, level } : null;
}

/**
 * Parse LS-Central "Item Sales" Excel report.
 * No date column in file — businessDate and storeId must be supplied by caller.
 * Returns a partial report object (byProduct + byDepartment daily totals + total.totalRow).
 * No hourly data is produced.
 *
 * Column layout (auto-detected via header row):
 *   No., Description, Qty.Sold(POS), Gross Sales(POS), Sales Amount(POS), Disc.Amount(POS), Item Category Code
 *
 * Department mapping via first digit of Item Category Code:
 *   1 → Grocery, 2 → Fruit & Vegetable, 3 → Fish & Seafood,
 *   4 → Meat, 5 → Delicatessen, 6 → Store Management
 *
 * @param {Buffer} buffer        Excel file buffer
 * @param {string} businessDate  YYYY-MM-DD
 * @param {string} storeId       Store ID (e.g. '1001')
 * @returns {object|null}
 */
function parseItemSalesExcel(buffer, businessDate, storeId) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    return null;
  }

  const sheetName = workbook.SheetNames.includes('Item Sales')
    ? 'Item Sales'
    : workbook.SheetNames[0];
  if (!sheetName) return null;

  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (!rows || rows.length < 2) return null;

  // Locate header row (scan first 10 rows)
  const lc = (v) => (v == null ? '' : String(v).toLowerCase().trim());
  let headerIdx = -1;
  const colMap = {};

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = row.map(lc);
    const hasNo = cells.some((c) => c === 'no.');
    const hasDesc = cells.some((c) => c === 'description');
    const hasCat = cells.some((c) => c.includes('category'));
    if (hasNo && hasDesc && hasCat) {
      headerIdx = i;
      cells.forEach((c, idx) => {
        if (c === 'no.') colMap.itemNo = idx;
        else if (c === 'description') colMap.description = idx;
        else if (c.includes('qty') && c.includes('pos') && !c.includes('not')) colMap.qtySold = idx;
        else if (c.includes('gross') && c.includes('sales') && c.includes('pos')) colMap.grossSales = idx;
        else if (c.includes('sales amount') && c.includes('pos')) colMap.netSales = idx;
        else if (c.includes('disc') && c.includes('pos')) colMap.discAmount = idx;
        else if (c.includes('vat') && c.includes('pos')) colMap.vatAmount = idx;
        else if (c.includes('retail product code')) colMap.retailProductCode = idx;
        else if (c.includes('item family code')) colMap.itemFamilyCode = idx;
        else if (c.includes('item category') || c === 'item category code') colMap.categoryCode = idx;
      });
      break;
    }
  }

  if (headerIdx < 0 || colMap.itemNo == null || colMap.categoryCode == null) return null;

  const DEPT_MAP = {
    '1': 'Grocery',
    '2': 'Fruit & Vegetable',
    '3': 'Fish & Seafood',
    '4': 'Meat',
    '5': 'Delicatessen',
    '6': 'Store Management',
  };

  const byProduct = {};
  const deptTotals = {};
  let totalNet = 0, totalGross = 0, totalQty = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const catRaw = row[colMap.categoryCode];
    const catCode = catRaw == null ? '' : String(catRaw).trim();
    if (!catCode) continue;

    const deptKey = catCode.charAt(0);
    const deptName = DEPT_MAP[deptKey];
    if (!deptName) continue;

    const netSales = toNum(colMap.netSales != null ? row[colMap.netSales] : null) || 0;
    const grossSales = toNum(colMap.grossSales != null ? row[colMap.grossSales] : null) || 0;
    const qtySold = toNum(colMap.qtySold != null ? row[colMap.qtySold] : null) || 0;
    const discAmount = toNum(colMap.discAmount != null ? row[colMap.discAmount] : null) || 0;
    const vatAmount = toNum(colMap.vatAmount != null ? row[colMap.vatAmount] : null) || 0;
    const retailProductCode = colMap.retailProductCode != null && row[colMap.retailProductCode] != null
      ? String(row[colMap.retailProductCode]).trim() : '';
    const itemFamilyCode = colMap.itemFamilyCode != null && row[colMap.itemFamilyCode] != null
      ? String(row[colMap.itemFamilyCode]).trim() : '';

    if (netSales === 0 && qtySold === 0) continue;

    const itemNoRaw = row[colMap.itemNo];
    const itemCode = itemNoRaw == null ? '' : String(itemNoRaw).trim();
    if (!itemCode) continue;

    const description = colMap.description != null && row[colMap.description] != null
      ? String(row[colMap.description]).trim()
      : '';

    if (!byProduct[itemCode]) {
      byProduct[itemCode] = {
        itemCode,
        itemName: description,
        departmentCode: '',
        departmentName: deptName,
        retailProductCode,
        itemFamilyCode,
        totalNetSales: 0,
        totalQuantitySold: 0,
        totalGrossSales: 0,
        totalDiscountAmount: 0,
        totalVatAmount: 0,
      };
    }
    byProduct[itemCode].totalNetSales += netSales;
    byProduct[itemCode].totalQuantitySold += qtySold;
    byProduct[itemCode].totalGrossSales += grossSales;
    byProduct[itemCode].totalDiscountAmount += discAmount;
    byProduct[itemCode].totalVatAmount += vatAmount;

    if (!deptTotals[deptName]) {
      deptTotals[deptName] = { netSales: 0, grossSales: 0, quantitySold: 0, discountAmount: 0 };
    }
    deptTotals[deptName].netSales += netSales;
    deptTotals[deptName].grossSales += grossSales;
    deptTotals[deptName].quantitySold += qtySold;
    deptTotals[deptName].discountAmount += discAmount;

    totalNet += netSales;
    totalGross += grossSales;
    totalQty += qtySold;
  }

  if (Object.keys(byProduct).length === 0) return null;

  const byDepartment = {};
  DEPARTMENTS.forEach((d) => { byDepartment[d] = { hourly: [] }; });
  Object.entries(deptTotals).forEach(([deptName, t]) => {
    byDepartment[deptName] = {
      hourly: [],
      totalRow: {
        netSales: t.netSales,
        grossSales: t.grossSales,
        quantitySold: t.quantitySold,
        receiptCount: null,
        discountAmount: t.discountAmount || undefined,
      },
    };
  });

  return {
    businessDate,
    storeId: String(storeId || 'default').trim() || 'default',
    storeName: String(storeId || 'default').trim() || 'default',
    total: {
      totalRow: {
        netSales: totalNet,
        grossSales: totalGross,
        quantitySold: totalQty,
        receiptCount: null,
      },
      hourly: [],
    },
    byDepartment,
    byProduct,
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

module.exports = { parseSheet, parseCsv, parseItemSalesExcel, parseProductMasterExcel, parseClassificationExcel };
