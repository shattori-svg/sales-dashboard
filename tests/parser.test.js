'use strict';

const { parseCsv: parseCsvRaw, parseSheet } = require('../parser');
const XLSX = require('xlsx');

// parseCsv now returns an array; tests use single-store CSVs, so unwrap [0]
function parseCsv(csv) {
  const arr = parseCsvRaw(csv);
  return arr ? arr[0] : null;
}

// ─── CSV helpers ────────────────────────────────────────────────────────────

function makeCsv(rows) {
  const header = 'Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count';
  return [header, ...rows].join('\n');
}

function makeCsvWithProducts(rows) {
  const header = 'Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count,Item_Code,Item_Name';
  return [header, ...rows].join('\n');
}

// ─── 1. parseCsv — 基本構造 ─────────────────────────────────────────────────

describe('parseCsv – 基本構造', () => {
  test('ヘッダーのみ（データなし）はnullを返す', () => {
    const csv = 'Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count';
    expect(parseCsv(csv)).toBeNull();
  });

  test('必須列が欠けているとnullを返す', () => {
    const csv = 'Business_Date,Store_Id,Start_Time,End_Time,Net_Sales\n2026-03-15,1001,,,,';
    expect(parseCsv(csv)).toBeNull();
  });

  test('businessDate と storeId を正しく取得する', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,850000,890000,4200,520',
    ]);
    const result = parseCsv(csv);
    expect(result.businessDate).toBe('2026-03-15');
    expect(result.storeId).toBe('1001');
  });

  test('BOM付きCSVも正常に解析する', () => {
    const csv = '\uFEFF' + makeCsv(['2026-03-15,1001,00,,,100000,110000,500,100']);
    const result = parseCsv(csv);
    expect(result).not.toBeNull();
    expect(result.businessDate).toBe('2026-03-15');
  });
});

// ─── 2. parseCsv — totalRow（日計行）────────────────────────────────────────

describe('parseCsv – 日計行 (totalRow)', () => {
  test('Department_Code=00、時間帯なし → totalRow に格納', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,850000,890000,4200,520',
    ]);
    const result = parseCsv(csv);
    expect(result.total.totalRow).toEqual({
      netSales: 850000,
      grossSales: 890000,
      quantitySold: 4200,
      receiptCount: 520,
    });
  });

  test('Department_Code空、時間帯なし → totalRow に格納', () => {
    const csv = makeCsv([
      '2026-03-15,1001,,,,100000,110000,300,50',
    ]);
    const result = parseCsv(csv);
    expect(result.total.totalRow.netSales).toBe(100000);
  });

  test('複数の日計行がある場合は最後の値を使う', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,100000,110000,300,50',
      '2026-03-15,1001,00,,,200000,220000,600,100',
    ]);
    const result = parseCsv(csv);
    expect(result.total.totalRow.netSales).toBe(200000);
  });
});

// ─── 3. parseCsv — hourly（時間別行）────────────────────────────────────────

describe('parseCsv – 時間別行 (hourly)', () => {
  test('Department_Code=00 の時間別行 → total.hourly に格納', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,09:00,10:00,45000,47000,230,68',
      '2026-03-15,1001,00,10:00,11:00,50000,52000,250,75',
    ]);
    const result = parseCsv(csv);
    expect(result.total.hourly).toHaveLength(2);
    expect(result.total.hourly[0].timeKey).toBe('09:00-10:00');
    expect(result.total.hourly[0].netSales).toBe(45000);
    expect(result.total.hourly[0].receiptCount).toBe(68);
  });

  test('4桁形式の時刻（0900, 1000）を正規化する', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,0900,1000,45000,47000,230,68',
    ]);
    const result = parseCsv(csv);
    expect(result.total.hourly[0].timeKey).toBe('09:00-10:00');
  });

  test('時間別行はTIME_ORDER順にソートされる', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,11:00,12:00,60000,62000,300,90',
      '2026-03-15,1001,00,09:00,10:00,45000,47000,230,68',
      '2026-03-15,1001,00,10:00,11:00,50000,52000,250,75',
    ]);
    const result = parseCsv(csv);
    expect(result.total.hourly[0].timeKey).toBe('09:00-10:00');
    expect(result.total.hourly[1].timeKey).toBe('10:00-11:00');
    expect(result.total.hourly[2].timeKey).toBe('11:00-12:00');
  });

  test('部門行（01〜06）→ byDepartment に格納、total.hourly は slotTotals から生成', () => {
    const csv = makeCsv([
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0',
      '2026-03-15,1001,02,09:00,10:00,8000,8500,40,0',
    ]);
    const result = parseCsv(csv);
    expect(result.byDepartment['Grocery'].hourly[0].netSales).toBe(18000);
    expect(result.byDepartment['Fruit & Vegetable'].hourly[0].netSales).toBe(8000);
    // slotTotals から total.hourly が生成される
    expect(result.total.hourly[0].netSales).toBe(26000);
    expect(result.total.hourly[0].timeKey).toBe('09:00-10:00');
  });

  test('Department_Code=00 の時間帯行が存在する場合、slotTotals より優先される', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,09:00,10:00,45000,47000,230,68',
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0',
    ]);
    const result = parseCsv(csv);
    // hourlyTotalRows が存在するので、そちらを使う
    expect(result.total.hourly[0].netSales).toBe(45000);
    expect(result.total.hourly[0].receiptCount).toBe(68);
  });
});

