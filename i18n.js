(function () {
  'use strict';

  var LANG_STORAGE_KEY = 'sales_report_lang';

  var messages = {
    ja: {
      app_title: 'LOPIA Thailand Sales Report',
      tab_hourly: '時間別集計',
      tab_daily: '日別集計',
      tab_weekly: '週別集計',
      output_date: '出力日',
      select_date: '— 日付を選択 —',
      display: '表示',
      time_range: '時間帯',
      last_upload_label: 'データ最終アップロード: ',
      loading: '処理中...',
      time_range_col: '時間帯',
      currency_unit: 'バーツ',
      gross_sales: 'Gross Sales (バーツ)',
      net_sales: 'Net Sales (バーツ)',
      dod: 'DoD',
      wow: 'WoW',
      discount_rate: 'Discount Rate',
      qty_sold: 'Qty of Items Sold',
      receipt_count: 'Receipt Count',
      summary: 'サマリー',
      today: '当日',
      sales_per_hour: 'Sales per Hour',
      txn_per_hour: 'Transaction per Hour',
      unit_per_txn: 'Unit Per Transaction',
      avg_txn_price: 'Average Transaction Price',
      avg_selling_price: 'Average Selling Price',
      composition_title: 'Department Composition by Time Slot (Share of Net Sales)',
      total: 'Total',
      chart_hourly_net: '時間別 Net Sales (バーツ)',
      chart_receipts: 'Receipt Count by Time Slot',
      chart_forecast_net: 'Forecast (Landing) — Net Sales (バーツ)',
      chart_forecast_receipts: 'Forecast (Landing) — Receipt Count',
      actual_cumulative: '実績（累積）',
      forecast_line: '予測',
      forecast_band: '予測の幅',
      forecast_from_here: '※ここから予測',
      no_data_selected_date: '選択した日付のデータがありません。',
      no_data_for_store: 'この店舗にはまだデータがありません。Setup で Excel をアップロードしてください。',
      daily_section_title: '日別集計（選択期間のトレンド・部門構成）',
      daily_hint: '選択した期間の日別売上トレンドと部門構成を表示します。',
      period_total_section: '期間合計',
      week_ending: '週の終了日',
      daily_start_date: '開始日',
      daily_end_date: '終了日',
      export_csv: 'CSV出力',
      output_data: '出力データ',
      output_all: 'すべて',
      export_option_hourly_table: '時間別表',
      export_option_summary: 'サマリー',
      daily_empty: '日付を選択して日別サマリーを読み込みます。',
      daily_no_data: '該当期間のデータがありません。',
      daily_load_failed: '日別集計の読み込みに失敗しました。',
      weekly_section_title: '週別集計',
      weekly_hint: '週単位で売上・部門別構成を表示します。',
      weekly_end_date: '週の終了日',
      num_weeks: '表示週数',
      weeks_2: '2週間',
      weeks_3: '3週間',
      weeks_4: '4週間',
      weekly_empty: '週の終了日を選択してください。',
      weekly_no_data: '該当期間のデータがありません。',
      weekly_load_failed: '週別集計の取得に失敗しました。',
      week: '週',
      net_sales_thb: 'Net Sales (バーツ)',
      qty_sold_short: 'Qty Sold',
      sales_by_dept: '週別 部門別 Net Sales (バーツ)',
      dept_composition_pct: '週別 部門構成 (Net Sales %)',
      weekly_net_title: '週別 Net Sales (バーツ)',
      department: '部門',
      daily_sales_by_dept: 'Sales by Department (Net Sales)',
      daily_composition_pct: 'Department composition by day (%)',
      key_metrics_trend: 'Key metrics trend',
      lang_label: '言語',
      store: '店舗',
      time_slot: '時間帯',
      yesterday: '前日',
      last_week: '前週',
      share_pct: '構成比: {pct}%',
      forecast_total_count: 'Forecast total (count)',
      weekly_total_section: '週間合計',
      total_net_sales: '売上合計（正味）',
      total_receipts: 'レシート数合計',
      total_qty_sold: '販売数量合計',
      total_hours: '対象時間数',
      sales_per_hour_label: '時間あたり売上',
      avg_receipt_value: '平均レシート単価',
      key_metrics: '主要指標',
      metric: '指標',
      receipts_per_hour: '時間あたりレシート数',
      items_per_receipt: 'レシートあたり点数',
      quantity_sold: '販売数量',
      avg_item_price: '平均単価',
      total_header: '合計',
      date_label: '日付',
      logout: 'ログアウト',
      login_title: 'ログイン — LOPIA Thailand Sales Report',
      login_title_short: 'ログイン',
      login_username: 'ユーザー名',
      login_password: 'パスワード',
      login_submit: 'ログイン',
      login_error: 'ユーザー名またはパスワードが正しくありません。'
    },
    en: {
      app_title: 'LOPIA Thailand Sales Report',
      tab_hourly: 'Hourly',
      tab_daily: 'Daily',
      tab_weekly: 'Weekly',
      output_date: 'Output date',
      select_date: '— Select date —',
      display: 'Display',
      time_range: 'Time range',
      last_upload_label: 'Data last uploaded: ',
      loading: 'Loading...',
      time_range_col: 'Time range',
      currency_unit: 'Baht',
      gross_sales: 'Gross Sales (Baht)',
      net_sales: 'Net Sales (Baht)',
      dod: 'DoD',
      wow: 'WoW',
      discount_rate: 'Discount Rate',
      qty_sold: 'Qty of Items Sold',
      receipt_count: 'Receipt Count',
      summary: 'Summary',
      today: 'Today',
      sales_per_hour: 'Sales per Hour',
      txn_per_hour: 'Transaction per Hour',
      unit_per_txn: 'Unit Per Transaction',
      avg_txn_price: 'Average Transaction Price',
      avg_selling_price: 'Average Selling Price',
      composition_title: 'Department Composition by Time Slot (Share of Net Sales)',
      total: 'Total',
      chart_hourly_net: 'Hourly Net Sales (Baht)',
      chart_receipts: 'Receipt Count by Time Slot',
      chart_forecast_net: 'Forecast (Landing) — Net Sales (Baht)',
      chart_forecast_receipts: 'Forecast (Landing) — Receipt Count',
      actual_cumulative: 'Actual (cumulative)',
      forecast_line: 'Forecast',
      forecast_band: 'Forecast range',
      forecast_from_here: 'Forecast from here',
      no_data_selected_date: 'No data for the selected date.',
      no_data_for_store: 'No data for this store yet. Upload Excel in Setup.',
      daily_section_title: 'Daily aggregation (selected period trend and composition)',
      daily_hint: 'View daily sales trend and department composition for the selected period.',
      period_total_section: 'Period total',
      week_ending: 'Week ending (End date)',
      daily_start_date: 'Start date',
      daily_end_date: 'End date',
      export_csv: 'Export CSV',
      output_data: 'Output data',
      output_all: 'All',
      export_option_hourly_table: 'Hourly table',
      export_option_summary: 'Summary',
      daily_empty: 'Select start and end dates to load the daily summary.',
      daily_no_data: 'No data for the selected period.',
      daily_load_failed: 'Failed to load daily summary.',
      weekly_section_title: 'Weekly aggregation',
      weekly_hint: 'View sales and department composition by week.',
      weekly_end_date: 'Week ending',
      num_weeks: 'Weeks',
      weeks_2: '2 weeks',
      weeks_3: '3 weeks',
      weeks_4: '4 weeks',
      weekly_empty: 'Select week ending date.',
      weekly_no_data: 'No data for the selected period.',
      weekly_load_failed: 'Failed to load weekly summary.',
      week: 'Week',
      net_sales_thb: 'Net Sales (Baht)',
      qty_sold_short: 'Qty Sold',
      sales_by_dept: 'Weekly Net Sales by Department (Baht)',
      dept_composition_pct: 'Weekly department composition (Net Sales %)',
      weekly_net_title: 'Weekly Net Sales (Baht)',
      department: 'Department',
      daily_sales_by_dept: 'Sales by Department (Net Sales)',
      daily_composition_pct: 'Department composition by day (%)',
      key_metrics_trend: 'Key metrics trend',
      lang_label: 'Language',
      store: 'Store',
      time_slot: 'Time Slot',
      yesterday: 'Yesterday',
      last_week: 'Last Week',
      share_pct: 'Share: {pct}%',
      forecast_total_count: 'Forecast total (count)',
      weekly_total_section: 'Weekly total',
      total_net_sales: 'Total net sales',
      total_receipts: 'Total receipts',
      total_qty_sold: 'Total qty sold',
      total_hours: 'Total hours',
      sales_per_hour_label: 'Sales per hour',
      avg_receipt_value: 'Avg receipt value',
      key_metrics: 'Key metrics',
      metric: 'Metric',
      receipts_per_hour: 'Receipts per hour',
      items_per_receipt: 'Items per receipt',
      quantity_sold: 'Quantity sold',
      avg_item_price: 'Avg item price',
      total_header: 'Total',
      date_label: 'Date',
      logout: 'Log out',
      login_title: 'Log in — LOPIA Thailand Sales Report',
      login_title_short: 'Log in',
      login_username: 'Username',
      login_password: 'Password',
      login_submit: 'Log in',
      login_error: 'Invalid username or password.'
    },
    th: {
      app_title: 'LOPIA Thailand Sales Report',
      tab_hourly: 'รายชั่วโมง',
      tab_daily: 'รายวัน',
      tab_weekly: 'รายสัปดาห์',
      output_date: 'วันที่แสดง',
      select_date: '— เลือกวันที่ —',
      display: 'แสดง',
      time_range: 'ช่วงเวลา',
      last_upload_label: 'อัปโหลดข้อมูลล่าสุด: ',
      loading: 'กำลังประมวลผล...',
      time_range_col: 'ช่วงเวลา',
      currency_unit: 'บาท',
      gross_sales: 'Gross Sales (บาท)',
      net_sales: 'Net Sales (บาท)',
      dod: 'DoD',
      wow: 'WoW',
      discount_rate: 'Discount Rate',
      qty_sold: 'Qty of Items Sold',
      receipt_count: 'Receipt Count',
      summary: 'สรุป',
      today: 'Today',
      sales_per_hour: 'Sales per Hour',
      txn_per_hour: 'Transaction per Hour',
      unit_per_txn: 'Unit Per Transaction',
      avg_txn_price: 'Average Transaction Price',
      avg_selling_price: 'Average Selling Price',
      composition_title: 'สัดส่วนแผนกตามช่วงเวลา (ส่วนแบ่ง Net Sales)',
      total: 'Total',
      chart_hourly_net: 'ยอดขายรายชั่วโมง Net Sales (บาท)',
      chart_receipts: 'จำนวนใบเสร็จตามช่วงเวลา',
      chart_forecast_net: 'พยากรณ์ — Net Sales (บาท)',
      chart_forecast_receipts: 'พยากรณ์ — จำนวนใบเสร็จ',
      actual_cumulative: 'ผลจริง (สะสม)',
      forecast_line: 'พยากรณ์',
      forecast_band: 'ช่วงพยากรณ์',
      forecast_from_here: 'พยากรณ์จากจุดนี้',
      no_data_selected_date: 'ไม่มีข้อมูลสำหรับวันที่เลือก',
      no_data_for_store: 'ยังไม่มีข้อมูลสำหรับสาขานี้ กรุณาอัปโหลด Excel จาก Setup',
      daily_section_title: 'สรุปรายวัน (แนวโน้มและสัดส่วนแผนกในช่วงที่เลือก)',
      daily_hint: 'ดูแนวโน้มยอดขายรายวันและสัดส่วนแผนกในช่วงที่เลือก',
      period_total_section: 'รวมช่วงที่เลือก',
      week_ending: 'สิ้นสุดสัปดาห์ (วันที่)',
      daily_start_date: 'วันที่เริ่มต้น',
      daily_end_date: 'วันที่สิ้นสุด',
      export_csv: 'ส่งออก CSV',
      output_data: 'ข้อมูลที่ส่งออก',
      output_all: 'ทั้งหมด',
      export_option_hourly_table: 'ตารางรายชั่วโมง',
      export_option_summary: 'สรุป',
      daily_empty: 'เลือกวันที่เริ่มต้นและสิ้นสุดเพื่อโหลดสรุปรายวัน',
      daily_no_data: 'ไม่มีข้อมูลในช่วงที่เลือก',
      daily_load_failed: 'โหลดสรุปรายวันไม่สำเร็จ',
      weekly_section_title: 'สรุปรายสัปดาห์',
      weekly_hint: 'ดูยอดขายและสัดส่วนแผนกตามสัปดาห์',
      weekly_end_date: 'สิ้นสุดสัปดาห์',
      num_weeks: 'จำนวนสัปดาห์',
      weeks_2: '2 สัปดาห์',
      weeks_3: '3 สัปดาห์',
      weeks_4: '4 สัปดาห์',
      weekly_empty: 'กรุณาเลือกวันที่สิ้นสุดสัปดาห์',
      weekly_no_data: 'ไม่มีข้อมูลในช่วงที่เลือก',
      weekly_load_failed: 'โหลดสรุปรายสัปดาห์ไม่สำเร็จ',
      week: 'สัปดาห์',
      net_sales_thb: 'Net Sales (บาท)',
      qty_sold_short: 'Qty Sold',
      sales_by_dept: 'Net Sales แยกตามแผนกรายสัปดาห์ (บาท)',
      dept_composition_pct: 'สัดส่วนแผนกรายสัปดาห์ (Net Sales %)',
      weekly_net_title: 'Net Sales รายสัปดาห์ (บาท)',
      department: 'แผนก',
      daily_sales_by_dept: 'ยอดขายแยกตามแผนก (Net Sales)',
      daily_composition_pct: 'สัดส่วนแผนกตามวัน (%)',
      key_metrics_trend: 'แนวโน้มตัวชี้วัดหลัก',
      lang_label: 'ภาษา',
      store: 'สาขา',
      time_slot: 'ช่วงเวลา',
      yesterday: 'เมื่อวาน',
      last_week: 'สัปดาห์ก่อน',
      share_pct: 'ส่วนแบ่ง: {pct}%',
      forecast_total_count: 'พยากรณ์รวม (จำนวน)',
      weekly_total_section: 'รวมรายสัปดาห์',
      total_net_sales: 'ยอดขายสุทธิรวม',
      total_receipts: 'จำนวนใบเสร็จรวม',
      total_qty_sold: 'จำนวนขายรวม',
      total_hours: 'ชั่วโมงรวม',
      sales_per_hour_label: 'ยอดขายต่อชั่วโมง',
      avg_receipt_value: 'มูลค่าใบเสร็จเฉลี่ย',
      key_metrics: 'ตัวชี้วัดหลัก',
      metric: 'ตัวชี้วัด',
      receipts_per_hour: 'ใบเสร็จต่อชั่วโมง',
      items_per_receipt: 'รายการต่อใบเสร็จ',
      quantity_sold: 'จำนวนขาย',
      avg_item_price: 'ราคาเฉลี่ยต่อหน่วย',
      total_header: 'รวม',
      date_label: 'วันที่',
      logout: 'ออกจากระบบ',
      login_title: 'เข้าสู่ระบบ — LOPIA Thailand Sales Report',
      login_title_short: 'เข้าสู่ระบบ',
      login_username: 'ชื่อผู้ใช้',
      login_password: 'รหัสผ่าน',
      login_submit: 'เข้าสู่ระบบ',
      login_error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
    }
  };

  function getBrowserLocale() {
    var lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (lang.indexOf('ja') === 0) return 'ja';
    if (lang.indexOf('th') === 0) return 'th';
    return 'en';
  }

  function getStoredLang() {
    try {
      var stored = localStorage.getItem(LANG_STORAGE_KEY);
      if (stored && messages[stored]) return stored;
    } catch (e) {}
    return null;
  }

  var currentLang = getStoredLang() || getBrowserLocale();

  function t(key) {
    var m = messages[currentLang];
    if (m && m[key] !== undefined) return m[key];
    if (messages.en && messages.en[key] !== undefined) return messages.en[key];
    return key;
  }

  function getCurrentLang() {
    return currentLang;
  }

  function setLanguage(lang) {
    if (!messages[lang]) return;
    currentLang = lang;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch (e) {}
    document.documentElement.lang = lang === 'ja' ? 'ja' : lang === 'th' ? 'th' : 'en';
    applyPageTranslations();
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('languageChange', { detail: { lang: lang } }));
    }
  }

  function applyPageTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-option]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-option');
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    var titleEl = document.querySelector('title');
    if (titleEl) titleEl.textContent = t('app_title');
    ['output-date', 'daily-end-date', 'weekly-end-date'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.tagName === 'SELECT' && el.options.length && el.options[0].value === '') {
        el.options[0].text = t('select_date');
      }
    });
  }

  function initI18n() {
    document.documentElement.lang = currentLang === 'ja' ? 'ja' : currentLang === 'th' ? 'th' : 'en';
    applyPageTranslations();
    var sel = document.getElementById('lang-select');
    if (sel) {
      sel.value = currentLang;
      sel.addEventListener('change', function () {
        setLanguage(sel.value);
      });
    }
  }

  window.i18n = {
    t: t,
    setLanguage: setLanguage,
    getCurrentLang: getCurrentLang,
    getBrowserLocale: getBrowserLocale,
    applyPageTranslations: applyPageTranslations,
    initI18n: initI18n,
    supportedLangs: [{ code: 'ja', label: '日本語' }, { code: 'en', label: 'English' }, { code: 'th', label: 'ไทย' }]
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
  } else {
    initI18n();
  }
})();