// ─── 4. parseCsv — 部門コードマッピング ─────────────────────────────────────

describe('parseCsv – 部門コードマッピング', () => {
  const deptMap = {
    '01': 'Grocery',
    '02': 'Fruit & Vegetable',
    '03': 'Fish & Seafood',
    '04': 'Meat',
    '05': 'Delicatessen',
    '06': 'Store Management',
  };

  Object.entries(deptMap).forEach(([code, name]) => {
    test(`Department_Code=${code} → byDepartment['${name}']`, () => {
      const csv = makeCsv([
        `2026-03-15,1001,${code},09:00,10:00,10000,11000,50,0`,
      ]);
      const result = parseCsv(csv);
      expect(result.byDepartment[name].hourly[0].netSales).toBe(10000);
    });
  });

  test('未知のDepartment_Codeは無視される', () => {
    const csv = makeCsv([
      '2026-03-15,1001,99,09:00,10:00,10000,11000,50,0',
    ]);
    const result = parseCsv(csv);
    expect(result.byDepartment['Grocery'].hourly).toHaveLength(0);
    expect(result.total.hourly).toHaveLength(0);
  });
});

// ─── 5. parseCsv — 複数時間帯・複数部門の集計 ───────────────────────────────

describe('parseCsv – 複数時間帯・複数部門の集計', () => {
  test('同一timeKeyの複数部門を slotTotals で合算する', () => {
    const csv = makeCsv([
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0',
      '2026-03-15,1001,02,09:00,10:00,8000,8500,40,0',
      '2026-03-15,1001,03,09:00,10:00,5000,5200,20,0',
    ]);
    const result = parseCsv(csv);
    const slot = result.total.hourly.find(h => h.timeKey === '09:00-10:00');
    expect(slot.netSales).toBe(31000);
    expect(slot.quantitySold).toBe(150);
  });

  test('複数時間帯が正しく格納される', () => {
    const csv = makeCsv([
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0',
      '2026-03-15,1001,01,10:00,11:00,22000,23000,110,0',
    ]);
    const result = parseCsv(csv);
    expect(result.byDepartment['Grocery'].hourly).toHaveLength(2);
    expect(result.total.hourly).toHaveLength(2);
  });

  test('日計行 + 時間別行 + 部門行の混在', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,850000,890000,4200,520',
      '2026-03-15,1001,00,09:00,10:00,45000,47000,230,68',
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0',
      '2026-03-15,1001,02,09:00,10:00,8000,8500,40,0',
    ]);
    const result = parseCsv(csv);
    expect(result.total.totalRow.netSales).toBe(850000);
    expect(result.total.hourly[0].netSales).toBe(45000); // 00行優先
    expect(result.byDepartment['Grocery'].hourly[0].netSales).toBe(18000);
  });
});

// ─── 6. parseCsv — byProduct（商品行）──────────────────────────────────────

describe('parseCsv – byProduct（商品行）', () => {
  test('Item_Code列なし → byProduct は undefined', () => {
    const csv = makeCsv([
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0',
    ]);
    const result = parseCsv(csv);
    expect(result.byProduct).toBeUndefined();
  });

  test('Item_Codeあり → byProduct に格納される', () => {
    const csv = makeCsvWithProducts([
      '2026-03-15,1001,01,09:00,10:00,5000,5200,10,0,4901234567890,LOPIA牛乳1L',
    ]);
    const result = parseCsv(csv);
    expect(result.byProduct).toBeDefined();
    expect(result.byProduct['4901234567890']).toMatchObject({
      itemCode: '4901234567890',
      itemName: 'LOPIA牛乳1L',
      departmentCode: '01',
      departmentName: 'Grocery',
      totalNetSales: 5000,
      totalQuantitySold: 10,
    });
  });

  test('商品行は byDepartment に加算されない（二重カウント防止）', () => {
    const csv = makeCsvWithProducts([
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0,',          // 部門行
      '2026-03-15,1001,01,09:00,10:00,5000,5200,10,0,4901234567890,牛乳', // 商品行
    ]);
    const result = parseCsv(csv);
    // 部門行のみ byDepartment へ
    expect(result.byDepartment['Grocery'].hourly[0].netSales).toBe(18000);
    // 商品行は byProduct へ
    expect(result.byProduct['4901234567890'].totalNetSales).toBe(5000);
  });

  test('同一商品が複数時間帯にある場合は累計される', () => {
    const csv = makeCsvWithProducts([
      '2026-03-15,1001,01,09:00,10:00,3000,3100,6,0,4901234567890,牛乳',
      '2026-03-15,1001,01,10:00,11:00,4000,4200,8,0,4901234567890,牛乳',
    ]);
    const result = parseCsv(csv);
    expect(result.byProduct['4901234567890'].totalNetSales).toBe(7000);
    expect(result.byProduct['4901234567890'].totalQuantitySold).toBe(14);
  });

  test('複数商品が別々に格納される', () => {
    const csv = makeCsvWithProducts([
      '2026-03-15,1001,01,09:00,10:00,5000,5200,10,0,4901234567890,牛乳',
      '2026-03-15,1001,01,09:00,10:00,3000,3100,15,0,4902370548891,ヨーグルト',
    ]);
    const result = parseCsv(csv);
    expect(Object.keys(result.byProduct)).toHaveLength(2);
    expect(result.byProduct['4902370548891'].totalNetSales).toBe(3000);
  });
});

// ─── 7. parseCsv — 数値変換（toNum）────────────────────────────────────────

describe('parseCsv – 数値変換', () => {
  test('カンマ区切り数値を正しく解析する', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,"1,850,000","1,890,000","4,200",520',
    ]);
    const result = parseCsv(csv);
    expect(result.total.totalRow.netSales).toBe(1850000);
  });

  test('NULL文字列はnullに変換される', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,NULL,NULL,NULL,NULL',
    ]);
    const result = parseCsv(csv);
    expect(result.total.totalRow.netSales).toBeNull();
  });

  test('空文字の売上はnullに変換される', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,,,, ',
    ]);
    const result = parseCsv(csv);
    expect(result.total.totalRow.netSales).toBeNull();
  });
});

// ─── 8. parseCsv — 旧フォーマット後方互換性 ─────────────────────────────────

describe('parseCsv – 後方互換性', () => {
  test('Item_Code列なしのCSVで既存タブが正常動作する', () => {
    const csv = makeCsv([
      '2026-03-15,1001,00,,,850000,890000,4200,520',
      '2026-03-15,1001,00,09:00,10:00,45000,47000,230,68',
      '2026-03-15,1001,01,09:00,10:00,18000,19000,90,0',
    ]);
    const result = parseCsv(csv);
    expect(result).not.toBeNull();
    expect(result.total.totalRow.netSales).toBe(850000);
    expect(result.total.hourly).toHaveLength(1);
    expect(result.byDepartment['Grocery'].hourly).toHaveLength(1);
    expect(result.byProduct).toBeUndefined();
  });
});

// ─── 9. parseSheet — Excel 基本構造 ─────────────────────────────────────────

describe('parseSheet – Excel基本構造', () => {
  function makeExcelBuffer(rows) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  const HEADER = [
    'Business Date', 'Store Name', 'Start Time', 'End Time',
    'Hourly Receipt Count', 'Hourly Gross Sales', 'Hourly Net Sales', 'Hourly Quantity Sold',
    'Department Name', 'Net Sales', 'Quantity Sold',
    'Total Receipt Count', 'Total Gross Sales', 'Total Net Sales', 'Total Quantity Sold',
  ];

  test('データなし（ヘッダーのみ）は空の構造体を返す', () => {
    const buf = makeExcelBuffer([HEADER]);
    const result = parseSheet(buf);
    expect(result).not.toBeNull();
    expect(result.total.hourly).toHaveLength(0);
    expect(result.total.totalRow).toBeNull();
  });

  test('businessDate と storeName を正しく取得する', () => {
    const buf = makeExcelBuffer([
      HEADER,
      ['2026-03-15', 'Store A', '09:00', '10:00', 10, 50000, 45000, 300, null, null, null, null, null, null, null],
    ]);
    const result = parseSheet(buf);
    expect(result.businessDate).toBe('2026-03-15');
    expect(result.storeName).toBe('Store A');
  });

  test('totalRow が正しく格納される', () => {
    const buf = makeExcelBuffer([
      HEADER,
      ['2026-03-15', 'Store A', null, null, null, null, null, null, null, null, null, 520, 890000, 850000, 4200],
    ]);
    const result = parseSheet(buf);
    expect(result.total.totalRow).toMatchObject({
      receiptCount: 520,
      grossSales: 890000,
      netSales: 850000,
      quantitySold: 4200,
    });
  });

  test('時間別行がhourlyに格納される', () => {
    const buf = makeExcelBuffer([
      HEADER,
      ['2026-03-15', 'Store A', '09:00', '10:00', 68, 47000, 45000, 230, null, null, null, null, null, null, null],
      ['2026-03-15', 'Store A', '10:00', '11:00', 75, 52000, 50000, 250, null, null, null, null, null, null, null],
    ]);
    const result = parseSheet(buf);
    expect(result.total.hourly).toHaveLength(2);
    expect(result.total.hourly[0].netSales).toBe(45000);
    expect(result.total.hourly[0].receiptCount).toBe(68);
  });

  test('部門名付き行が byDepartment に格納される', () => {
    const buf = makeExcelBuffer([
      HEADER,
      ['2026-03-15', 'Store A', '09:00', '10:00', 68, 47000, 45000, 230, 'Grocery', 18000, 90, null, null, null, null],
    ]);
    const result = parseSheet(buf);
    expect(result.byDepartment['Grocery'].hourly[0].netSales).toBe(18000);
  });

  test('時間別行はTIME_ORDER順にソートされる', () => {
    const buf = makeExcelBuffer([
      HEADER,
      ['2026-03-15', 'Store A', '11:00', '12:00', 90, 62000, 60000, 300, null, null, null, null, null, null, null],
      ['2026-03-15', 'Store A', '09:00', '10:00', 68, 47000, 45000, 230, null, null, null, null, null, null, null],
    ]);
    const result = parseSheet(buf);
    expect(result.total.hourly[0].timeKey).toBe('09:00-10:00');
    expect(result.total.hourly[1].timeKey).toBe('11:00-12:00');
  });
});

// ─── 10. DoD/WoW 比較ロジック（timeKey一致） ────────────────────────────────

describe('DoD/WoW 比較ロジック – 今日のtimeKeyで絞る前提検証', () => {
  test('今日5スロット・昨日12スロットで今日分のnetSalesが正しく合算される', () => {
    // 今日: 10:00〜15:00 (5スロット)
    const todaySlots = [
      { timeKey: '10:00-11:00', netSales: 49480 },
      { timeKey: '11:00-12:00', netSales: 217934 },
      { timeKey: '12:00-13:00', netSales: 224695 },
      { timeKey: '13:00-14:00', netSales: 224650 },
      { timeKey: '14:00-15:00', netSales: 121959 },
    ];
    // 昨日: 10:00〜22:00 (12スロット)
    const yesterdaySlots = [
      { timeKey: '10:00-11:00', netSales: 54978 },
      { timeKey: '11:00-12:00', netSales: 184690 },
      { timeKey: '12:00-13:00', netSales: 246917 },
      { timeKey: '13:00-14:00', netSales: 252416 },
      { timeKey: '14:00-15:00', netSales: 254081 },
      { timeKey: '15:00-16:00', netSales: 200000 },
      { timeKey: '16:00-17:00', netSales: 180000 },
      { timeKey: '17:00-18:00', netSales: 220000 },
      { timeKey: '18:00-19:00', netSales: 210000 },
      { timeKey: '19:00-20:00', netSales: 190000 },
      { timeKey: '20:00-21:00', netSales: 170000 },
      { timeKey: '21:00-22:00', netSales: 130000 },
    ];

    // アプリと同じロジック: rowsHourly のtimeKeyで絞る
    const todayKeySet = {};
    todaySlots.forEach(h => { todayKeySet[h.timeKey] = true; });
    const filteredYesterday = yesterdaySlots.filter(h => todayKeySet[h.timeKey]);

    const todayTotal = todaySlots.reduce((s, h) => s + h.netSales, 0);
    const yesterdayTotal = filteredYesterday.reduce((s, h) => s + h.netSales, 0);
    const dod = Math.round((todayTotal / yesterdayTotal) * 100);

    // 全日比較（誤り）: 838718 / 2093082 ≈ 40%
    const wrongYesterdayTotal = yesterdaySlots.reduce((s, h) => s + h.netSales, 0);
    const wrongDod = Math.round((todayTotal / wrongYesterdayTotal) * 100);

    expect(dod).toBeGreaterThanOrEqual(80);   // 正しいDoD: 約85%
    expect(dod).toBeLessThanOrEqual(90);
    expect(wrongDod).toBeLessThan(50);        // 誤ったDoD: 約40%（全日比較）
  });

  test('今日・昨日が同じスロット数の場合、フィルタ前後で結果が変わらない', () => {
    const slots = [
      { timeKey: '09:00-10:00', netSales: 45000 },
      { timeKey: '10:00-11:00', netSales: 50000 },
    ];
    const todayKeySet = {};
    slots.forEach(h => { todayKeySet[h.timeKey] = true; });
    const filtered = slots.filter(h => todayKeySet[h.timeKey]);
    expect(filtered).toHaveLength(slots.length);
  });
});
