(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.fetch) {
    var origFetch = window.fetch;
    var _authCheckPending = false;
    window.fetch = function (url, opts) {
      return origFetch.apply(this, arguments).then(function (res) {
        if (res.status === 401 && !_authCheckPending) {
          _authCheckPending = true;
          origFetch('/api/auth/status').then(function (authRes) {
            if (authRes.status === 401) window.location.href = '/login';
            else _authCheckPending = false;
          }).catch(function () {
            window.location.href = '/login';
          });
        }
        return res;
      });
    };
  }

  function t(key) {
    return window.i18n && window.i18n.t ? window.i18n.t(key) : key;
  }

  var state = {
    today: null,
    yesterday: null,
    lastWeek: null,
    referenceDate: null,
    businessHoursSettings: null,
    storeId: 'default',
    stores: [],
    currency: 'THB',
    exchangeRate: null,
    exchangeRateUpdatedAt: null,
    dailyClsTree: null,
    dailyClsAgg: null,
    dailyClsDays: null,
    dailyClsDept: null,
  };

  var AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  var autoRefreshTimer = null;
  var autoRefreshCountdownTimer = null;
  var nextAutoRefreshAt = null;
  var selectedCompositionDept = null;
  var showDetailedKpis = false;

  function getSelectedStoreId() {
    var el = document.getElementById('store-select');
    return el && el.value ? el.value : 'default';
  }
  function getDailyStoreId() {
    var el = document.getElementById('daily-store-select');
    return el && el.value ? el.value : 'default';
  }
  function getWeeklyStoreId() {
    var el = document.getElementById('weekly-store-select');
    return el && el.value ? el.value : 'default';
  }
  function getExchangeRate() {
    var r = state.exchangeRate != null ? Number(state.exchangeRate) : NaN;
    return typeof r === 'number' && !Number.isNaN(r) && r > 0 ? r : null;
  }
  function getCurrencyCode() {
    return state.currency === 'JPY' ? 'JPY' : 'THB';
  }
  function toSelectedCurrency(amountBaht) {
    if (amountBaht == null) return null;
    var n = Number(amountBaht);
    if (Number.isNaN(n)) return null;
    if (getCurrencyCode() === 'JPY') {
      var rate = getExchangeRate();
      if (rate == null) return null;
      return n * rate;
    }
    return n;
  }
  function getCurrencyLabel() {
    return getCurrencyCode() === 'JPY' ? t('jpy_unit') : t('currency_unit');
  }

  var DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];
  var DEPARTMENT_COLORS = ['#9333ea', '#22c55e', '#38bdf8', '#ec4899', '#f97316', '#1f2937'];
  var DEPT_SHORT = { 'Grocery': 'Gr', 'Fruit & Vegetable': 'F&V', 'Fish & Seafood': 'F&S', 'Meat': 'Mt', 'Delicatessen': 'Deli', 'Store Management': 'Mg' };

  function getDepartmentDisplayName(name) {
    var lang = window.i18n && window.i18n.getCurrentLang ? window.i18n.getCurrentLang() : 'ja';
    if (lang === 'ja') {
      var jaMap = {
        'Grocery': '食品',
        'Fruit & Vegetable': '青果',
        'Fish & Seafood': '鮮魚',
        'Meat': '精肉',
        'Delicatessen': '惣菜',
        'Store Management': '店舗管理'
      };
      return jaMap[name] || name;
    }
    if (lang === 'th') {
      var thMap = {
        'Grocery': 'ของชำ',
        'Fruit & Vegetable': 'ผักและผลไม้',
        'Fish & Seafood': 'ปลาและอาหารทะเล',
        'Meat': 'เนื้อสัตว์',
        'Delicatessen': 'อาหารพร้อมทาน',
        'Store Management': 'บริหารสาขา'
      };
      return thMap[name] || name;
    }
    return name;
  }

  function refreshDepartmentSelectLabels() {
    var ids = ['department-select', 'ai-department-select', 'allstores-department-select', 'settings-department-select', 'daily-dept-select', 'products-dept-filter'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var isProductsFilter = (id === 'products-dept-filter');
      Array.prototype.forEach.call(el.options, function (opt) {
        var v = opt.value || '';
        if (v === '') {
          opt.textContent = isProductsFilter ? (t('products_all_depts') || 'All') : (t('total') || 'Total');
        } else if (v === 'Total') {
          opt.textContent = t('total') || 'Total';
        } else {
          opt.textContent = getDepartmentDisplayName(v);
        }
      });
    });
  }

  var chartInstances = { sales: null, receipts: null, forecastSales: null, forecastReceipts: null, composition: null, dailySales: null, dailyComposition: null, dailyMetrics: null };
  var hourlyChartView = 'sales';
  var forecastChartView = 'sales';
  var compositionViewMode = 'amount';
  var lastCompositionData = null;
  var COMPOSITION_NARROW_PX = 768;

  function destroyCharts() {
    if (chartInstances.sales) {
      chartInstances.sales.destroy();
      chartInstances.sales = null;
    }
    if (chartInstances.receipts) {
      chartInstances.receipts.destroy();
      chartInstances.receipts = null;
    }
    if (chartInstances.forecastSales) {
      chartInstances.forecastSales.destroy();
      chartInstances.forecastSales = null;
    }
    if (chartInstances.forecastReceipts) {
      chartInstances.forecastReceipts.destroy();
      chartInstances.forecastReceipts = null;
    }
    if (chartInstances.composition) {
      chartInstances.composition.destroy();
      chartInstances.composition = null;
    }
    if (chartInstances.dailySales) {
      chartInstances.dailySales.destroy();
      chartInstances.dailySales = null;
    }
    if (chartInstances.dailyComposition) {
      chartInstances.dailyComposition.destroy();
      chartInstances.dailyComposition = null;
    }
    if (chartInstances.dailyMetrics) {
      chartInstances.dailyMetrics.destroy();
      chartInstances.dailyMetrics = null;
    }
  }

  function setHourlyChartTab(view) {
    hourlyChartView = view === 'receipts' ? 'receipts' : 'sales';
    var salesPanel = document.getElementById('hourly-chart-sales-panel');
    var receiptsPanel = document.getElementById('hourly-chart-receipts-panel');
    var tabSales = document.getElementById('chart-tab-sales');
    var tabReceipts = document.getElementById('chart-tab-receipts');
    if (salesPanel) salesPanel.hidden = hourlyChartView !== 'sales';
    if (receiptsPanel) receiptsPanel.hidden = hourlyChartView !== 'receipts';
    if (tabSales) {
      tabSales.classList.toggle('active', hourlyChartView === 'sales');
      tabSales.setAttribute('aria-selected', hourlyChartView === 'sales' ? 'true' : 'false');
    }
    if (tabReceipts) {
      tabReceipts.classList.toggle('active', hourlyChartView === 'receipts');
      tabReceipts.setAttribute('aria-selected', hourlyChartView === 'receipts' ? 'true' : 'false');
    }
  }

  function setForecastChartTab(view) {
    forecastChartView = view === 'receipts' ? 'receipts' : 'sales';
    var salesPanel = document.getElementById('forecast-chart-sales-panel');
    var receiptsPanel = document.getElementById('forecast-chart-receipts-panel');
    var tabSales = document.getElementById('chart-tab-forecast-sales');
    var tabReceipts = document.getElementById('chart-tab-forecast-receipts');
    if (salesPanel) salesPanel.hidden = forecastChartView !== 'sales';
    if (receiptsPanel) receiptsPanel.hidden = forecastChartView !== 'receipts';
    if (tabSales) {
      tabSales.classList.toggle('active', forecastChartView === 'sales');
      tabSales.setAttribute('aria-selected', forecastChartView === 'sales' ? 'true' : 'false');
    }
    if (tabReceipts) {
      tabReceipts.classList.toggle('active', forecastChartView === 'receipts');
      tabReceipts.setAttribute('aria-selected', forecastChartView === 'receipts' ? 'true' : 'false');
    }
  }

  function destroyDailyCharts() {
    if (chartInstances.dailySales) {
      chartInstances.dailySales.destroy();
      chartInstances.dailySales = null;
    }
    if (chartInstances.dailyComposition) {
      chartInstances.dailyComposition.destroy();
      chartInstances.dailyComposition = null;
    }
    if (chartInstances.dailyMetrics) {
      chartInstances.dailyMetrics.destroy();
      chartInstances.dailyMetrics = null;
    }
  }

  function getDepartmentCompositionByTime(todayData, startTime, endTime) {
    if (!todayData || !todayData.byDepartment || !todayData.total || !todayData.total.hourly) return null;
    var totalHourly = filterByBusinessHours(todayData.total.hourly, todayData.businessDate);
    var timeSlots = filterByTimeRange(totalHourly, startTime, endTime);
    if (!timeSlots || !timeSlots.length) return null;
    var timeLabels = timeSlots.map(function (h) { return h.timeLabel || h.timeKey || ''; });
    var deptDatasets = [];
    for (var d = 0; d < DEPARTMENTS.length; d++) {
      var dept = DEPARTMENTS[d];
      var hourly = todayData.byDepartment[dept] && todayData.byDepartment[dept].hourly;
      var hourlyInHours = hourly ? filterByBusinessHours(hourly, todayData.businessDate) : [];
      var values = [];
      for (var i = 0; i < timeSlots.length; i++) {
        var h = hourlyInHours && hourlyInHours.length ? findHour(hourlyInHours, timeSlots[i].timeKey) : null;
        values.push(h ? (h.netSales || 0) : 0);
      }
      deptDatasets.push({ name: dept, values: values, color: DEPARTMENT_COLORS[d % DEPARTMENT_COLORS.length] });
    }
    if (deptDatasets.length === 0) return null;
    return { timeLabels: timeLabels, timeSlots: timeSlots, deptDatasets: deptDatasets };
  }

  function renderComposition(compositionData) {
    var section = document.getElementById('composition-section');
    var list = document.getElementById('composition-list');
    if (!section || !list) return;
    if (!compositionData || !compositionData.timeLabels.length || !compositionData.deptDatasets.length) {
      lastCompositionData = null;
      section.classList.add('hidden');
      if (chartInstances.composition) {
        chartInstances.composition.destroy();
        chartInstances.composition = null;
      }
      list.innerHTML = '';
      return;
    }
    section.classList.remove('hidden');
    var deptDatasets = compositionData.deptDatasets || [];
    var timeSlots = compositionData.timeSlots || [];
    var grandTotal = 0;
    var items = deptDatasets.map(function (d) {
      var total = 0;
      var peak = 0;
      for (var i = 0; i < d.values.length; i++) {
        var v = d.values[i] || 0;
        total += v;
        if (v > peak) peak = v;
      }
      grandTotal += total;
      return { name: d.name, values: d.values || [], total: total, peak: peak };
    });
    items.sort(function (a, b) {
      var az = a.total <= 0 ? 1 : 0;
      var bz = b.total <= 0 ? 1 : 0;
      if (az !== bz) return az - bz;
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });

    if (chartInstances.composition) {
      chartInstances.composition.destroy();
      chartInstances.composition = null;
    }

    function deptTone(name) {
      var toneMap = {
        'Fruit & Vegetable': { bg: '#eef9f0', border: '#9dd7ab', accent: '#22a352', details: '#f6fcf7', peak: '#dbf4e2' }, // green
        'Grocery': { bg: '#fefce8', border: '#fde047', accent: '#a16207', details: '#fffbeb', peak: '#fef3c7' }, // yellow
        'Delicatessen': { bg: '#fff5eb', border: '#fdba74', accent: '#ea580c', details: '#fffaf5', peak: '#ffe9d2' }, // orange
        'Fish & Seafood': { bg: '#eef8ff', border: '#93c5fd', accent: '#0284c7', details: '#f5fbff', peak: '#deefff' }, // light blue
        'Meat': { bg: '#fff0f6', border: '#f9a8d4', accent: '#db2777', details: '#fff7fb', peak: '#ffe2f0' }, // pink
        'Store Management': { bg: '#ffffff', border: '#e5e7eb', accent: '#6b7280', details: '#ffffff', peak: '#f3f4f6' } // white
      };
      return toneMap[name] || { bg: '#ffffff', border: '#e5e7eb', accent: '#2563eb', details: '#f8fbff', peak: '#e7f0ff' };
    }
    lastCompositionData = compositionData;

    var html = '';
    for (var di = 0; di < items.length; di++) {
      var item = items[di];
      var share = grandTotal > 0 ? (item.total / grandTotal * 100) : 0;
      var isZero = item.total <= 0;
      var cardClass = 'composition-item' + (isZero ? ' is-zero' : '');
      var tone = deptTone(item.name);
      var style = '--comp-bg:' + tone.bg + ';--comp-border:' + tone.border + ';--comp-accent:' + tone.accent + ';--comp-details:' + tone.details + ';--comp-peak:' + tone.peak + ';';
      html += '<div class="' + cardClass + '" style="' + style + '">' +
        '<button type="button" class="composition-summary" data-dept="' + item.name + '" aria-expanded="false">' +
        '<span class="composition-dept">' + getDepartmentDisplayName(item.name) + '</span>' +
        '<span class="composition-total">' + formatMoney(item.total) + '</span>' +
        '<span class="composition-share-badge">' + share.toFixed(1) + '%</span>' +
        '<span class="composition-chevron">v</span>' +
        '</button>' +
        '<div class="composition-details" hidden>';
      var hasNonZero = false;
      for (var ti = 0; ti < timeSlots.length; ti++) {
        var slot = timeSlots[ti];
        var val = item.values[ti] || 0;
        if (val <= 0) continue;
        hasNonZero = true;
        var widthPct = item.peak > 0 ? Math.max(4, Math.round((val / item.peak) * 100)) : 0;
        var isPeak = item.peak > 0 && val === item.peak;
        var rowCls = 'composition-time-row' + (isPeak ? ' is-peak' : '');
        var timeLabel = (slot.timeKey || '').split('-')[0] || (slot.timeLabel || '');
        html += '<div class="' + rowCls + '">' +
          '<span class="composition-time-label">' + timeLabel + '</span>' +
          '<span class="composition-peak">' + (isPeak ? 'Peak!' : '') + '</span>' +
          '<span class="composition-time-value">' + formatMoney(val) + '</span>' +
          '<span class="composition-time-bar"><span class="composition-time-bar-fill" style="width:' + widthPct + '%"></span></span>' +
          '</div>';
      }
      if (!hasNonZero) {
        html += '<div class="composition-time-row"><span class="composition-time-label">—</span><span class="composition-peak"></span><span class="composition-time-value">' + t('no_actual_data') + '</span><span class="composition-time-bar"></span></div>';
      }
      html += '</div></div>';
    }
    list.innerHTML = html;

    list.querySelectorAll('.composition-summary').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var details = btn.nextElementSibling;
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        var chev = btn.querySelector('.composition-chevron');
        if (chev) chev.textContent = expanded ? 'v' : '^';
        if (details) details.hidden = expanded;
        selectedCompositionDept = expanded ? null : btn.getAttribute('data-dept');
        var mainDept = (function () { var el = document.getElementById('department-select'); return el ? el.value : 'Total'; }());
        renderDepartmentProductBreakdown(state.today, mainDept);
        syncInsightsSplitHeight();
      });
    });
    syncInsightsSplitHeight();
  }

  function updateCompositionTableHead(compositionData, isNarrow) {
    var thead = document.querySelector('#composition-table thead tr');
    if (!thead || !compositionData || !compositionData.deptDatasets) return;
    var deptDatasets = compositionData.deptDatasets;
    var timeLabel = isNarrow ? (t('time_range_col_short') || t('time_range_col')) : t('time_range_col');
    var totalLabel = isNarrow ? (t('total_short') || t('total')) : t('total');
    var theadHtml = '<th>' + timeLabel + '</th>';
    for (var idx = 0; idx < deptDatasets.length; idx++) {
      var name = deptDatasets[idx].name;
      theadHtml += '<th>' + (isNarrow ? (DEPT_SHORT[name] || name) : name) + '</th>';
    }
    theadHtml += '<th>' + totalLabel + '</th>';
    thead.innerHTML = theadHtml;
  }

  function getCompositionDisplayTimeLabels(compositionData, isNarrow) {
    if (!compositionData || !compositionData.timeSlots) return compositionData ? (compositionData.timeLabels || []) : [];
    if (!isNarrow) return compositionData.timeLabels || [];
    return compositionData.timeSlots.map(function (h) {
      var k = (h.timeKey || '').trim();
      var start = k.indexOf('-') >= 0 ? k.split('-')[0].trim() : k;
      return start || (h.timeLabel || '');
    });
  }

  function renderCompositionTableBody(compositionData, viewMode, isNarrow) {
    var tbody = document.getElementById('composition-tbody');
    var tfoot = document.getElementById('composition-tfoot');
    if (!compositionData || !tbody) return;
    var timeLabels = compositionData.timeLabels || [];
    var deptDatasets = compositionData.deptDatasets || [];
    var displayTimeLabels = getCompositionDisplayTimeLabels(compositionData, isNarrow);
    var fmtAmount = isNarrow ? formatCurrencyInteger : formatCurrency;

    tbody.innerHTML = '';
    for (var i = 0; i < timeLabels.length; i++) {
      var slotTotal = 0;
      for (var j = 0; j < deptDatasets.length; j++) slotTotal += deptDatasets[j].values[i] || 0;
      var row = '<tr><td>' + (displayTimeLabels[i] != null ? displayTimeLabels[i] : timeLabels[i]) + '</td>';
      for (var k = 0; k < deptDatasets.length; k++) {
        var v = deptDatasets[k].values[i] || 0;
        if (viewMode === 'amount') {
          row += '<td>' + fmtAmount(v) + '</td>';
        } else {
          var pctVal = slotTotal > 0 ? (v / slotTotal) * 100 : 0;
          row += '<td>' + (isNarrow ? Math.round(pctVal) : pctVal.toFixed(1)) + '%</td>';
        }
      }
      row += '<td>' + fmtAmount(slotTotal) + '</td></tr>';
      tbody.insertAdjacentHTML('beforeend', row);
    }

    if (tfoot && deptDatasets.length) {
      var deptTotals = [];
      var grandTotal = 0;
      for (var d = 0; d < deptDatasets.length; d++) {
        var sum = 0;
        for (var s = 0; s < deptDatasets[d].values.length; s++) sum += deptDatasets[d].values[s] || 0;
        deptTotals.push(sum);
        grandTotal += sum;
      }
      var totalLabel = isNarrow ? (t('total_short') || t('total')) : t('total');
      var footRow = '<tr><td>' + totalLabel + '</td>';
      for (var n = 0; n < deptTotals.length; n++) {
        if (viewMode === 'amount') {
          footRow += '<td>' + fmtAmount(deptTotals[n]) + '</td>';
        } else {
          var pctVal = grandTotal > 0 ? (deptTotals[n] / grandTotal) * 100 : 0;
          footRow += '<td>' + (isNarrow ? Math.round(pctVal) : pctVal.toFixed(1)) + '%</td>';
        }
      }
      footRow += '<td>' + fmtAmount(grandTotal) + '</td></tr>';
      tfoot.innerHTML = footRow;
    }
  }

  function updateCompositionTabState() {
    var tabAmount = document.getElementById('composition-tab-amount');
    var tabPercent = document.getElementById('composition-tab-percent');
    if (tabAmount) {
      tabAmount.classList.toggle('active', compositionViewMode === 'amount');
      tabAmount.setAttribute('aria-selected', compositionViewMode === 'amount' ? 'true' : 'false');
    }
    if (tabPercent) {
      tabPercent.classList.toggle('active', compositionViewMode === 'percent');
      tabPercent.setAttribute('aria-selected', compositionViewMode === 'percent' ? 'true' : 'false');
    }
  }

  function computeCumulative(values) {
    var out = [];
    var cum = 0;
    for (var i = 0; i < values.length; i++) {
      cum += values[i] || 0;
      out.push(cum);
    }
    return out;
  }

  var THAILAND_TZ = 'Asia/Bangkok';

  function getThailandDateStr() {
    return new Date().toLocaleDateString('en-CA', { timeZone: THAILAND_TZ });
  }

  function getThailandTimeStr() {
    return new Date().toLocaleTimeString('en-GB', { timeZone: THAILAND_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function getLastActualIndex(values) {
    for (var i = values.length - 1; i >= 0; i--) {
      if (values[i] != null && Number(values[i]) > 0) return i;
    }
    return values.length - 1;
  }

  /** Last slot index whose end time <= thailandTimeStr (HH:MM). Uses Thailand time so forecast anchor is stable across hour boundaries. */
  function getLastActualIndexByThailandTime(timeSlots, thailandTimeStr) {
    if (!timeSlots || !timeSlots.length || !thailandTimeStr) return timeSlots ? timeSlots.length - 1 : 0;
    var t = String(thailandTimeStr).trim();
    for (var i = timeSlots.length - 1; i >= 0; i--) {
      var timeKey = timeSlots[i].timeKey || '';
      var endTime = timeKey.indexOf('-') >= 0 ? timeKey.split('-')[1].trim() : '';
      if (endTime && endTime <= t) return i;
    }
    return 0;
  }

  function lerp(i, i0, v0, i1, v1) {
    if (i1 === i0) return v0;
    return v0 + (v1 - v0) * (i - i0) / (i1 - i0);
  }

  function buildForecastChartDataActualOnly(todayValues, todayHourly, thailandTimeStr) {
    var n = todayValues.length;
    if (n === 0) return { actualCum: [], forecastLine: [], forecastLower: [], forecastUpper: [], lastActual: 0 };
    var cum = computeCumulative(todayValues);
    var lastActual = (todayHourly && thailandTimeStr) ? getLastActualIndexByThailandTime(todayHourly, thailandTimeStr) : getLastActualIndex(todayValues);
    var actualCum = [];
    var forecastLine = [];
    var forecastLower = [];
    var forecastUpper = [];
    for (var i = 0; i < n; i++) {
      actualCum.push(i <= lastActual ? cum[i] : null);
      forecastLine.push(i <= lastActual ? cum[i] : null);
      forecastLower.push(i <= lastActual ? cum[i] : null);
      forecastUpper.push(i <= lastActual ? cum[i] : null);
    }
    return { actualCum: actualCum, forecastLine: forecastLine, forecastLower: forecastLower, forecastUpper: forecastUpper, lastActual: lastActual };
  }

  function buildOneForecastFromAI(cum, lastActual, n, forecastTotal, forecastLow, forecastHigh) {
    var actualCum = [], forecastLine = [], forecastLower = [], forecastUpper = [];
    for (var i = 0; i < n; i++) {
      actualCum.push(i <= lastActual ? cum[i] : null);
      if (i < lastActual) {
        forecastLine.push(null);
        forecastLower.push(null);
        forecastUpper.push(null);
      } else {
        var val = i === lastActual ? cum[lastActual] : lerp(i, lastActual, cum[lastActual], n - 1, forecastTotal);
        forecastLine.push(val);
        forecastLower.push(i === lastActual ? cum[lastActual] : lerp(i, lastActual, cum[lastActual], n - 1, forecastLow));
        forecastUpper.push(i === lastActual ? cum[lastActual] : lerp(i, lastActual, cum[lastActual], n - 1, forecastHigh));
      }
    }
    return { actualCum: actualCum, forecastLine: forecastLine, forecastLower: forecastLower, forecastUpper: forecastUpper, lastActual: lastActual };
  }

  function buildForecastChartDataFromAI(aiData, todayNet, todayReceipts, todayHourly, thailandTimeStr) {
    var n = todayNet.length;
    if (n === 0) return { sales: null, receipts: null };
    var cumNet = computeCumulative(todayNet);
    var cumRcpt = computeCumulative(todayReceipts);
    var lastActual = (todayHourly && thailandTimeStr) ? getLastActualIndexByThailandTime(todayHourly, thailandTimeStr) : Math.max(getLastActualIndex(todayNet), getLastActualIndex(todayReceipts));
    var forecastTotalNet = Math.max(Number(aiData.forecastTotalNetSales) || 0, cumNet[lastActual] || 0);
    var forecastLowNet = Math.max(Number(aiData.forecastLowNetSales) || 0, cumNet[lastActual] || 0);
    var forecastHighNet = Math.max(Number(aiData.forecastHighNetSales) || 0, forecastTotalNet);
    var forecastTotalRcpt = Math.max(Number(aiData.forecastTotalReceipts) || 0, cumRcpt[lastActual] || 0);
    var forecastLowRcpt = Math.max(Number(aiData.forecastLowReceipts) || 0, cumRcpt[lastActual] || 0);
    var forecastHighRcpt = Math.max(Number(aiData.forecastHighReceipts) || 0, forecastTotalRcpt);
    return {
      sales: buildOneForecastFromAI(cumNet, lastActual, n, forecastTotalNet, forecastLowNet, forecastHighNet),
      receipts: buildOneForecastFromAI(cumRcpt, lastActual, n, forecastTotalRcpt, forecastLowRcpt, forecastHighRcpt)
    };
  }

  function renderCharts(todayHourly, yesterdayHourly, lastWeekHourly, optionalForecast, useReceipts) {
    if (typeof Chart === 'undefined' || !todayHourly || !todayHourly.length) return;
    if (useReceipts === undefined) useReceipts = true;
    destroyCharts();
    var labels = todayHourly.map(function (h) { return h.timeLabel || h.timeKey || ''; });
    var todayNet = todayHourly.map(function (h) { return h.netSales || 0; });
    var todayReceipts = todayHourly.map(function (h) { return h.receiptCount || 0; });
    var yesterdayNet = todayHourly.map(function (h) {
      var y = findHour(yesterdayHourly, h.timeKey);
      return y ? (y.netSales || 0) : null;
    });
    var yesterdayReceipts = todayHourly.map(function (h) {
      var y = findHour(yesterdayHourly, h.timeKey);
      return y ? (y.receiptCount || 0) : null;
    });
    var lastWeekNet = todayHourly.map(function (h) {
      var w = findHour(lastWeekHourly, h.timeKey);
      return w ? (w.netSales || 0) : null;
    });
    var lastWeekReceipts = todayHourly.map(function (h) {
      var w = findHour(lastWeekHourly, h.timeKey);
      return w ? (w.receiptCount || 0) : null;
    });

    var salesCanvas = document.getElementById('chart-sales');
    var receiptsCanvas = document.getElementById('chart-receipts');
    var forecastSalesCanvas = document.getElementById('chart-forecast-sales');
    var forecastReceiptsCanvas = document.getElementById('chart-forecast-receipts');
    if (!salesCanvas || !forecastSalesCanvas) return;
    if (useReceipts && !forecastReceiptsCanvas) return;

    var hasYesterday = yesterdayHourly && yesterdayHourly.length > 0;
    var hasLastWeek = lastWeekHourly && lastWeekHourly.length > 0;
    function numericSorted(arr) {
      return arr.filter(function (v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }).sort(function (a, b) { return a - b; });
    }

    var moneyRate = getCurrencyCode() === 'JPY' ? (getExchangeRate() || 1) : 1;
    function convertSeries(arr) {
      return arr.map(function (v) { return v == null ? null : v * moneyRate; });
    }
    var todayNetDisplay = convertSeries(todayNet);
    var yesterdayNetDisplay = convertSeries(yesterdayNet);
    var lastWeekNetDisplay = convertSeries(lastWeekNet);
    var todayPositive = numericSorted(todayNetDisplay);
    var refPositive = numericSorted([].concat(yesterdayNetDisplay || [], lastWeekNetDisplay || []));
    var allPositive = numericSorted([].concat(todayNetDisplay || [], yesterdayNetDisplay || [], lastWeekNetDisplay || []));
    var overallMax = allPositive.length ? allPositive[allPositive.length - 1] : 0;
    var median = allPositive.length ? allPositive[Math.floor(allPositive.length / 2)] : 0;
    var todayMax = todayPositive.length ? todayPositive[todayPositive.length - 1] : 0;
    var hasAnomalousScale = overallMax > 0 && median > 0 && overallMax >= median * 4 && todayMax <= overallMax * 0.4;
    var chartAnomalyNote = document.getElementById('chart-anomaly-note');
    if (chartAnomalyNote) {
      chartAnomalyNote.hidden = !hasAnomalousScale;
      chartAnomalyNote.textContent = hasAnomalousScale ? t('chart_anomaly_note') : '';
    }

    var CHART_OPTS = {
      color: '#6b7280',
      grid: 'rgba(0,0,0,0.06)',
      today:     { bg: 'rgba(29,78,216,0.80)',   border: 'rgb(29,78,216)' },
      yesterday: { bg: 'rgba(251,146,60,0.70)',  border: 'rgb(251,146,60)' },
      lastWeek:  { bg: 'rgba(156,163,175,0.55)', border: 'rgb(156,163,175)' },
      receipts:  { bg: 'rgba(22,163,74,0.75)',   border: 'rgb(22,163,74)' },
      forecast:  { line: 'rgb(217,119,6)',  band: 'rgba(217,119,6,0.10)' },
      actual:    { line: 'rgb(29,78,216)',  fill: 'rgba(29,78,216,0.07)' }
    };
    var chartScaleDefaults = {
      grid: { color: CHART_OPTS.grid },
      ticks: { color: CHART_OPTS.color },
      title: { color: CHART_OPTS.color }
    };

    var salesDatasets = [
      { label: t('today'), data: todayNetDisplay, backgroundColor: CHART_OPTS.today.bg, borderColor: CHART_OPTS.today.border, borderWidth: 1 }
    ];
    if (hasYesterday) {
      salesDatasets.push({ label: t('yesterday'), data: yesterdayNetDisplay, backgroundColor: CHART_OPTS.yesterday.bg, borderColor: CHART_OPTS.yesterday.border, borderWidth: 1 });
    }
    if (hasLastWeek) {
      salesDatasets.push({ label: t('last_week'), data: lastWeekNetDisplay, backgroundColor: CHART_OPTS.lastWeek.bg, borderColor: CHART_OPTS.lastWeek.border, borderWidth: 1 });
    }

    chartInstances.sales = new Chart(salesCanvas, {
      type: 'bar',
      data: { labels: labels, datasets: salesDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top', labels: { color: CHART_OPTS.color } } },
        scales: {
          x: Object.assign({ title: { display: true, text: 'Time Slot' } }, chartScaleDefaults),
          y: Object.assign({ beginAtZero: true, type: hasAnomalousScale ? 'logarithmic' : 'linear', title: { display: true, text: 'Net Sales (' + getCurrencyLabel() + ')' } }, chartScaleDefaults)
        }
      }
    });

    if (receiptsCanvas) {
      var receiptDatasets = [
        { label: t('today'), data: todayReceipts, backgroundColor: CHART_OPTS.receipts.bg, borderColor: CHART_OPTS.receipts.border, borderWidth: 1 }
      ];
      if (hasYesterday) {
        receiptDatasets.push({ label: t('yesterday'), data: yesterdayReceipts, backgroundColor: CHART_OPTS.yesterday.bg, borderColor: CHART_OPTS.yesterday.border, borderWidth: 1 });
      }
      if (hasLastWeek) {
        receiptDatasets.push({ label: t('last_week'), data: lastWeekReceipts, backgroundColor: CHART_OPTS.lastWeek.bg, borderColor: CHART_OPTS.lastWeek.border, borderWidth: 1 });
      }
      chartInstances.receipts = new Chart(receiptsCanvas, {
        type: 'bar',
        data: { labels: labels, datasets: receiptDatasets },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { position: 'top', labels: { color: CHART_OPTS.color } } },
          scales: {
            x: Object.assign({ title: { display: true, text: t('time_slot') } }, chartScaleDefaults),
            y: Object.assign({ beginAtZero: true, title: { display: true, text: t('receipt_count') } }, chartScaleDefaults)
          }
        }
      });
    }
    setHourlyChartTab(hourlyChartView);

    var isReferenceToday = (state.referenceDate === getThailandDateStr());
    var thailandNow = isReferenceToday ? getThailandTimeStr() : null;
    var forecastSalesDataRaw = (optionalForecast && optionalForecast.forecastSalesData) ? optionalForecast.forecastSalesData : buildForecastChartDataActualOnly(todayNet, todayHourly, thailandNow);
    var forecastSalesData = {
      forecastLower: convertSeries(forecastSalesDataRaw.forecastLower),
      forecastUpper: convertSeries(forecastSalesDataRaw.forecastUpper),
      forecastLine: convertSeries(forecastSalesDataRaw.forecastLine),
      actualCum: convertSeries(forecastSalesDataRaw.actualCum),
      lastActual: forecastSalesDataRaw.lastActual
    };
    var hasForecastFuture = forecastSalesData.lastActual < labels.length - 1;
    var forecastStatusNote = document.getElementById('forecast-status-note');
    if (forecastStatusNote) {
      forecastStatusNote.hidden = hasForecastFuture;
      forecastStatusNote.textContent = hasForecastFuture ? '' : t('forecast_no_data');
    }
    var forecastReceiptsData = (optionalForecast && optionalForecast.forecastReceiptsData) ? optionalForecast.forecastReceiptsData : buildForecastChartDataActualOnly(todayReceipts, todayHourly, thailandNow);

    chartInstances.forecastSales = new Chart(forecastSalesCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: t('forecast_band'),
            data: forecastSalesData.forecastLower,
            borderColor: 'transparent',
            backgroundColor: CHART_OPTS.forecast.band,
            fill: '+1',
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0.2,
            order: 0
          },
          {
            label: t('forecast_band_upper'),
            data: forecastSalesData.forecastUpper,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
            order: 1
          },
          {
            label: t('forecast_line'),
            data: forecastSalesData.forecastLine,
            borderColor: CHART_OPTS.forecast.line,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.2,
            order: 2
          },
          {
            label: t('actual_cumulative'),
            data: forecastSalesData.actualCum,
            borderColor: CHART_OPTS.actual.line,
            backgroundColor: CHART_OPTS.actual.fill,
            borderWidth: 2,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.2,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: CHART_OPTS.color,
              filter: function (item) {
                if (!hasForecastFuture) return item.datasetIndex === 3;
                return item.datasetIndex !== 1;
              }
            }
          },
          tooltip: {
            callbacks: {
              afterBody: function (ctx) {
                var i = ctx[0].dataIndex;
                if (i === forecastSalesData.lastActual && forecastSalesData.lastActual < labels.length - 1) {
                  return ' — ' + (t('forecast_from_here') || 'Forecast from here');
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: Object.assign({ title: { display: true, text: t('time_slot') } }, chartScaleDefaults),
          y: Object.assign({ beginAtZero: true, title: { display: true, text: 'Net Sales (' + getCurrencyLabel() + ')' } }, chartScaleDefaults)
        }
      }
    });

    if (useReceipts && forecastReceiptsCanvas) {
      chartInstances.forecastReceipts = new Chart(forecastReceiptsCanvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: t('forecast_band'),
              data: forecastReceiptsData.forecastLower,
            borderColor: 'transparent',
            backgroundColor: 'rgba(234, 88, 12, 0.15)',
            fill: '+1',
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0.2,
            order: 0
          },
          {
            label: t('forecast_band_upper'),
            data: forecastReceiptsData.forecastUpper,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
            order: 1
          },
          {
            label: t('forecast_line'),
            data: forecastReceiptsData.forecastLine,
            borderColor: CHART_OPTS.forecast.line,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.2,
            order: 2
          },
          {
            label: t('actual_cumulative'),
            data: forecastReceiptsData.actualCum,
            borderColor: CHART_OPTS.actual.line,
            backgroundColor: CHART_OPTS.actual.fill,
            borderWidth: 2,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.2,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: CHART_OPTS.color,
              filter: function (item) {
                if (forecastReceiptsData.lastActual >= labels.length - 1) return item.datasetIndex === 3;
                return item.datasetIndex !== 1;
              }
            }
          },
          tooltip: {
            callbacks: {
              afterBody: function (ctx) {
                var i = ctx[0].dataIndex;
                if (i === forecastReceiptsData.lastActual && forecastReceiptsData.lastActual < labels.length - 1) {
                  return ' — ' + (t('forecast_from_here') || 'Forecast from here');
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: Object.assign({ title: { display: true, text: t('time_slot') } }, chartScaleDefaults),
          y: Object.assign({ beginAtZero: true, title: { display: true, text: t('forecast_total_count') } }, chartScaleDefaults)
        }
      }
    });
    }
    setForecastChartTab(forecastChartView);
  }

  function getHourlyData(data, department) {
    if (!data) return null;
    if (department === 'Total') return data.total.hourly;
    if (data.byDepartment && data.byDepartment[department]) return data.byDepartment[department].hourly;
    return null;
  }

  function getSelectedStoreName() {
    var id = getSelectedStoreId();
    var list = state.stores && state.stores.length ? state.stores : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].name || id;
    }
    var sel = document.getElementById('store-select');
    if (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) return sel.options[sel.selectedIndex].textContent || id;
    return id || '—';
  }

  function updateHourlyFiltersSummaryBar() {
    var summaryEl = document.getElementById('hourly-filters-summary');
    if (!summaryEl) return;
    var storeEl = document.getElementById('store-select');
    var deptEl = document.getElementById('department-select');
    var dateEl = document.getElementById('output-date');
    var storeText = storeEl && storeEl.options && storeEl.selectedIndex >= 0 ? (storeEl.options[storeEl.selectedIndex].textContent || storeEl.value || '') : '';
    var deptText = deptEl ? (deptEl.value || '') : '';
    var dateText = dateEl ? (dateEl.value || '') : '';
    var items = [
      { label: t('store') || 'Store', value: storeText },
      { label: t('department') || 'Dept', value: deptText },
      { label: t('output_date') || 'Date', value: dateText }
    ].filter(function (item) { return !!item.value; });
    summaryEl.innerHTML = '';
    if (!items.length) {
      summaryEl.textContent = '—';
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('span');
      row.className = 'hourly-filter-summary-item';
      var labelEl = document.createElement('span');
      labelEl.className = 'hourly-filter-summary-label';
      labelEl.textContent = item.label;
      var valueEl = document.createElement('span');
      valueEl.className = 'hourly-filter-summary-value';
      valueEl.textContent = item.value;
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      summaryEl.appendChild(row);
    });
  }

  function formatDepartmentPrefixedLabel(baseLabel) {
    var deptLabel = t('department') || 'Department';
    var lang = (window.i18n && typeof window.i18n.getCurrentLang === 'function')
      ? (window.i18n.getCurrentLang() || 'ja')
      : 'ja';
    return lang === 'ja' ? (deptLabel + baseLabel) : (deptLabel + ' ' + baseLabel);
  }

  function getDepartmentMetricLabel(key, fallbackLabel) {
    if (key === 'snapshot_net_sales') return t('dept_metric_net_sales');
    if (key === 'qty_sold_short') return t('dept_metric_qty');
    if (key === 'sales_per_hour') return t('dept_metric_sales_per_hour');
    if (key === 'unit_per_txn') return t('dept_metric_unit_per_txn');
    if (key === 'avg_selling_price') return t('dept_metric_avg_price');
    return formatDepartmentPrefixedLabel(fallbackLabel);
  }

  function updateSnapshotMetricLabels(isTotal) {
    var card = document.getElementById('snapshot-card');
    if (!card) return;
    var defs = [
      { selector: '#snapshot-net-label', key: 'snapshot_net_sales', fallback: 'Net Sales' },
      { selector: '[data-i18n="qty_sold_short"]', key: 'qty_sold_short', fallback: 'Qty Sold' },
      { selector: '[data-i18n="receipt_count"]', key: 'receipt_count', fallback: 'Receipt Count' },
      { selector: '[data-i18n="sales_per_hour"]', key: 'sales_per_hour', fallback: 'Sales per Hour' },
      { selector: '[data-i18n="txn_per_hour"]', key: 'txn_per_hour', fallback: 'Transaction per Hour' },
      { selector: '[data-i18n="unit_per_txn"]', key: 'unit_per_txn', fallback: 'Unit Per Transaction' },
      { selector: '[data-i18n="avg_txn_price"]', key: 'avg_txn_price', fallback: 'Average Transaction Price' },
      { selector: '[data-i18n="avg_selling_price"]', key: 'avg_selling_price', fallback: 'Average Selling Price' }
    ];
    defs.forEach(function (d) {
      var el = card.querySelector(d.selector);
      if (!el) return;
      var baseLabel = t(d.key) || d.fallback;
      el.textContent = isTotal ? baseLabel : getDepartmentMetricLabel(d.key, baseLabel);
    });
  }

  function fmtDodWow(dod, wow) {
    var parts = [];
    if (dod != null && dod !== '') parts.push('DoD ' + dod);
    if (wow != null && wow !== '') parts.push('WoW ' + wow);
    return parts.length ? parts.join(' ') : '';
  }

  function fmtTrendBadgeHtml(pct, label) {
    var noDataReason = String(label || '').toLowerCase().indexOf('wow') !== -1
      ? (t('no_last_week_data') || '先週データなし')
      : (t('no_prev_data') || '前日データなし');
    if (pct == null) {
      return '<span class="snapshot-trend-item neutral">' +
        '<span class="snapshot-trend-main" title="' + escapeHtml(noDataReason) + '">-</span>' +
        '<span class="snapshot-trend-label">' + label + '</span>' +
      '</span>';
    }
    var n = Math.round(Number(pct));
    if (!Number.isFinite(n)) {
      return '<span class="snapshot-trend-item neutral">' +
        '<span class="snapshot-trend-main" title="' + escapeHtml(noDataReason) + '">-</span>' +
        '<span class="snapshot-trend-label">' + label + '</span>' +
      '</span>';
    }
    var up = n >= 100;
    var arrow = up ? '▲' : '▼';
    return '<span class="snapshot-trend-item ' + (up ? 'up' : 'down') + '">' +
      '<span class="snapshot-trend-main">' + arrow + ' ' + n + '%</span>' +
      '<span class="snapshot-trend-label">' + label + '</span>' +
    '</span>';
  }

  function filterByThailandCurrentTime(hourly, thailandTimeStr) {
    if (!hourly || !hourly.length || !thailandTimeStr) return [];
    var t = String(thailandTimeStr).trim();
    return hourly.filter(function (h) {
      var timeKey = h.timeKey || '';
      var endTime = timeKey.indexOf('-') >= 0 ? timeKey.split('-')[1].trim() : '';
      return endTime && endTime <= t;
    });
  }

  function applySnapshotDetailVisibility() {
    var isMobile = typeof window !== 'undefined' && window.innerWidth <= 767;
    var shouldShowDetails = isMobile ? showDetailedKpis : true;
    var detailIds = ['snapshot-txn-per-hour', 'snapshot-unit-per-txn', 'snapshot-avg-txn-price', 'snapshot-avg-selling-price'];
    detailIds.forEach(function (id) {
      var valueEl = document.getElementById(id);
      var panel = valueEl ? valueEl.closest('.snapshot-panel') : null;
      if (!panel) return;
      panel.classList.toggle('is-collapsed-detail', !shouldShowDetails);
    });
  }

  function renderSnapshotCard(storeName, dept, referenceDate, todayHourly, yesterdayHourly, lastWeekHourly, isTotal, todayData, startTime, endTime, sumToday, sumYesterday, sumLastWeek) {
    var card = document.getElementById('snapshot-card');
    if (!card) return;
    if (!todayHourly || !todayHourly.length) {
      card.hidden = true;
      return;
    }
    // テーブル（rowsHourly）と同じ基準: netSales > 0 のスロットのみ
    // yesterdayHourly/lastWeekHourly は renderReport で todayKeySet 済みのため再フィルタ不要
    var useSameTimeBaseline = false;
    var compareTodayHourly = (todayHourly || []).filter(function (h) { return (h.netSales || 0) > 0; });
    var compareYesterdayHourly = yesterdayHourly;
    var compareLastWeekHourly = lastWeekHourly;

    var netSum = 0, qtySum = 0, receiptSum = 0;
    compareTodayHourly.forEach(function (h) {
      netSum += h.netSales || 0;
      qtySum += h.quantitySold || 0;
      receiptSum += h.receiptCount || 0;
    });
    function sumSnapshotBase(hourly) {
      if (!hourly || !hourly.length) return null;
      var out = { netSum: 0, qtySum: 0, receiptSum: 0 };
      hourly.forEach(function (h) {
        out.netSum += h.netSales || 0;
        out.qtySum += h.quantitySold || 0;
        out.receiptSum += h.receiptCount || 0;
      });
      return out;
    }
    var baseYesterday = sumSnapshotBase(compareYesterdayHourly);
    var baseLastWeek = sumSnapshotBase(compareLastWeekHourly);
    updateSnapshotMetricLabels(isTotal);
    card.hidden = false;
    card.classList.toggle('snapshot-non-total', !isTotal);
    card.classList.toggle('snapshot-total', !!isTotal);
    var netEl = document.getElementById('snapshot-net');
    var qtyEl = document.getElementById('snapshot-qty');
    var receiptsEl = document.getElementById('snapshot-receipts');
    var panelReceipts = receiptsEl ? receiptsEl.closest('.snapshot-panel') : null;
    var txnPerHourEl = document.getElementById('snapshot-txn-per-hour');
    var unitPerTxnEl = document.getElementById('snapshot-unit-per-txn');
    var avgTxnPriceEl = document.getElementById('snapshot-avg-txn-price');
    var panelTxnPerHour = txnPerHourEl ? txnPerHourEl.closest('.snapshot-panel') : null;
    var panelUnitPerTxn = unitPerTxnEl ? unitPerTxnEl.closest('.snapshot-panel') : null;
    var panelAvgTxnPrice = avgTxnPriceEl ? avgTxnPriceEl.closest('.snapshot-panel') : null;
    var panelShare = document.getElementById('snapshot-panel-share');
    var panelRank = document.getElementById('snapshot-panel-rank');
    var shareEl = document.getElementById('snapshot-share');
    var shareSubEl = panelShare ? panelShare.querySelector('.snapshot-panel-sub') : null;
    var rankEl = document.getElementById('snapshot-rank');
    if (netEl) netEl.textContent = formatMoney(netSum);
    if (qtyEl) qtyEl.textContent = formatInt(qtySum);
    if (receiptsEl) receiptsEl.textContent = formatInt(receiptSum);
    if (panelReceipts) {
      var showReceiptCard = !!isTotal;
      panelReceipts.style.display = showReceiptCard ? '' : 'none';
    }
    if (panelTxnPerHour) panelTxnPerHour.style.display = isTotal ? '' : 'none';
    if (panelUnitPerTxn) panelUnitPerTxn.style.display = '';
    if (panelAvgTxnPrice) panelAvgTxnPrice.style.display = isTotal ? '' : 'none';
    if (panelShare) panelShare.style.display = 'none';
    if (panelRank) panelRank.style.display = 'none';
    if (shareEl) shareEl.textContent = '—';
    if (shareSubEl) shareSubEl.innerHTML = '';
    if (rankEl) rankEl.textContent = '—';
    applySnapshotDetailVisibility();

    function setSnapshotMetric(valueId, subId, val, yVal, wVal, formatter) {
      formatter = formatter || function (v) { return v != null ? String(v) : '—'; };
      var el = document.getElementById(valueId);
      var subEl = document.getElementById(subId);
      if (el) el.innerHTML = formatter(val);
      if (subEl) {
        var dodRaw = yVal != null && val != null ? pctRatio(val, yVal) : null;
        var wowRaw = wVal != null && val != null ? pctRatio(val, wVal) : null;
        subEl.innerHTML = fmtTrendBadgeHtml(dodRaw, t('dod')) + fmtTrendBadgeHtml(wowRaw, t('wow'));
      }
    }
    setSnapshotMetric(
      'snapshot-net',
      'snapshot-net-dodwow',
      netSum,
      baseYesterday ? baseYesterday.netSum : null,
      baseLastWeek ? baseLastWeek.netSum : null,
      function (v) { return v != null ? formatMoneyHtml(v) : '—'; }
    );
    setSnapshotMetric(
      'snapshot-qty',
      'snapshot-qty-dodwow',
      qtySum,
      baseYesterday ? baseYesterday.qtySum : null,
      baseLastWeek ? baseLastWeek.qtySum : null,
      function (v) { return v != null ? formatInt(v) : '—'; }
    );
    setSnapshotMetric(
      'snapshot-receipts',
      'snapshot-receipts-dodwow',
      receiptSum,
      baseYesterday ? baseYesterday.receiptSum : null,
      baseLastWeek ? baseLastWeek.receiptSum : null,
      function (v) { return v != null ? formatInt(v) : '—'; }
    );
    var sumTodayForSnapshot = useSameTimeBaseline ? computeSummary(compareTodayHourly, null, null) : sumToday;
    var sumYesterdayForSnapshot = useSameTimeBaseline ? computeSummary(compareYesterdayHourly, null, null) : sumYesterday;
    var sumLastWeekForSnapshot = useSameTimeBaseline ? computeSummary(compareLastWeekHourly, null, null) : sumLastWeek;
    if (sumTodayForSnapshot) {
      setSnapshotMetric('snapshot-sales-per-hour', 'snapshot-sales-per-hour-dodwow', sumTodayForSnapshot.salesPerHour, sumYesterdayForSnapshot && sumYesterdayForSnapshot.salesPerHour, sumLastWeekForSnapshot && sumLastWeekForSnapshot.salesPerHour, function (v) { return v != null ? formatMoneyHtml(v) : '—'; });
      setSnapshotMetric('snapshot-txn-per-hour', 'snapshot-txn-per-hour-dodwow', sumTodayForSnapshot.txnPerHour, sumYesterdayForSnapshot && sumYesterdayForSnapshot.txnPerHour, sumLastWeekForSnapshot && sumLastWeekForSnapshot.txnPerHour, function (v) { return v != null ? formatInt(Math.round(v)) : '—'; });
      setSnapshotMetric('snapshot-unit-per-txn', 'snapshot-unit-per-txn-dodwow', sumTodayForSnapshot.unitPerTxn, sumYesterdayForSnapshot && sumYesterdayForSnapshot.unitPerTxn, sumLastWeekForSnapshot && sumLastWeekForSnapshot.unitPerTxn, function (v) { return v != null ? v.toFixed(1) : '—'; });
      setSnapshotMetric('snapshot-avg-txn-price', 'snapshot-avg-txn-price-dodwow', sumTodayForSnapshot.avgTxnPrice, sumYesterdayForSnapshot && sumYesterdayForSnapshot.avgTxnPrice, sumLastWeekForSnapshot && sumLastWeekForSnapshot.avgTxnPrice, function (v) { return v != null ? formatMoneyHtml(v) : '—'; });
      setSnapshotMetric('snapshot-avg-selling-price', 'snapshot-avg-selling-price-dodwow', sumTodayForSnapshot.avgSellingPrice, sumYesterdayForSnapshot && sumYesterdayForSnapshot.avgSellingPrice, sumLastWeekForSnapshot && sumLastWeekForSnapshot.avgSellingPrice, function (v) { return v != null ? formatMoneyHtml(v) : '—'; });
    } else {
      setSnapshotMetric('snapshot-sales-per-hour', 'snapshot-sales-per-hour-dodwow', null, null, null);
      setSnapshotMetric('snapshot-txn-per-hour', 'snapshot-txn-per-hour-dodwow', null, null, null);
      setSnapshotMetric('snapshot-unit-per-txn', 'snapshot-unit-per-txn-dodwow', null, null, null);
      setSnapshotMetric('snapshot-avg-txn-price', 'snapshot-avg-txn-price-dodwow', null, null, null);
      setSnapshotMetric('snapshot-avg-selling-price', 'snapshot-avg-selling-price-dodwow', null, null, null);
    }

    if (!isTotal && todayData && todayData.total && todayData.total.hourly) {
      var totalHourly = filterByTimeRange(filterByBusinessHours(todayData.total.hourly, todayData.businessDate), startTime, endTime);
      if (useSameTimeBaseline) totalHourly = filterByThailandCurrentTime(totalHourly, thailandNowForSnapshot);
      var totalNet = 0;
      if (totalHourly && totalHourly.length) {
        totalHourly.forEach(function (h) { totalNet += h.netSales || 0; });
      }
      if (totalNet > 0 && shareEl) {
        var todayShare = (netSum / totalNet) * 100;
        var yShare = null;
        var wShare = null;
        var totalYesterdayHourly = state.yesterday && state.yesterday.total && state.yesterday.total.hourly
          ? filterByTimeRange(filterByBusinessHours(state.yesterday.total.hourly, state.yesterday.businessDate), startTime, endTime)
          : null;
        var totalLastWeekHourly = state.lastWeek && state.lastWeek.total && state.lastWeek.total.hourly
          ? filterByTimeRange(filterByBusinessHours(state.lastWeek.total.hourly, state.lastWeek.businessDate), startTime, endTime)
          : null;
        if (useSameTimeBaseline) {
          totalYesterdayHourly = filterByThailandCurrentTime(totalYesterdayHourly, thailandNowForSnapshot);
          totalLastWeekHourly = filterByThailandCurrentTime(totalLastWeekHourly, thailandNowForSnapshot);
        }
        var totalNetY = 0;
        var totalNetW = 0;
        if (totalYesterdayHourly && totalYesterdayHourly.length) {
          totalYesterdayHourly.forEach(function (h) { totalNetY += h.netSales || 0; });
        }
        if (totalLastWeekHourly && totalLastWeekHourly.length) {
          totalLastWeekHourly.forEach(function (h) { totalNetW += h.netSales || 0; });
        }
        if (baseYesterday && totalNetY > 0) yShare = (baseYesterday.netSum / totalNetY) * 100;
        if (baseLastWeek && totalNetW > 0) wShare = (baseLastWeek.netSum / totalNetW) * 100;
        shareEl.textContent = todayShare.toFixed(1) + '%';
        if (shareSubEl) {
          shareSubEl.innerHTML = fmtTrendBadgeHtml(pctRatio(todayShare, yShare), t('dod')) + fmtTrendBadgeHtml(pctRatio(todayShare, wShare), t('wow'));
        }
        if (panelShare) panelShare.style.display = '';
      }
    }

  }

  var BH_STORAGE_KEY = 'businessHours';
  var DEFAULT_BH = {};
  for (var d = 0; d <= 6; d++) DEFAULT_BH[d] = { start: '00:00', end: '24:00' };

  function getBusinessHoursSettings() {
    if (state.businessHoursSettings && typeof state.businessHoursSettings === 'object') return state.businessHoursSettings;
    try {
      var raw = typeof localStorage !== 'undefined' && localStorage.getItem(BH_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return DEFAULT_BH;
  }

  function parseJsonResponse(res) {
    var ct = (res.headers.get('Content-Type') || '').toLowerCase();
    return res.text().then(function (text) {
      if (ct.indexOf('application/json') !== -1 || (text.trim().charAt(0) === '{') || (text.trim().charAt(0) === '[')) {
        try { return JSON.parse(text); } catch (e) { throw new Error('Invalid JSON'); }
      }
      throw new Error('Server did not return JSON');
    });
  }

  function showLoading() {
    var el = document.getElementById('loading-overlay');
    if (el) { el.hidden = false; el.setAttribute('aria-busy', 'true'); }
    var hourlyLoadingEl = document.getElementById('hourly-loading-indicator');
    if (hourlyLoadingEl) hourlyLoadingEl.hidden = false;
  }

  function hideLoading() {
    var el = document.getElementById('loading-overlay');
    if (el) { el.hidden = true; el.setAttribute('aria-busy', 'false'); }
    var hourlyLoadingEl = document.getElementById('hourly-loading-indicator');
    if (hourlyLoadingEl) hourlyLoadingEl.hidden = true;
  }

  function downloadXlsx(filename, sheets) {
    if (!window.XLSX) { alert('Excel library not loaded.'); return; }
    var wb = window.XLSX.utils.book_new();
    sheets.forEach(function (s) {
      var ws = window.XLSX.utils.table_to_sheet(s.tableEl);
      window.XLSX.utils.book_append_sheet(wb, ws, s.sheetName);
    });
    window.XLSX.writeFile(wb, filename);
  }

  function exportPanelTablesXlsx(containerId, filename, selectedOption) {
    if (!window.XLSX) { alert('Excel library not loaded.'); return; }
    var container = document.getElementById(containerId);
    if (!container) return;
    var tables = container.querySelectorAll('table.report-table');
    if (!tables.length) return;
    var index = selectedOption !== undefined && selectedOption !== 'all' ? parseInt(selectedOption, 10) : -1;
    var wb = window.XLSX.utils.book_new();
    function getSheetName(tableEl, i) {
      var el = tableEl;
      while (el && el !== document.body) {
        var prev = el.previousElementSibling;
        while (prev) {
          if (/^H[2-4]$/i.test(prev.tagName)) {
            return (prev.textContent || '').trim().replace(/[\\\/\?\*\[\]:]/g, '').slice(0, 31) || ('Sheet' + (i + 1));
          }
          prev = prev.previousElementSibling;
        }
        el = el.parentElement;
      }
      return 'Sheet' + (i + 1);
    }
    if (index >= 0 && index < tables.length) {
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.table_to_sheet(tables[index]), getSheetName(tables[index], index));
    } else {
      Array.prototype.forEach.call(tables, function (t, i) {
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.table_to_sheet(t), getSheetName(t, i));
      });
    }
    window.XLSX.writeFile(wb, filename);
  }

  function fetchBusinessHours() {
    var storeId = getSelectedStoreId();
    fetch('/api/business-hours?storeId=' + encodeURIComponent(storeId)).then(function (res) { return parseJsonResponse(res); }).then(function (settings) {
      if (settings && typeof settings === 'object') {
        state.businessHoursSettings = settings;
        var startEl = document.getElementById('time-start');
        var endEl = document.getElementById('time-end');
        renderReport();
      }
    }).catch(function () {});
  }

  function filterByBusinessHours(hourly, businessDate, settings) {
    if (!hourly || !hourly.length) return hourly;
    if (!businessDate) return hourly;
    settings = settings || getBusinessHoursSettings();
    var dateStr = String(businessDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return hourly;
    var day = new Date(dateStr + 'T12:00:00').getDay();
    var daySettings = settings[day];
    if (!daySettings || (daySettings.start === '00:00' && daySettings.end === '24:00')) return hourly;
    var startTime = daySettings.start || '00:00';
    var endTime = daySettings.end || '24:00';
    return hourly.filter(function (h) {
      var slotStart = (h.timeKey || '').split('-')[0].trim();
      if (endTime === '24:00') return slotStart >= startTime;
      return slotStart >= startTime && slotStart < endTime;
    });
  }

  function filterByTimeRange(hourly, startTime, endTime) {
    if (!hourly || !hourly.length) return hourly;
    if (startTime === '00:00' && endTime === '24:00') return hourly;
    return hourly.filter(function (h) {
      var slotStart = (h.timeKey || '').split('-')[0].trim();
      if (endTime === '24:00') return slotStart >= startTime;
      return slotStart >= startTime && slotStart < endTime;
    });
  }

  function getBusinessHoursForDate(businessDate) {
    if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate).trim())) return { start: '00:00', end: '24:00' };
    var settings = getBusinessHoursSettings();
    var day = new Date(String(businessDate).trim() + 'T12:00:00').getDay();
    var daySettings = settings[day];
    if (!daySettings) return { start: '00:00', end: '24:00' };
    return { start: daySettings.start || '00:00', end: daySettings.end || '24:00' };
  }

  function timeToHour(t) {
    if (!t || t === '24:00') return 24;
    var parts = String(t).trim().split(':');
    return parseInt(parts[0], 10) | 0;
  }

  function hourToTime(h) {
    if (h >= 24) return '24:00';
    return (h < 10 ? '0' : '') + h + ':00';
  }

  function fillTimeSelects(referenceDate) {
    var startEl = document.getElementById('time-start');
    var endEl = document.getElementById('time-end');
    if (!startEl || !endEl) return;
    var range = getBusinessHoursForDate(referenceDate);
    var startH = timeToHour(range.start);
    var endH = timeToHour(range.end);
    if (endH < startH) endH = 24;
    var startOptions = [];
    var endOptions = [];
    for (var i = startH; i < endH; i++) {
      startOptions.push(hourToTime(i));
    }
    for (var j = startH + 1; j <= endH; j++) {
      endOptions.push(hourToTime(j));
    }
    if (startOptions.length === 0) startOptions = ['00:00'];
    if (endOptions.length === 0) endOptions = ['24:00'];
    startEl.innerHTML = '';
    endEl.innerHTML = '';
    startOptions.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      startEl.appendChild(opt);
    });
    endOptions.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      endEl.appendChild(o);
    });
    startEl.value = startOptions[0];
    endEl.value = endOptions[endOptions.length - 1];
  }

  function pctRatio(current, base) {
    if (base == null || base === 0) return null;
    if (current == null) return null;
    return Math.round((current / base) * 100);
  }

  function formatCurrency(n) {
    if (n == null) return '';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatCurrencyInteger(n) {
    if (n == null) return '';
    return Math.round(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  }

  function formatInt(n) {
    if (n == null) return '';
    return Math.round(Number(n)).toLocaleString('en-US');
  }
  function formatMoney(amountBaht) {
    var val = toSelectedCurrency(amountBaht);
    if (val == null) return '—';
    if (getCurrencyCode() === 'JPY') return '¥' + formatInt(val);
    return '฿' + formatCurrency(val);
  }
  function formatMoneyNoUnit(amountBaht) {
    var val = toSelectedCurrency(amountBaht);
    if (val == null) return '—';
    if (getCurrencyCode() === 'JPY') return formatInt(val);
    return formatCurrency(val);
  }
  function formatMoneyHtml(amountBaht) {
    var val = toSelectedCurrency(amountBaht);
    if (val == null) return '—';
    if (getCurrencyCode() === 'JPY') return '<span class="currency-unit">¥</span><span class="currency-value">' + formatInt(val) + '</span>';
    return '<span class="currency-unit">฿</span><span class="currency-value">' + formatCurrency(val) + '</span>';
  }
  function refreshCurrencyTexts() {
    var cur = getCurrencyLabel();
    var netHeader = document.getElementById('hourly-th-net');
    var isPhone = typeof window !== 'undefined' && window.innerWidth <= 480;
    var lang = window.i18n && window.i18n.getCurrentLang ? window.i18n.getCurrentLang() : 'ja';
    var timeHeader = document.getElementById('hourly-th-time');
    if (timeHeader) timeHeader.textContent = isPhone ? t('time_range_col_phone') : t('time_range_col');
    if (netHeader) netHeader.textContent = isPhone ? t('net_sales_phone') : (t('snapshot_net_sales') + ' (' + cur + ')');
    var dodHeader = document.getElementById('hourly-th-dod');
    if (dodHeader) dodHeader.textContent = isPhone ? 'D' : t('dod');
    var wowHeader = document.getElementById('hourly-th-wow');
    if (wowHeader) wowHeader.textContent = isPhone ? 'W' : t('wow');
    var qtyHeader = document.getElementById('hourly-th-qty');
    if (qtyHeader) qtyHeader.textContent = isPhone ? t('qty_sold_phone') : t('qty_sold');
    var receiptHeader = document.getElementById('hourly-th-receipt');
    if (receiptHeader) receiptHeader.textContent = isPhone ? t('receipt_count_phone') : t('receipt_count');
    var unitPerTxnHeader = document.getElementById('hourly-th-unitptx');
    if (unitPerTxnHeader) unitPerTxnHeader.textContent = t('unit_per_txn') || 'Unit Per Transaction';
    var avgTxnPriceHeader = document.getElementById('hourly-th-avgtxn');
    if (avgTxnPriceHeader) avgTxnPriceHeader.textContent = t('avg_txn_price') || 'Average Transaction Price';
    var netLabel = document.getElementById('snapshot-net-label');
    if (netLabel) netLabel.textContent = t('snapshot_net_sales') || 'Net Sales';
    var salesTitle = document.getElementById('chart-sales-title');
    if (salesTitle) salesTitle.textContent = t('chart_hourly_net') || ('Hourly Net Sales (' + cur + ')');
    var forecastTitle = document.getElementById('chart-forecast-sales-title');
    if (forecastTitle) forecastTitle.textContent = t('chart_forecast_net') || ('Forecast (Landing) - Net Sales (' + cur + ')');
  }

  function formatPct(n) {
    if (n == null) return '<span class="na-value" title="' + escapeHtml(t('no_prev_data') || '前日データなし') + '">-</span>';
    return Math.round(Number(n)) + '%';
  }

  function shouldShowHourlyTotalExtras(isTotal) {
    var isMobile = false;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      isMobile = window.matchMedia('(max-width: 1024px)').matches;
    } else if (typeof window !== 'undefined') {
      isMobile = window.innerWidth <= 1024;
    }
    return !!(isTotal && !isMobile);
  }

  function renderHourlyTableHeader(isTotal) {
    var theadTr = document.querySelector('#hourly-table thead tr');
    if (!theadTr) return;
    var showExtras = shouldShowHourlyTotalExtras(isTotal);
    var extraCols = showExtras
      ? '<th id="hourly-th-unitptx">' + (t('unit_per_txn') || 'Unit Per Transaction') + '</th>' +
        '<th id="hourly-th-avgtxn">' + (t('avg_txn_price') || 'Average Transaction Price') + '</th>'
      : '';
    theadTr.innerHTML = '' +
      '<th id="hourly-th-time">' + (t('time_range_col') || 'Time range') + '</th>' +
      '<th id="hourly-th-net">' + (t('snapshot_net_sales') || 'Net Sales') + ' (' + getCurrencyLabel() + ')</th>' +
      '<th id="hourly-th-dod">' + (t('dod') || 'DoD') + '</th>' +
      '<th id="hourly-th-wow">' + (t('wow') || 'WoW') + '</th>' +
      '<th id="hourly-th-qty">' + (t('qty_sold') || 'Qty of Items Sold') + '</th>' +
      '<th id="hourly-th-receipt">' + (t('receipt_count') || 'Receipt Count') + '</th>' +
      extraCols;
  }

  function renderHourlyRow(hour, yesterdayHour, lastWeekHour, isTotal) {
    var net = hour.netSales;
    var dod = yesterdayHour ? pctRatio(net, yesterdayHour.netSales) : null;
    var wow = lastWeekHour ? pctRatio(net, lastWeekHour.netSales) : null;

    var isNarrow = typeof window !== 'undefined' && window.innerWidth <= 640;
    var timeLabel = hour.timeLabel || '';
    if (isNarrow && timeLabel.indexOf('-') >= 0) timeLabel = timeLabel.split('-')[0].trim();
    var receiptCount = Number(hour.receiptCount || 0);
    var quantitySold = Number(hour.quantitySold || 0);
    var receiptCell = isTotal ? formatInt(receiptCount) : '—';
    var showExtras = shouldShowHourlyTotalExtras(isTotal);
    var unitPerTxnCell = showExtras ? (receiptCount > 0 ? formatCurrency(quantitySold / receiptCount) : '-') : '';
    var avgTxnPriceCell = showExtras ? (receiptCount > 0 ? formatMoneyNoUnit(net / receiptCount) : '-') : '';
    var startLabel = (hour.timeKey || '').split('-')[0] || '';
    var nowTh = getThailandTimeStr();
    var isToday = state.referenceDate === getThailandDateStr();
    var isCurrentSlot = !!(isToday && startLabel && nowTh && startLabel <= nowTh && nowTh <= ((hour.timeKey || '').split('-')[1] || '24:00'));
    return '<tr class="' + (isCurrentSlot ? 'current-time-row' : '') + '">' +
      '<td>' + timeLabel + '</td>' +
      '<td>' + formatMoneyNoUnit(net) + '</td>' +
      '<td>' + formatPct(dod) + '</td>' +
      '<td>' + formatPct(wow) + '</td>' +
      '<td>' + formatInt(quantitySold) + '</td>' +
      '<td>' + receiptCell + '</td>' +
      (showExtras ? ('<td>' + unitPerTxnCell + '</td>' +
        '<td>' + avgTxnPriceCell + '</td>') : '') +
    '</tr>';
  }

  function findHour(hourly, timeKey) {
    if (!hourly) return null;
    for (var i = 0; i < hourly.length; i++) {
      if (hourly[i].timeKey === timeKey) return hourly[i];
    }
    return null;
  }

  function renderTotalsRow(todayHourly, yesterdayHourly, lastWeekHourly, isTotal) {
    var netSum = 0, receiptSum = 0, qtySum = 0;
    var netSumY = 0, receiptSumY = 0, qtySumY = 0;
    var netSumW = 0, receiptSumW = 0, qtySumW = 0;

    // 今日のtimeKeyセット（存在するスロットのみで比較）
    var todayKeys = {};
    todayHourly.forEach(function (h) {
      netSum += h.netSales || 0;
      receiptSum += h.receiptCount || 0;
      qtySum += h.quantitySold || 0;
      todayKeys[h.timeKey] = true;
    });
    if (yesterdayHourly) {
      yesterdayHourly.forEach(function (h) {
        if (!todayKeys[h.timeKey]) return;
        netSumY += h.netSales || 0;
        receiptSumY += h.receiptCount || 0;
        qtySumY += h.quantitySold || 0;
      });
    }
    if (lastWeekHourly) {
      lastWeekHourly.forEach(function (h) {
        if (!todayKeys[h.timeKey]) return;
        netSumW += h.netSales || 0;
        receiptSumW += h.receiptCount || 0;
        qtySumW += h.quantitySold || 0;
      });
    }

    var dod = netSumY > 0 ? pctRatio(netSum, netSumY) : null;
    var wow = netSumW > 0 ? pctRatio(netSum, netSumW) : null;
    var receiptCell = isTotal ? formatInt(receiptSum) : '—';
    var showExtras = shouldShowHourlyTotalExtras(isTotal);
    var hoursWithSales = 0;
    todayHourly.forEach(function (h) { if ((h.netSales || 0) > 0) hoursWithSales++; });
    if (hoursWithSales === 0) hoursWithSales = 1;
    var unitPerTxnCell = showExtras ? (receiptSum > 0 ? formatCurrency(qtySum / receiptSum) : '-') : '';
    var avgTxnPriceCell = showExtras ? (receiptSum > 0 ? formatMoneyNoUnit(netSum / receiptSum) : '-') : '';

    return '<tr>' +
      '<td>' + t('total') + '</td>' +
      '<td>' + formatMoneyNoUnit(netSum) + '</td>' +
      '<td>' + formatPct(dod) + '</td>' +
      '<td>' + formatPct(wow) + '</td>' +
      '<td>' + formatInt(qtySum) + '</td>' +
      '<td>' + receiptCell + '</td>' +
      (showExtras ? ('<td>' + unitPerTxnCell + '</td>' +
        '<td>' + avgTxnPriceCell + '</td>') : '') +
    '</tr>';
  }

  /** receiptByTimeKey: optional map of timeKey -> receiptCount (from Total). fallbackTotalReceipt: use when receiptSum is 0 (e.g. CSV without hourly 00 Receipt_Count). */
  function computeSummary(hourly, receiptByTimeKey, fallbackTotalReceipt) {
    if (!hourly || !hourly.length) return null;
    var netSum = 0, receiptSum = 0, qtySum = 0;
    var hoursWithSales = 0;
    hourly.forEach(function (h) {
      var n = h.netSales || 0;
      netSum += n;
      var rc = (receiptByTimeKey && receiptByTimeKey[h.timeKey] != null) ? receiptByTimeKey[h.timeKey] : (h.receiptCount != null ? h.receiptCount : 0);
      receiptSum += rc;
      qtySum += h.quantitySold || 0;
      if (n > 0) hoursWithSales++;
    });
    if (hoursWithSales === 0) hoursWithSales = 1;
    if (receiptSum === 0 && fallbackTotalReceipt != null && fallbackTotalReceipt > 0) receiptSum = fallbackTotalReceipt;
    var hasReceipt = receiptSum > 0;
    return {
      salesPerHour: netSum / hoursWithSales,
      txnPerHour: hasReceipt ? (receiptSum / hoursWithSales) : null,
      unitPerTxn: hasReceipt ? (qtySum / receiptSum) : null,
      avgTxnPrice: hasReceipt ? (netSum / receiptSum) : null,
      avgSellingPrice: qtySum > 0 ? netSum / qtySum : 0
    };
  }

  function renderReport() {
    updateConfirmedBadge();
    var dept = document.getElementById('department-select').value;
    var isTotal = (dept === 'Total');
    renderHourlyTableHeader(isTotal);
    refreshCurrencyTexts();
    var startTime = '00:00';
    var endTime = '24:00';

    var todayRaw = getHourlyData(state.today, dept);
    var yesterdayRaw = getHourlyData(state.yesterday, dept);
    var lastWeekRaw = getHourlyData(state.lastWeek, dept);
    var todayHourly = filterByTimeRange(filterByBusinessHours(todayRaw, state.today && state.today.businessDate), startTime, endTime);
    var yesterdayHourly = filterByTimeRange(filterByBusinessHours(yesterdayRaw, state.yesterday && state.yesterday.businessDate), startTime, endTime);
    var lastWeekHourly = filterByTimeRange(filterByBusinessHours(lastWeekRaw, state.lastWeek && state.lastWeek.businessDate), startTime, endTime);

    var tbody = document.getElementById('hourly-tbody');
    var tfoot = document.getElementById('hourly-tfoot');
    var reportTitle = document.getElementById('report-title');
    var emptyMsg = document.getElementById('output-empty');
    var tableWrapper = document.querySelector('.table-wrapper');
    var chartSection = document.getElementById('chart-section');
    var compositionSection = document.getElementById('composition-section');

    var rowsHourly = (todayHourly || []).filter(function (h) { return (h && (h.netSales || 0) > 0); });

    // DoD/WoW比較は今日に売上があるtimeKeyのスロットのみで行う（当日途中の場合に全日合計と比べないため）
    var todayKeySet = {};
    rowsHourly.forEach(function (h) { todayKeySet[h.timeKey] = true; });
    if (yesterdayHourly) yesterdayHourly = yesterdayHourly.filter(function (h) { return todayKeySet[h.timeKey]; });
    if (lastWeekHourly) lastWeekHourly = lastWeekHourly.filter(function (h) { return todayKeySet[h.timeKey]; });

    if (!rowsHourly || !rowsHourly.length) {
      reportTitle.textContent = getDepartmentDisplayName(dept);
      tbody.innerHTML = '';
      tfoot.innerHTML = '';
      emptyMsg.hidden = false;
      var dateEl = document.getElementById('output-date');
      var hasDate = dateEl && dateEl.value && dateEl.value.trim() !== '';
      emptyMsg.textContent = hasDate ? t('no_data_selected_date') : t('no_data_for_store');
      tableWrapper.style.display = 'none';
      if (chartSection) chartSection.classList.add('hidden');
      if (compositionSection) compositionSection.classList.add('hidden');
      var snapshotCard = document.getElementById('snapshot-card');
      if (snapshotCard) {
        snapshotCard.hidden = true;
        snapshotCard.setAttribute('hidden', '');
      }
      destroyCharts();
      renderComposition(null);
      renderDepartmentProductBreakdown(null, dept);
      return;
    }

    emptyMsg.hidden = true;
    tableWrapper.style.display = '';
    if (chartSection) chartSection.classList.remove('hidden');

    reportTitle.textContent = getDepartmentDisplayName(dept);

    var totalTodayRaw = getHourlyData(state.today, 'Total');
    var totalYesterdayRaw = state.yesterday ? getHourlyData(state.yesterday, 'Total') : null;
    var totalLastWeekRaw = state.lastWeek ? getHourlyData(state.lastWeek, 'Total') : null;
    var totalTodayFiltered = totalTodayRaw ? filterByTimeRange(filterByBusinessHours(totalTodayRaw, state.today && state.today.businessDate), startTime, endTime) : null;
    var totalYesterdayFiltered = totalYesterdayRaw ? filterByTimeRange(filterByBusinessHours(totalYesterdayRaw, state.yesterday && state.yesterday.businessDate), startTime, endTime) : null;
    var totalLastWeekFiltered = totalLastWeekRaw ? filterByTimeRange(filterByBusinessHours(totalLastWeekRaw, state.lastWeek && state.lastWeek.businessDate), startTime, endTime) : null;
    function receiptMap(hourly) {
      if (!hourly) return null;
      var m = {};
      hourly.forEach(function (h) { if (h.timeKey != null && (h.receiptCount != null || h.receiptCount === 0)) m[h.timeKey] = h.receiptCount; });
      return Object.keys(m).length ? m : null;
    }
    var receiptToday = receiptMap(totalTodayFiltered);
    var receiptYesterday = receiptMap(totalYesterdayFiltered);
    var receiptLastWeek = receiptMap(totalLastWeekFiltered);
    var fallbackReceiptToday = (state.today && state.today.total && state.today.total.totalRow && (state.today.total.totalRow.receiptCount != null)) ? state.today.total.totalRow.receiptCount : null;
    var fallbackReceiptYesterday = (state.yesterday && state.yesterday.total && state.yesterday.total.totalRow && (state.yesterday.total.totalRow.receiptCount != null)) ? state.yesterday.total.totalRow.receiptCount : null;
    var fallbackReceiptLastWeek = (state.lastWeek && state.lastWeek.total && state.lastWeek.total.totalRow && (state.lastWeek.total.totalRow.receiptCount != null)) ? state.lastWeek.total.totalRow.receiptCount : null;
    if (!isTotal) {
      // Use dept-specific totalRow receipt count if available, otherwise keep total-store fallback
      if (state.today && state.today.byDepartment && state.today.byDepartment[dept] && state.today.byDepartment[dept].totalRow && (state.today.byDepartment[dept].totalRow.receiptCount != null)) {
        fallbackReceiptToday = state.today.byDepartment[dept].totalRow.receiptCount;
      }
      if (state.yesterday && state.yesterday.byDepartment && state.yesterday.byDepartment[dept] && state.yesterday.byDepartment[dept].totalRow && (state.yesterday.byDepartment[dept].totalRow.receiptCount != null)) {
        fallbackReceiptYesterday = state.yesterday.byDepartment[dept].totalRow.receiptCount;
      }
      if (state.lastWeek && state.lastWeek.byDepartment && state.lastWeek.byDepartment[dept] && state.lastWeek.byDepartment[dept].totalRow && (state.lastWeek.byDepartment[dept].totalRow.receiptCount != null)) {
        fallbackReceiptLastWeek = state.lastWeek.byDepartment[dept].totalRow.receiptCount;
      }
    }

    // Pass total-store per-slot receipt map for all views so computeSummary uses correct receipts
    var summaryReceiptToday = receiptToday;
    var summaryReceiptYesterday = receiptYesterday;
    var summaryReceiptLastWeek = receiptLastWeek;
    var sumToday = computeSummary(rowsHourly, summaryReceiptToday, fallbackReceiptToday);
    var sumYesterday = yesterdayHourly ? computeSummary(yesterdayHourly, summaryReceiptYesterday, fallbackReceiptYesterday) : null;
    var sumLastWeek = lastWeekHourly ? computeSummary(lastWeekHourly, summaryReceiptLastWeek, fallbackReceiptLastWeek) : null;

    renderSnapshotCard(getSelectedStoreName(), dept, state.referenceDate, todayHourly, yesterdayHourly, lastWeekHourly, isTotal, state.today, startTime, endTime, sumToday, sumYesterday, sumLastWeek);

    var html = '';
    rowsHourly.forEach(function (hour) {
      var yHour = findHour(yesterdayHourly, hour.timeKey);
      var wHour = findHour(lastWeekHourly, hour.timeKey);
      html += renderHourlyRow(hour, yHour, wHour, isTotal);
    });
    tbody.innerHTML = html;

    tfoot.innerHTML = renderTotalsRow(rowsHourly, yesterdayHourly, lastWeekHourly, isTotal);

    var hourlyTableEl = document.getElementById('hourly-table');
    if (hourlyTableEl) hourlyTableEl.classList.toggle('hide-receipt-col', !isTotal);

    var todayNetForForecast = todayHourly.map(function (h) { return h.netSales || 0; });
    var todayReceiptsForForecast = todayHourly.map(function (h) { return h.receiptCount || 0; });
    var useAiForecast = aiState && aiState.available && isTotal;
    renderCharts(todayHourly, yesterdayHourly, lastWeekHourly, undefined, true);
    if (useAiForecast) {
      var storeIdForForecast = getSelectedStoreId();
      var refDateForForecast = state.referenceDate || '';
      var currentTimeIso = new Date().toISOString();
      fetch('/api/ai/hourly-forecast?storeId=' + encodeURIComponent(storeIdForForecast) + '&referenceDate=' + encodeURIComponent(refDateForForecast) + '&currentTime=' + encodeURIComponent(currentTimeIso))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Fetch failed')); })
        .then(function (aiData) {
          var thailandNow = (state.referenceDate === getThailandDateStr()) ? getThailandTimeStr() : null;
          var fd = buildForecastChartDataFromAI(aiData, todayNetForForecast, todayReceiptsForForecast, todayHourly, thailandNow);
          renderCharts(todayHourly, yesterdayHourly, lastWeekHourly, { forecastSalesData: fd.sales, forecastReceiptsData: fd.receipts }, true);
        })
        .catch(function () {});
    }

    var compositionData = getDepartmentCompositionByTime(state.today, startTime, endTime);
    renderComposition(compositionData);
    renderDepartmentProductBreakdown(state.today, dept);
  }

  function fillOutputDateSelect(dates, selectedValue) {
    var el = document.getElementById('output-date');
    if (!el || el.type !== 'date') return;
    var arr = (dates || []).slice().sort();
    if (arr.length) {
      el.min = arr[0];
      el.max = arr[arr.length - 1];
      el.value = (selectedValue && arr.indexOf(selectedValue) !== -1) ? selectedValue : (selectedValue || arr[arr.length - 1] || '');
    } else {
      el.removeAttribute('min');
      el.removeAttribute('max');
      el.value = '';
    }
  }

  function getTodayYYYYMMDD() {
    return getThailandDateStr();
  }

  function formatLastUploadDisplay(isoString) {
    if (!isoString) return '';
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      var h = d.getHours();
      var m = d.getMinutes();
      var hh = (h < 10 ? '0' : '') + h;
      var mm = (m < 10 ? '0' : '') + m;
      return hh + ':' + mm;
    } catch (e) { return ''; }
  }

  function updateConfirmedBadge() {
    var badge = document.getElementById('confirmed-badge');
    if (!badge) return;
    badge.hidden = !(state.today && state.today._isFinal);
  }

  function updateAutoRefreshStatus() {
    var el = document.getElementById('auto-refresh-status');
    if (!el) return;
    var ts = state.today && state.today._updatedAt;
    if (!ts) { el.textContent = ''; return; }
    // _updatedAt is UTC ISO string from SQLite ("2026-03-17 08:42:11")
    var d = new Date(ts.indexOf('T') === -1 ? ts.replace(' ', 'T') + 'Z' : ts);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var text = t('auto_refresh_label') + hh + ':' + mm;
    if (nextAutoRefreshAt && state.referenceDate === getThailandDateStr()) {
      var remainMs = nextAutoRefreshAt - Date.now();
      if (remainMs < 0) remainMs = 0;
      var totalSec = Math.floor(remainMs / 1000);
      var min = Math.floor(totalSec / 60);
      var sec = totalSec % 60;
      text += ' / ' + t('next_refresh_in') + ' ' + String(min) + ':' + String(sec).padStart(2, '0');
    }
    el.textContent = text;
  }

  function silentRefreshReport() {
    var date = state.referenceDate;
    var storeId = getSelectedStoreId();
    if (!date || !storeId) return;
    fetch('/api/report?referenceDate=' + encodeURIComponent(date) + '&storeId=' + encodeURIComponent(storeId))
      .then(function (res) { return parseJsonResponse(res).then(function (body) { return { res: res, body: body }; }); })
      .then(function (r) {
        if (!r.res.ok) return;
        state.today = r.body.today;
        state.yesterday = r.body.yesterday || null;
        state.lastWeek = r.body.lastWeek || null;
        nextAutoRefreshAt = Date.now() + AUTO_REFRESH_INTERVAL_MS;
        renderReport();
        updateAutoRefreshStatus();
      })
      .catch(function () {});
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer !== null) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (autoRefreshCountdownTimer !== null) {
      clearInterval(autoRefreshCountdownTimer);
      autoRefreshCountdownTimer = null;
    }
    nextAutoRefreshAt = null;
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (state.referenceDate !== getThailandDateStr()) return;
    nextAutoRefreshAt = Date.now() + AUTO_REFRESH_INTERVAL_MS;
    autoRefreshTimer = setInterval(silentRefreshReport, AUTO_REFRESH_INTERVAL_MS);
    autoRefreshCountdownTimer = setInterval(function () {
      if (!nextAutoRefreshAt) return;
      updateAutoRefreshStatus();
    }, 1000);
  }

  function refreshOutputDateSelect() {
    var el = document.getElementById('output-date');
    if (!el) return;
    showLoading();
    var storeId = getSelectedStoreId();
    fetch('/api/dates?storeId=' + encodeURIComponent(storeId)).then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var dates = body.dates || [];
      if (dates.length === 0) {
        state.today = null;
        state.yesterday = null;
        state.lastWeek = null;
        state.referenceDate = null;
      }
      var lastEl = document.getElementById('last-upload-time');
      if (lastEl) {
        var txt = formatLastUploadDisplay(body.lastUploadedAt);
        lastEl.textContent = txt ? t('last_upload_label') + txt : '';
      }
      var todayStr = getTodayYYYYMMDD();
      var initialDate = state.referenceDate || el.value || (dates.indexOf(todayStr) !== -1 ? todayStr : (dates.length ? dates[0] : null));
      fillOutputDateSelect(dates, initialDate);
      updateHourlyFiltersSummaryBar();
      var chosen = el.value;
      var allstoresDateEl = document.getElementById('allstores-date');
      if (allstoresDateEl && chosen) allstoresDateEl.value = chosen;
      var productsDateFromEl2 = document.getElementById('products-date-from');
      var productsDateToEl2 = document.getElementById('products-date-to');
      if (productsDateFromEl2 && chosen) productsDateFromEl2.value = chosen;
      if (productsDateToEl2 && chosen) productsDateToEl2.value = chosen;
      if (chosen) {
        fetch('/api/report?referenceDate=' + encodeURIComponent(chosen) + '&storeId=' + encodeURIComponent(storeId)).then(function (r) {
          return parseJsonResponse(r).then(function (data) {
            if (!r.ok) {
              state.today = null;
              state.yesterday = null;
              state.lastWeek = null;
              state.referenceDate = chosen;
              renderReport();
              return;
            }
            state.today = data.today;
            state.yesterday = data.yesterday || null;
            state.lastWeek = data.lastWeek || null;
            state.referenceDate = data.referenceDate;
            renderReport();
            updateAutoRefreshStatus();
            startAutoRefresh();
          });
        }).then(function () { hideLoading(); }).catch(function () { hideLoading(); });
      } else {
        renderReport();
        updateHourlyFiltersSummaryBar();
        hideLoading();
      }
    }).catch(function () { renderReport(); hideLoading(); });
  }

  function renderAllStoresDigest() {
    var tbody = document.getElementById('allstores-tbody');
    var emptyEl = document.getElementById('allstores-empty');
    var dateEl = document.getElementById('allstores-date');
    var deptEl = document.getElementById('allstores-department-select');
    var sortKeyEl = document.getElementById('allstores-sort-key');
    if (!tbody || !dateEl || !deptEl || !sortKeyEl) return;
    var refDate = dateEl.value;
    if (!refDate) {
      var hourlyDateEl = document.getElementById('output-date');
      if (hourlyDateEl && hourlyDateEl.value) {
        dateEl.value = hourlyDateEl.value;
        refDate = hourlyDateEl.value;
      }
    }
    if (!refDate) {
      tbody.innerHTML = '';
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = t('allstores_empty');
      }
      return;
    }
    var dept = deptEl.value || 'Total';
    var sortKey = sortKeyEl.value || 'net';
    var thailandNow = getThailandTimeStr();
    var isTodayRef = String(refDate || '') === getThailandDateStr();
    var stores = state.stores && state.stores.length ? state.stores : [{ id: 'default', name: 'Default' }];
    showLoading();
    Promise.all(stores.map(function (store) {
      var sid = store.id || 'default';
      return fetch('/api/report?referenceDate=' + encodeURIComponent(refDate) + '&storeId=' + encodeURIComponent(sid))
        .then(function (res) {
          return parseJsonResponse(res).then(function (body) {
            if (!res.ok || !body || !body.today) return null;
            var hourly = getHourlyData(body.today, dept);
            if (!hourly || !hourly.length) return null;
            var filtered = filterByBusinessHours(hourly, body.today.businessDate);
            var filteredByNow = isTodayRef ? filterByThailandCurrentTime(filtered, thailandNow) : filtered;
            var useSameTimeBaseline = isTodayRef && filteredByNow.length > 0 && filteredByNow.length < filtered.length;
            if (useSameTimeBaseline) filtered = filteredByNow;
            var net = 0;
            var qty = 0;
            var receipt = 0;
            filtered.forEach(function (h) {
              net += h.netSales || 0;
              qty += h.quantitySold || 0;
              receipt += h.receiptCount || 0;
            });
            var netY = null;
            var netW = null;
            var hourlyY = body.yesterday ? getHourlyData(body.yesterday, dept) : null;
            var hourlyW = body.lastWeek ? getHourlyData(body.lastWeek, dept) : null;
            if (hourlyY && hourlyY.length) {
              var filteredY = filterByBusinessHours(hourlyY, body.yesterday.businessDate);
              if (useSameTimeBaseline) filteredY = filterByThailandCurrentTime(filteredY, thailandNow);
              var sumY = 0;
              filteredY.forEach(function (h) { sumY += h.netSales || 0; });
              netY = sumY;
            }
            if (hourlyW && hourlyW.length) {
              var filteredW = filterByBusinessHours(hourlyW, body.lastWeek.businessDate);
              if (useSameTimeBaseline) filteredW = filterByThailandCurrentTime(filteredW, thailandNow);
              var sumW = 0;
              filteredW.forEach(function (h) { sumW += h.netSales || 0; });
              netW = sumW;
            }
            return {
              name: store.name || sid,
              net: net,
              dod: pctRatio(net, netY),
              wow: pctRatio(net, netW),
              qty: qty,
              receipt: receipt
            };
          });
        })
        .catch(function () { return null; });
    })).then(function (rows) {
      var list = rows.filter(function (r) { return !!r; });
      list.sort(function (a, b) {
        var dir = sortKey === 'name' ? 1 : -1;
        if (sortKey === 'name') {
          return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }) * dir;
        }
        var av = Number(a[sortKey] || 0);
        var bv = Number(b[sortKey] || 0);
        if (av === bv) return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        return (av - bv) * dir;
      });
      if (!list.length) {
        tbody.innerHTML = '';
        if (emptyEl) {
          emptyEl.hidden = false;
          emptyEl.textContent = t('allstores_empty');
        }
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      var html = '';
      list.forEach(function (r, idx) {
        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td>' + r.name + '</td>' +
          '<td>' + formatMoneyNoUnit(r.net) + '</td>' +
          '<td>' + formatPct(r.dod) + '</td>' +
          '<td>' + formatPct(r.wow) + '</td>' +
          '<td>' + formatInt(r.qty) + '</td>' +
          '<td>' + formatInt(r.receipt) + '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    }).finally(function () {
      hideLoading();
    });
  }

  function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
      t.setAttribute('aria-selected', t.getAttribute('data-tab') === tabName ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === tabName + '-panel');
    });
    if (tabName === 'hourly') {
      refreshOutputDateSelect();
      renderReport();
    }
    if (tabName === 'allstores') renderAllStoresDigest();
    if (tabName === 'products') renderProductsTab();
    if (tabName === 'daily') refreshDailyDateSelect();
    if (tabName === 'weekly') refreshWeeklyDateSelect();
    if (tabName === 'ai') {
      refreshAiDateSelect();
    }
  }

  function addDaysToDate(dateStr, days) {
    var d = new Date(dateStr + 'T12:00:00');
    d.setUTCDate(d.getUTCDate() + days);
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function fillDailyStartDateSelect(dates, selectedValue, suggestedEndDate) {
    var el = document.getElementById('daily-start-date');
    if (!el || el.type !== 'date') return;
    var arr = (dates || []).slice().sort();
    if (arr.length) {
      el.min = arr[0];
      el.max = arr[arr.length - 1];
    } else {
      el.removeAttribute('min');
      el.removeAttribute('max');
    }
    var defaultStart = '';
    if (arr.length && suggestedEndDate) {
      defaultStart = addDaysToDate(suggestedEndDate, -7);
      if (defaultStart < arr[0]) defaultStart = arr[0];
    } else if (arr.length) {
      defaultStart = arr[0];
    }
    el.value = (selectedValue && arr.indexOf(selectedValue) !== -1) ? selectedValue : (defaultStart || '');
  }

  function fillDailyEndDateSelect(dates, selectedValue) {
    var el = document.getElementById('daily-end-date');
    if (!el || el.type !== 'date') return;
    var arr = (dates || []).slice().sort();
    if (arr.length) {
      el.min = arr[0];
      el.max = arr[arr.length - 1];
    } else {
      el.removeAttribute('min');
      el.removeAttribute('max');
    }
    var defaultEnd = arr.length ? arr[arr.length - 1] : '';
    el.value = (selectedValue && arr.indexOf(selectedValue) !== -1) ? selectedValue : (defaultEnd || '');
  }

  function refreshDailyDateSelect() {
    showLoading();
    var storeId = getDailyStoreId();
    fetch('/api/dates?storeId=' + encodeURIComponent(storeId)).then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var dates = body.dates || [];
      var startEl = document.getElementById('daily-start-date');
      var endEl = document.getElementById('daily-end-date');
      var arr = (dates || []).slice().sort();
      var endDefault = arr.length ? arr[arr.length - 1] : '';
      var endValue = (endEl && endEl.value && arr.indexOf(endEl.value) !== -1) ? endEl.value : endDefault;
      fillDailyEndDateSelect(dates, endValue);
      var actualEnd = endEl ? endEl.value : endDefault;
      fillDailyStartDateSelect(dates, startEl ? startEl.value : null, actualEnd);
      if (dates.length && endEl && endEl.value) {
        renderDailySummary();
      } else {
        renderDailySummary();
        hideLoading();
      }
    }).catch(function () { hideLoading(); });
  }

  function addDays(dateStr, delta) {
    var d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getMondayOfWeek(dateStr) {
    var d = new Date(dateStr + 'T12:00:00');
    var day = d.getDay();
    var toMonday = (day + 6) % 7;
    return addDays(dateStr, -toMonday);
  }

  function fillWeeklyEndDateSelect(dates, selectedValue) {
    var el = document.getElementById('weekly-end-date');
    if (!el || el.type !== 'date') return;
    var arr = (dates || []).slice().sort();
    if (arr.length) { el.min = arr[0]; el.max = arr[arr.length - 1]; }
    else { el.removeAttribute('min'); el.removeAttribute('max'); }
    var val = (selectedValue && dates && dates.indexOf(selectedValue) !== -1) ? selectedValue : (dates && dates.length ? dates[0] : '');
    el.value = val || '';
  }

  function refreshWeeklyDateSelect() {
    showLoading();
    var storeId = getWeeklyStoreId();
    fetch('/api/dates?storeId=' + encodeURIComponent(storeId)).then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var dates = body.dates || [];
      var el = document.getElementById('weekly-end-date');
      fillWeeklyEndDateSelect(dates, el ? el.value : null);
      if (el && el.value) { renderWeeklySummary(); } else { hideLoading(); }
    }).catch(function () { hideLoading(); });
  }

  function renderWeeklySummary() {
    var endDateEl = document.getElementById('weekly-end-date');
    var endDate = endDateEl ? endDateEl.value : '';
    var numWeeksEl = document.getElementById('weekly-num-weeks');
    var numWeeks = numWeeksEl ? Math.min(4, Math.max(2, parseInt(numWeeksEl.value, 10) || 4)) : 4;
    var daysToFetch = numWeeks * 7;
    var container = document.getElementById('weekly-summary-tables');
    var emptyEl = document.getElementById('weekly-empty');
    if (!container) return;
    if (!endDate) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    var mondayOfEndWeek = getMondayOfWeek(endDate);
    var firstMonday = addDays(mondayOfEndWeek, -(numWeeks - 1) * 7);
    var apiEndDate = addDays(firstMonday, daysToFetch - 1);
    if (emptyEl) emptyEl.hidden = true;
    showLoading();
    var storeId = getWeeklyStoreId();
    fetch('/api/daily-summary?referenceDate=' + encodeURIComponent(apiEndDate) + '&days=' + daysToFetch + '&storeId=' + encodeURIComponent(storeId)).then(function (res) {
      return parseJsonResponse(res).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Failed to load weekly summary');
        return body;
      });
    }).then(function (body) {
      var days = body.days || [];
      if (days.length === 0) {
        container.innerHTML = '';
        if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = t('weekly_no_data'); }
        return;
      }
      var weeks = [];
      for (var w = 0; w < numWeeks; w++) {
        var chunk = days.slice(w * 7, (w + 1) * 7);
        if (chunk.length === 0) break;
        var totalNetSales = 0, receiptCount = 0, quantitySold = 0;
        var byDepartment = {};
        DEPARTMENTS.forEach(function (dept) { byDepartment[dept] = 0; });
        chunk.forEach(function (d) {
          totalNetSales += d.totalNetSales || 0;
          receiptCount += d.receiptCount || 0;
          quantitySold += d.quantitySold || 0;
          DEPARTMENTS.forEach(function (dept) {
            byDepartment[dept] += (d.byDepartment && d.byDepartment[dept]) ? d.byDepartment[dept] : 0;
          });
        });
        weeks.push({
          label: chunk[0].date + ' ～ ' + chunk[chunk.length - 1].date,
          shortLabel: chunk[0].date.slice(5) + '～' + chunk[chunk.length - 1].date.slice(5),
          totalNetSales: totalNetSales, receiptCount: receiptCount, quantitySold: quantitySold,
          byDepartment: byDepartment
        });
      }
      if (weeks.length === 0) { container.innerHTML = ''; if (emptyEl) emptyEl.hidden = false; return; }

      var sumNetSales = 0, sumReceipts = 0, sumQty = 0;
      weeks.forEach(function (w) { sumNetSales += w.totalNetSales || 0; sumReceipts += w.receiptCount || 0; sumQty += w.quantitySold || 0; });
      var table1 = '<section class="summary-section"><h3>' + t('weekly_net_title') + '</h3><div class="daily-table-wrapper"><table class="report-table daily-table"><thead><tr><th>' + t('week') + '</th><th>' + t('snapshot_net_sales') + ' (' + getCurrencyLabel() + ')</th><th>' + t('wow') + '</th><th>' + t('receipt_count') + '</th><th>' + t('qty_sold_short') + '</th></tr></thead><tbody>';
      weeks.forEach(function (w, i) {
        var prev = weeks[i - 1];
        var wow = prev && prev.totalNetSales ? Math.round((w.totalNetSales / prev.totalNetSales) * 100) : '—';
        table1 += '<tr><td>' + w.label + '</td><td>' + formatMoneyNoUnit(w.totalNetSales) + '</td><td>' + (wow === '—' ? wow : wow + '%') + '</td><td>' + formatInt(w.receiptCount) + '</td><td>' + formatInt(w.quantitySold) + '</td></tr>';
      });
      table1 += '<tr class="total-row"><td>' + t('total') + '</td><td>' + formatMoneyNoUnit(sumNetSales) + '</td><td>—</td><td>' + formatInt(sumReceipts) + '</td><td>' + formatInt(sumQty) + '</td></tr></tbody></table></div></section>';

      var deptTotals = {};
      DEPARTMENTS.forEach(function (d) { deptTotals[d] = 0; });
      weeks.forEach(function (w) { DEPARTMENTS.forEach(function (dept) { deptTotals[dept] += w.byDepartment[dept] || 0; }); });
      var grandTotalAll = 0;
      DEPARTMENTS.forEach(function (d) { grandTotalAll += deptTotals[d] || 0; });

      var table2 = '<section class="summary-section"><h3>' + t('sales_by_dept') + ' (' + getCurrencyLabel() + ')</h3><div class="daily-table-wrapper"><table class="report-table daily-table"><thead><tr><th>' + t('week') + '</th>';
      DEPARTMENTS.forEach(function (d) { table2 += '<th>' + getDepartmentDisplayName(d) + '</th>'; });
      table2 += '<th>' + t('total') + '</th></tr></thead><tbody>';
      weeks.forEach(function (w) {
        table2 += '<tr><td>' + w.shortLabel + '</td>';
        var rowTotal = 0;
        DEPARTMENTS.forEach(function (dept) { var v = w.byDepartment[dept] || 0; rowTotal += v; table2 += '<td>' + formatMoneyNoUnit(v) + '</td>'; });
        table2 += '<td>' + formatMoneyNoUnit(rowTotal) + '</td></tr>';
      });
      table2 += '<tr class="total-row"><td>' + t('total') + '</td>';
      DEPARTMENTS.forEach(function (d) { table2 += '<td>' + formatMoneyNoUnit(deptTotals[d]) + '</td>'; });
      table2 += '<td>' + formatMoneyNoUnit(grandTotalAll) + '</td></tr></tbody></table></div></section>';

      var table3 = '<section class="summary-section"><h3>' + t('dept_composition_pct') + '</h3><div class="daily-table-wrapper"><table class="report-table daily-table"><thead><tr><th>' + t('week') + '</th>';
      DEPARTMENTS.forEach(function (d) { table3 += '<th>' + getDepartmentDisplayName(d) + '</th>'; });
      table3 += '<th>' + t('total') + '</th></tr></thead><tbody>';
      weeks.forEach(function (w) {
        var weekTotal = w.totalNetSales || 1;
        table3 += '<tr><td>' + w.shortLabel + '</td>';
        DEPARTMENTS.forEach(function (dept) {
          var v = w.byDepartment[dept] || 0;
          table3 += '<td>' + (weekTotal ? ((v / weekTotal) * 100).toFixed(1) : '—') + '%</td>';
        });
        table3 += '<td>100%</td></tr>';
      });
      table3 += '<tr class="total-row"><td>' + t('total') + '</td>';
      DEPARTMENTS.forEach(function (d) { table3 += '<td>' + (grandTotalAll ? ((deptTotals[d] || 0) / grandTotalAll * 100).toFixed(1) : '—') + '%</td>'; });
      table3 += '<td>100%</td></tr></tbody></table></div></section>';

      container.innerHTML = table1 + table2 + table3;
    }).then(function () { hideLoading(); }).catch(function () {
      container.innerHTML = '';
      if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = t('weekly_load_failed'); }
      hideLoading();
    });
  }

  function getDailyDept() {
    var el = document.getElementById('daily-dept-select');
    return el ? el.value : '';
  }

  function updateDailyExportOptions() {
    var sel = document.getElementById('daily-export-select');
    if (!sel) return;
    var dept = getDailyDept();
    var isTotal = !dept;
    sel.innerHTML = '';
    var opts;
    if (isTotal) {
      opts = [
        ['all',   t('output_all')],
        ['0',     t('period_total_section')],
        ['1',     t('daily_sales_by_dept')],
        ['2',     t('daily_composition_pct')],
        ['3',     t('key_metrics')],
      ];
    } else {
      opts = [
        ['all',   t('output_all')],
        ['0',     t('period_total_section')],
        ['1',     t('classification_level1')],
        ['2',     t('classification_level2')],
        ['3',     t('classification_level3')],
        ['4',     t('classification_level4')],
      ];
    }
    opts.forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      sel.appendChild(opt);
    });
  }

  function buildClassificationTree(groups) {
    // Build a map of code -> group info and a tree structure
    var map = {};
    groups.forEach(function(g) { map[g.code] = g; });
    var roots = [];
    var children = {}; // parent_code -> [children]
    groups.forEach(function(g) {
      if (!g.parent_code) {
        roots.push(g);
      } else {
        if (!children[g.parent_code]) children[g.parent_code] = [];
        children[g.parent_code].push(g);
      }
    });
    return { map: map, roots: roots, children: children };
  }

  function aggregateByClassification(days, dept, clsTree) {
    // For each date, aggregate product sales by classification code
    // result: { [code]: { [date]: { net, qty } } }
    var result = {};
    var clsMap = clsTree.map;

    days.forEach(function(day) {
      var byProduct = day.byProduct || {};
      Object.values(byProduct).forEach(function(p) {
        var code = p.groupCode || p.retailProductCode || ''; // groupCode preferred, fallback to retailProductCode
        if (!code) return;
        var net = p.totalNetSales || 0;
        var qty = p.totalQuantitySold || 0;

        // Aggregate at this code level and all ancestors
        var cur = code;
        while (cur) {
          if (!result[cur]) result[cur] = {};
          if (!result[cur][day.date]) result[cur][day.date] = { net: 0, qty: 0 };
          result[cur][day.date].net += net;
          result[cur][day.date].qty += qty;
          var parent = clsMap[cur] ? clsMap[cur].parent_code : null;
          cur = parent || null;
        }
      });
    });
    return result;
  }

  function renderClassificationAccordion(days, clsTree, clsAgg) {
    var dates = days.map(function(d) { return d.date; });
    var lang = window.i18n ? window.i18n.getCurrentLang() : 'ja';

    function getClsName(g) {
      if (lang === 'ja') return g.description_jpn || g.description || g.code;
      if (lang === 'th') return g.description_tha || g.description || g.code;
      return g.description || g.code;
    }

    function getVal(code, date, isNet) {
      return clsAgg[code] && clsAgg[code][date] ? (isNet ? clsAgg[code][date].net : clsAgg[code][date].qty) : 0;
    }

    function getRowTotal(code, isNet) {
      return dates.reduce(function(s, d) { return s + getVal(code, d, isNet); }, 0);
    }

    function hasDataInSubtree(code) {
      if (clsAgg[code]) return true;
      return (clsTree.children[code] || []).some(function(c) { return hasDataInSubtree(c.code); });
    }

    function buildRows(isNet) {
      var rows = '';
      function renderNode(g) {
        var code = g.code;
        var childList = clsTree.children[code] || [];
        var hasChildren = childList.length > 0;
        if (!hasDataInSubtree(code)) return; // skip if no data anywhere in this subtree
        rows += '<tr class="cls-row cls-level-' + (g.level || 1) + '"' +
          ' data-code="' + escapeHtml(code) + '"' +
          ' data-level="' + (g.level || 1) + '"' +
          (g.parent_code ? ' data-parent="' + escapeHtml(g.parent_code) + '" hidden' : '') + '>';
        rows += '<td>' +
          (hasChildren ? '<span class="cls-toggle">▶</span>' : '<span style="display:inline-block;width:18px;"></span>') +
          escapeHtml(getClsName(g)) + '</td>';
        dates.forEach(function(d) {
          var v = getVal(code, d, isNet);
          rows += '<td>' + (isNet ? formatMoneyNoUnit(v) : formatInt(v)) + '</td>';
        });
        var rowTotal = getRowTotal(code, isNet);
        rows += '<td>' + (isNet ? formatMoneyNoUnit(rowTotal) : formatInt(rowTotal)) + '</td></tr>';
        childList.forEach(function(child) { renderNode(child); });
      }
      clsTree.roots.forEach(function(root) { renderNode(root); });
      return rows;
    }

    var currLabel = getCurrencyLabel();
    var clsLabel = lang === 'ja' ? '分類' : 'Classification';

    var html = '<section class="summary-section">';
    // Tab buttons
    html += '<div class="cls-tab-bar">';
    html += '<button class="cls-tab cls-tab-active" data-tab="net">' + t('classification_sales') + ' (' + currLabel + ')</button>';
    html += '<button class="cls-tab" data-tab="qty">' + t('classification_sales') + ' (' + t('qty_sold_short') + ')</button>';
    html += '</div>';

    // Shared table wrapper with two tbody sets
    html += '<div class="cls-accordion daily-table-wrapper"><table class="report-table daily-table"><thead><tr>';
    html += '<th style="min-width:200px;">' + clsLabel + '</th>';
    dates.forEach(function(d) {
      var dt = new Date(d + 'T12:00:00');
      var w = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
      html += '<th>' + d.slice(5) + ' (' + w.slice(0,1) + ')</th>';
    });
    html += '<th>' + t('total_header') + '</th></tr></thead>';
    html += '<tbody class="cls-body" id="cls-body-net">' + buildRows(true) + '</tbody>';
    html += '<tbody class="cls-body" id="cls-body-qty" hidden>' + buildRows(false) + '</tbody>';
    html += '</table></div></section>';
    return html;
  }

  function renderDailySummaryDeptMode(days, dept, container, emptyEl) {
    hideLoading();
    if (!days.length) {
      container.innerHTML = '';
      if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = t('daily_no_data'); }
      return;
    }

    // Load classification tree
    loadProductGroups().then(function(groupsObj) {
      // loadProductGroups returns a cache object {code: group}; convert to array
      var groups = groupsObj && typeof groupsObj === 'object' && !Array.isArray(groupsObj)
        ? Object.values(groupsObj)
        : (Array.isArray(groupsObj) ? groupsObj : []);
      var clsTree = buildClassificationTree(groups || []);

      // Dept period totals from byDepartment
      var totalNet = 0, totalReceipts = 0, totalQty = 0, totalHours = 0;
      days.forEach(function(d) {
        totalNet += (d.byDepartment && d.byDepartment[dept]) ? d.byDepartment[dept] : 0;
        totalReceipts += d.receiptCount || 0;
        totalQty += 0; // qty by dept not directly available from daily-summary
        totalHours += d.hoursCount || 0;
      });

      // If byProduct available, compute dept totals from products
      var hasProductData = days.some(function(d) { return d.byProduct && Object.keys(d.byProduct).length > 0; });
      if (hasProductData) {
        totalNet = 0; totalQty = 0;
        days.forEach(function(d) {
          Object.values(d.byProduct || {}).forEach(function(p) {
            totalNet += p.totalNetSales || 0;
            totalQty += p.totalQuantitySold || 0;
          });
        });
      }

      // Classification aggregation
      var clsAgg = aggregateByClassification(days, dept, clsTree);
      var hasClsData = Object.keys(clsAgg).length > 0;

      // Store for export
      state.dailyClsTree = clsTree;
      state.dailyClsAgg = clsAgg;
      state.dailyClsDays = days;
      state.dailyClsDept = dept;

      // Period total section
      var periodHtml = '<section class="summary-section weekly-total-section"><h3>' + t('period_total_section') + ' \u2014 ' + escapeHtml(dept) + '</h3><table class="report-table daily-table weekly-total-table"><tbody>';
      periodHtml += '<tr><td>' + t('total_net_sales') + '</td><td>' + formatMoneyNoUnit(totalNet) + ' ' + getCurrencyLabel() + '</td></tr>';
      periodHtml += '<tr><td>' + t('total_receipts') + '</td><td>' + formatInt(totalReceipts) + '</td></tr>';
      if (totalQty > 0) periodHtml += '<tr><td>' + t('total_qty_sold') + '</td><td>' + formatInt(totalQty) + '</td></tr>';
      periodHtml += '<tr><td>' + t('total_hours') + '</td><td>' + formatInt(totalHours) + ' h</td></tr>';
      if (totalHours > 0) periodHtml += '<tr><td>' + t('sales_per_hour_label') + '</td><td>' + formatMoneyNoUnit(Math.round(totalNet / totalHours)) + ' ' + getCurrencyLabel() + '</td></tr>';
      periodHtml += '</tbody></table></section>';

      // Classification table (tabbed: net / qty)
      var clsHtml = hasClsData ? renderClassificationAccordion(days, clsTree, clsAgg) : '';

      container.innerHTML = periodHtml + clsHtml;

      // Tab switching
      container.querySelectorAll('.cls-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
          container.querySelectorAll('.cls-tab').forEach(function(b) { b.classList.remove('cls-tab-active'); });
          btn.classList.add('cls-tab-active');
          var tab = btn.dataset.tab;
          container.querySelectorAll('.cls-body').forEach(function(b) { b.hidden = true; });
          var body = container.querySelector('#cls-body-' + tab);
          if (body) body.hidden = false;
        });
      });

      // Accordion: click anywhere on cls-row to expand/collapse
      container.querySelectorAll('.cls-accordion').forEach(function(accordion) {
        function collapseChildren(parentCode) {
          accordion.querySelectorAll('[data-parent="' + parentCode + '"]').forEach(function(r) {
            r.hidden = true;
            r.classList.remove('cls-expanded');
            var t = r.querySelector('.cls-toggle');
            if (t) t.textContent = '\u25b6';
            collapseChildren(r.dataset.code);
          });
        }
        accordion.addEventListener('click', function(e) {
          var row = e.target.closest('tr.cls-row');
          if (!row) return;
          var toggle = row.querySelector('.cls-toggle');
          if (!toggle) return; // leaf node — no children
          var code = row.dataset.code;
          var isExpanded = row.classList.contains('cls-expanded');
          if (isExpanded) {
            collapseChildren(code);
            row.classList.remove('cls-expanded');
            toggle.textContent = '\u25b6';
          } else {
            accordion.querySelectorAll('[data-parent="' + code + '"]').forEach(function(r) { r.hidden = false; });
            row.classList.add('cls-expanded');
            toggle.textContent = '\u25bc';
          }
        });
      });
    });
  }

  function exportClassificationByLevel(level) {
    if (!window.XLSX) { alert('Excel library not loaded.'); return; }
    var clsTree = state.dailyClsTree;
    var clsAgg = state.dailyClsAgg;
    var days = state.dailyClsDays;
    var dept = state.dailyClsDept;
    if (!clsTree || !clsAgg || !days) { alert('No data to export.'); return; }

    var dates = days.map(function(d) { return d.date; });
    var lang = window.i18n ? window.i18n.getCurrentLang() : 'ja';

    function getClsName(g) {
      if (lang === 'ja') return g.description_jpn || g.description || g.code;
      if (lang === 'th') return g.description_tha || g.description || g.code;
      return g.description || g.code;
    }

    // Build rows for specified level
    var groups = Object.values(clsTree.map).filter(function(g) { return (g.level || 1) === level; });
    groups.sort(function(a, b) { return (a.code || '').localeCompare(b.code || ''); });

    var wb = window.XLSX.utils.book_new();
    var currLabel = getCurrencyLabel();

    // Net sales sheet
    var netHeaders = ['Code', 'Name (' + (dept || 'Total') + ')'].concat(dates.map(function(d) { return d.slice(5); })).concat(['Total (' + currLabel + ')']);
    var netRows = [netHeaders];
    groups.forEach(function(g) {
      var rowTotal = dates.reduce(function(s, d) { return s + (clsAgg[g.code] && clsAgg[g.code][d] ? clsAgg[g.code][d].net : 0); }, 0);
      if (rowTotal === 0) return;
      var row = [g.code, getClsName(g)];
      dates.forEach(function(d) { row.push(clsAgg[g.code] && clsAgg[g.code][d] ? Math.round(toSelectedCurrency(clsAgg[g.code][d].net)) : 0); });
      row.push(Math.round(toSelectedCurrency(rowTotal)));
      netRows.push(row);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(netRows), 'Net Sales');

    // Qty sheet
    var qtyHeaders = ['Code', 'Name'].concat(dates.map(function(d) { return d.slice(5); })).concat(['Total']);
    var qtyRows = [qtyHeaders];
    groups.forEach(function(g) {
      var rowTotal = dates.reduce(function(s, d) { return s + (clsAgg[g.code] && clsAgg[g.code][d] ? clsAgg[g.code][d].qty : 0); }, 0);
      if (rowTotal === 0) return;
      var row = [g.code, getClsName(g)];
      dates.forEach(function(d) { row.push(clsAgg[g.code] && clsAgg[g.code][d] ? clsAgg[g.code][d].qty : 0); });
      row.push(rowTotal);
      qtyRows.push(row);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(qtyRows), 'Qty Sold');

    var suffix = dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + '_' + dates[dates.length - 1];
    var deptSuffix = dept ? '_' + dept.replace(/[^a-zA-Z0-9]/g, '') : '';
    window.XLSX.writeFile(wb, 'classification_level' + level + deptSuffix + '_' + suffix + '.xlsx');
  }

  function renderDailySummary() {
    var startDateEl = document.getElementById('daily-start-date');
    var endDateEl = document.getElementById('daily-end-date');
    var startDate = startDateEl ? startDateEl.value : '';
    var endDate = endDateEl ? endDateEl.value : '';
    var container = document.getElementById('daily-summary-tables');
    var emptyEl = document.getElementById('daily-empty');
    if (!container) return;
    if (!endDate) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    showLoading();
    var storeId = getDailyStoreId();
    var dept = getDailyDept();
    var url = '/api/daily-summary?referenceDate=' + encodeURIComponent(endDate) + '&storeId=' + encodeURIComponent(storeId) + (dept ? '&dept=' + encodeURIComponent(dept) : '');
    if (startDate && startDate <= endDate) {
      url += '&startDate=' + encodeURIComponent(startDate);
    } else {
      url += '&days=7';
    }
    fetch(url).then(function (res) {
      return parseJsonResponse(res).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Failed to load daily summary');
        return body;
      });
    }).then(function (body) {
      var days = body.days || [];
      if (days.length === 0) {
        container.innerHTML = '';
        if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = t('daily_no_data'); }
        return;
      }
      destroyDailyCharts();
      if (dept) {
        renderDailySummaryDeptMode(days, dept, container, emptyEl);
        return;
      }
      // Clear classification state when in Total mode
      state.dailyClsTree = null; state.dailyClsAgg = null; state.dailyClsDays = null; state.dailyClsDept = null;
      var deptOrder = DEPARTMENTS.slice();
      var dailyChartColors = DEPARTMENT_COLORS.slice();
      var dateLabels = days.map(function (d) {
        var dt = new Date(d.date + 'T12:00:00');
        var w = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
        return d.date + ' (' + w + ')';
      });
      var totalRow = [];
      var grandTotalSales = 0;
      days.forEach(function (d, i) {
        var dayTotal = d.totalNetSales || 0;
        totalRow.push(dayTotal);
        grandTotalSales += dayTotal;
      });
      totalRow.push(grandTotalSales);

      var table1 = '<section class="summary-section"><h3>' + t('daily_sales_by_dept') + ' (' + getCurrencyLabel() + ')</h3><div class="daily-table-wrapper"><table class="report-table daily-table"><thead><tr><th>' + t('department') + '</th>';
      dateLabels.forEach(function (l) { table1 += '<th>' + l + '</th>'; });
      table1 += '<th>' + t('total_header') + '</th></tr></thead><tbody>';
      deptOrder.forEach(function (dept) {
        var rowTotal = 0;
        table1 += '<tr><td>' + getDepartmentDisplayName(dept) + '</td>';
        days.forEach(function (d) {
          var v = (d.byDepartment && d.byDepartment[dept]) ? d.byDepartment[dept] : 0;
          rowTotal += v;
          table1 += '<td>' + formatMoneyNoUnit(v) + '</td>';
        });
        table1 += '<td>' + formatMoneyNoUnit(rowTotal) + '</td></tr>';
      });
      table1 += '<tr class="total-row"><td>' + t('total_header') + '</td>';
      totalRow.forEach(function (v) { table1 += '<td>' + formatMoneyNoUnit(v) + '</td>'; });
      table1 += '</tr></tbody></table></div></section>';

      var table1b = '<section class="summary-section"><h3>' + t('daily_composition_pct') + '</h3><div class="daily-table-wrapper"><table class="report-table daily-table"><thead><tr><th>' + t('department') + '</th>';
      dateLabels.forEach(function (l) { table1b += '<th>' + l + '</th>'; });
      table1b += '<th>' + t('total_header') + '</th></tr></thead><tbody>';
      deptOrder.forEach(function (dept) {
        table1b += '<tr><td>' + getDepartmentDisplayName(dept) + '</td>';
        days.forEach(function (d) {
          var dayTotal = d.totalNetSales || 0;
          var v = (d.byDepartment && d.byDepartment[dept]) ? d.byDepartment[dept] : 0;
          var pct = dayTotal ? ((v / dayTotal) * 100).toFixed(1) : '—';
          table1b += '<td>' + pct + '%</td>';
        });
        var deptGrand = days.reduce(function (s, day) { return s + ((day.byDepartment && day.byDepartment[dept]) ? day.byDepartment[dept] : 0); }, 0);
        table1b += '<td>' + (grandTotalSales ? (deptGrand / grandTotalSales * 100).toFixed(1) : '—') + '%</td></tr>';
      });
      table1b += '<tr class="total-row"><td>' + t('total_header') + '</td>';
      days.forEach(function (d) { table1b += '<td>100%</td>'; });
      table1b += '<td>100%</td></tr></tbody></table></div></section>';

      var salesPerHour = days.map(function (d) {
        var h = d.hoursCount || 1;
        return Math.round((d.totalNetSales || 0) / h);
      });
      var receiptsPerHour = days.map(function (d) {
        var h = d.hoursCount || 1;
        return Math.round((d.receiptCount || 0) / h);
      });
      var receiptCounts = days.map(function (d) { return d.receiptCount || 0; });
      var avgReceipt = days.map(function (d) {
        var r = d.receiptCount || 0;
        return r ? Math.round((d.totalNetSales || 0) / r) : 0;
      });
      var itemsPerReceipt = days.map(function (d) {
        var r = d.receiptCount || 0;
        return r ? ((d.quantitySold || 0) / r).toFixed(1) : '—';
      });
      var qtySold = days.map(function (d) { return d.quantitySold || 0; });
      var avgItemPrice = days.map(function (d) {
        var q = d.quantitySold || 0;
        return q ? Math.round((d.totalNetSales || 0) / q) : 0;
      });
      var totalHours = days.reduce(function (acc, d) { return acc + (d.hoursCount || 0); }, 0);
      var totalReceipts = days.reduce(function (acc, d) { return acc + (d.receiptCount || 0); }, 0);
      var totalQty = days.reduce(function (acc, d) { return acc + (d.quantitySold || 0); }, 0);

      var weeklyTotalHtml = '<section class="summary-section weekly-total-section"><h3>' + t('period_total_section') + '</h3><table class="report-table daily-table weekly-total-table"><tbody>';
      weeklyTotalHtml += '<tr><td>' + t('total_net_sales') + '</td><td>' + formatMoneyNoUnit(grandTotalSales) + ' ' + getCurrencyLabel() + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('total_receipts') + '</td><td>' + formatInt(totalReceipts) + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('total_qty_sold') + '</td><td>' + formatInt(totalQty) + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('total_hours') + '</td><td>' + formatInt(totalHours) + ' h</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('sales_per_hour_label') + '</td><td>' + formatMoneyNoUnit(totalHours ? Math.round(grandTotalSales / totalHours) : 0) + ' ' + getCurrencyLabel() + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('avg_receipt_value') + '</td><td>' + (totalReceipts ? formatMoneyNoUnit(Math.round(grandTotalSales / totalReceipts)) : '—') + ' ' + getCurrencyLabel() + '</td></tr>';
      weeklyTotalHtml += '</tbody></table></section>';

      var table2 = '<section class="summary-section"><h3>' + t('key_metrics') + '</h3><div class="daily-table-wrapper"><table class="report-table daily-table"><thead><tr><th>' + t('metric') + '</th>';
      dateLabels.forEach(function (l) { table2 += '<th>' + l + '</th>'; });
      table2 += '<th>' + t('total_header') + '</th></tr></thead><tbody>';
      table2 += '<tr><td>' + t('sales_per_hour') + ' (' + getCurrencyLabel() + ')</td>';
      salesPerHour.forEach(function (v) { table2 += '<td>' + formatMoneyNoUnit(v) + '</td>'; });
      table2 += '<td>' + formatMoneyNoUnit(totalHours ? Math.round(grandTotalSales / totalHours) : 0) + '</td></tr>';
      table2 += '<tr><td>' + t('receipts_per_hour') + '</td>';
      receiptsPerHour.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalHours ? Math.round(totalReceipts / totalHours) : 0) + '</td></tr>';
      table2 += '<tr><td>' + t('receipt_count') + '</td>';
      receiptCounts.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalReceipts) + '</td></tr>';
      table2 += '<tr><td>' + t('avg_receipt_value') + ' (' + getCurrencyLabel() + ')</td>';
      avgReceipt.forEach(function (v) { table2 += '<td>' + formatMoneyNoUnit(v) + '</td>'; });
      table2 += '<td>' + (totalReceipts ? formatMoneyNoUnit(Math.round(grandTotalSales / totalReceipts)) : '—') + '</td></tr>';
      table2 += '<tr><td>' + t('items_per_receipt') + '</td>';
      itemsPerReceipt.forEach(function (v) { table2 += '<td>' + v + '</td>'; });
      table2 += '<td>' + (totalReceipts ? (totalQty / totalReceipts).toFixed(1) : '—') + '</td></tr>';
      table2 += '<tr><td>' + t('quantity_sold') + '</td>';
      qtySold.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalQty) + '</td></tr>';
      table2 += '<tr><td>' + t('avg_item_price') + ' (' + getCurrencyLabel() + ')</td>';
      avgItemPrice.forEach(function (v) { table2 += '<td>' + formatMoneyNoUnit(v) + '</td>'; });
      table2 += '<td>' + (totalQty ? formatMoneyNoUnit(Math.round(grandTotalSales / totalQty)) : '—') + '</td></tr>';
      table2 += '</tbody></table></div></section>';

      var chartSectionHtml = '<section class="summary-section chart-section"><h3 class="chart-title">' + t('daily_sales_by_dept') + '</h3><div class="chart-wrapper"><canvas id="daily-chart-sales"></canvas></div><h3 class="chart-title">' + t('daily_composition_pct') + '</h3><div class="chart-wrapper"><canvas id="daily-chart-composition"></canvas></div><h3 class="chart-title">' + t('key_metrics_trend') + '</h3><div class="chart-wrapper"><canvas id="daily-chart-metrics"></canvas></div></section>';

      container.innerHTML = weeklyTotalHtml + table1 + table1b + chartSectionHtml + table2;

      if (typeof Chart !== 'undefined') {
        var shortLabels = days.map(function (d) {
          var dt = new Date(d.date + 'T12:00:00');
          var w = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
          return d.date.slice(5) + ' (' + w.slice(0, 1) + ')';
        });
        var dailySalesCanvas = document.getElementById('daily-chart-sales');
        var dailyCompCanvas = document.getElementById('daily-chart-composition');
        var dailyMetricsCanvas = document.getElementById('daily-chart-metrics');
        if (dailySalesCanvas) {
          var salesDatasets = deptOrder.map(function (dept, i) {
            var values = days.map(function (d) {
              return (d.byDepartment && d.byDepartment[dept]) ? d.byDepartment[dept] : 0;
            });
            return { label: dept, data: values, backgroundColor: dailyChartColors[i % dailyChartColors.length], borderColor: dailyChartColors[i % dailyChartColors.length], borderWidth: 1 };
          });
          chartInstances.dailySales = new Chart(dailySalesCanvas, {
            type: 'bar',
            data: { labels: shortLabels, datasets: salesDatasets },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              plugins: { legend: { position: 'top' } },
              scales: {
                x: { stacked: true, title: { display: true, text: t('date_label') } },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: t('net_sales') } }
              }
            }
          });
        }
        if (dailyCompCanvas) {
          var compDatasets = deptOrder.map(function (dept, i) {
            var pctValues = days.map(function (d) {
              var dayTotal = d.totalNetSales || 0;
              var v = (d.byDepartment && d.byDepartment[dept]) ? d.byDepartment[dept] : 0;
              return dayTotal ? (v / dayTotal) * 100 : 0;
            });
            return { label: dept, data: pctValues, backgroundColor: dailyChartColors[i % dailyChartColors.length], borderColor: dailyChartColors[i % dailyChartColors.length], borderWidth: 1 };
          });
          chartInstances.dailyComposition = new Chart(dailyCompCanvas, {
            type: 'bar',
            data: { labels: shortLabels, datasets: compDatasets },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: function (ctx) { return (ctx.raw || 0).toFixed(1) + '%'; } } }
              },
              scales: {
                x: { stacked: true, title: { display: true, text: t('date_label') } },
                y: { stacked: true, min: 0, max: 100, title: { display: true, text: 'Share (%)' } }
              }
            }
          });
        }
        if (dailyMetricsCanvas) {
          chartInstances.dailyMetrics = new Chart(dailyMetricsCanvas, {
            type: 'line',
            data: {
              labels: shortLabels,
              datasets: [
                { label: 'Sales per hour (' + t('currency_unit') + ')', data: salesPerHour, borderColor: 'rgb(37, 99, 235)', backgroundColor: 'rgba(37, 99, 235, 0.1)', borderWidth: 2, fill: true, tension: 0.2, pointRadius: 4, yAxisID: 'y' },
                { label: 'Receipt count', data: receiptCounts, borderColor: 'rgb(34, 197, 94)', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderWidth: 2, fill: false, tension: 0.2, pointRadius: 4, yAxisID: 'y1' }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              interaction: { mode: 'index', intersect: false },
              plugins: { legend: { position: 'top' } },
              scales: {
                x: { title: { display: true, text: t('date_label') } },
                y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'Sales per hour (' + t('currency_unit') + ')' } },
                y1: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Receipt count' }, grid: { drawOnChartArea: false } }
              }
            }
          });
        }
      }
    }).then(function () { hideLoading(); }).catch(function () {
      container.innerHTML = '';
      if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = t('daily_load_failed'); }
      hideLoading();
    });
  }

  /* ── Products Tab ────────────────────────────────────── */

  // Product master cache: { [itemNo]: { barcodeNo, nameEng, nameTha, nameJpn, deptCode } }
  var productMasterCache = null;
  var productGroupCache = null; // { code: { description, description_tha, description_jpn } }

  function loadProductGroups() {
    if (productGroupCache !== null) return Promise.resolve(productGroupCache);
    return fetch('/api/product-groups')
      .then(function (res) { return parseJsonResponse(res); })
      .then(function (body) {
        productGroupCache = {};
        if (body && Array.isArray(body.groups)) {
          body.groups.forEach(function (g) { productGroupCache[g.code] = g; });
        }
        return productGroupCache;
      })
      .catch(function () { productGroupCache = null; return {}; });
  }

  function getGroupName(retailProductCode) {
    if (!productGroupCache || !retailProductCode) return '';
    var g = productGroupCache[String(retailProductCode)];
    if (!g) return '';
    var lang = window.i18n && window.i18n.getCurrentLang ? window.i18n.getCurrentLang() : 'en';
    if (lang === 'ja') return g.description_jpn || g.description || '';
    if (lang === 'th') return g.description_tha || g.description || '';
    return g.description || '';
  }

  function loadProductMaster() {
    if (productMasterCache !== null) return Promise.resolve(productMasterCache);
    return fetch('/api/product-master')
      .then(function (res) { return parseJsonResponse(res); })
      .then(function (body) {
        productMasterCache = (body && body.master) ? body.master : {};
        return productMasterCache;
      })
      .catch(function () {
        productMasterCache = null; // allow retry on next call
        return {};
      });
  }

  // Pagination state for products tab
  var productsPagination = { page: 0, pageSize: 20, total: 0, filtered: [] };

  function renderProductsPage() {
    var tbody = document.getElementById('products-tbody');
    var tableWrapper = document.getElementById('products-table-wrapper');
    var emptyEl = document.getElementById('products-empty');
    var noDataEl = document.getElementById('products-no-data');
    var paginationEl = document.getElementById('products-pagination');
    var pageInfoEl = document.getElementById('products-page-info');
    var prevBtn = document.getElementById('products-prev');
    var nextBtn = document.getElementById('products-next');
    if (!tbody) return;

    var filtered = productsPagination.filtered;
    var pageSize = productsPagination.pageSize;
    var page = productsPagination.page;
    var total = filtered.length;

    if (!total) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (noDataEl) noDataEl.hidden = true;
      if (tableWrapper) tableWrapper.style.display = 'none';
      if (paginationEl) paginationEl.style.display = 'none';
      return;
    }

    var totalPages = Math.ceil(total / pageSize);
    if (page >= totalPages) page = Math.max(0, totalPages - 1);
    productsPagination.page = page;

    var start = page * pageSize;
    var pageItems = filtered.slice(start, start + pageSize);
    var grandTotal = filtered.reduce(function (s, p) { return s + (p.totalNetSales || 0); }, 0);

    if (emptyEl) emptyEl.hidden = true;
    if (noDataEl) noDataEl.hidden = true;
    if (tableWrapper) tableWrapper.style.display = '';
    if (paginationEl) {
      paginationEl.style.display = total > pageSize ? 'flex' : 'none';
    }
    if (pageInfoEl) pageInfoEl.textContent = (start + 1) + '–' + Math.min(start + pageSize, total) + ' / ' + total + ' ' + t('pagination_items');
    if (prevBtn) prevBtn.disabled = page === 0;
    if (nextBtn) nextBtn.disabled = page >= totalPages - 1;

    var yData = productsPagination.yesterdayData;
    var wData = productsPagination.lastWeekData;
    var master = productMasterCache || {};
    var html = '';
    pageItems.forEach(function (p, i) {
      var rank = start + i + 1;
      var masterEntry = master[p.itemCode] || null;
      var barcode = masterEntry && masterEntry.barcodeNo ? masterEntry.barcodeNo : p.itemCode;
      var displayName = (masterEntry && masterEntry.nameEng) ? masterEntry.nameEng : (p.itemName || p.itemCode);
      var yNet = yData && yData.byProduct && yData.byProduct[p.itemCode] ? yData.byProduct[p.itemCode].totalNetSales : null;
      var wNet = wData && wData.byProduct && wData.byProduct[p.itemCode] ? wData.byProduct[p.itemCode].totalNetSales : null;
      var dod = (yNet != null && yNet > 0) ? ((p.totalNetSales - yNet) / yNet * 100) : null;
      var wow = (wNet != null && wNet > 0) ? ((p.totalNetSales - wNet) / wNet * 100) : null;
      var sharePct = grandTotal > 0 ? (p.totalNetSales / grandTotal * 100) : 0;
      var unitPrice = (p.totalQuantitySold > 0) ? Math.round(p.totalNetSales / p.totalQuantitySold) : null;
      html += '<tr>';
      html += '<td>' + escapeHtml(barcode) + '</td>';
      html += '<td>' + escapeHtml(displayName) + '</td>';
      html += '<td>' + escapeHtml(p.departmentName) + '</td>';
      html += '<td>' + formatCurrencyInteger(p.totalNetSales) + '</td>';
      html += '<td class="' + (dod == null ? 'na-value' : dod >= 0 ? 'positive' : 'negative') + '">' + (dod == null ? '<span title="' + escapeHtml(t('no_prev_data') || '前日データなし') + '">-</span>' : (dod >= 0 ? '+' : '') + dod.toFixed(1) + '%') + '</td>';
      html += '<td class="' + (wow == null ? 'na-value' : wow >= 0 ? 'positive' : 'negative') + '">' + (wow == null ? '<span title="' + escapeHtml(t('no_last_week_data') || '先週データなし') + '">-</span>' : (wow >= 0 ? '+' : '') + wow.toFixed(1) + '%') + '</td>';
      html += '<td>' + formatInt(p.totalQuantitySold) + '</td>';
      html += '<td>' + (unitPrice != null ? formatCurrencyInteger(unitPrice) : '-') + '</td>';
      html += '<td>' + sharePct.toFixed(1) + '%</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderProductsTab() {
    var storeEl = document.getElementById('products-store-select');
    var dateFromEl = document.getElementById('products-date-from');
    var dateToEl = document.getElementById('products-date-to');
    var deptFilterEl = document.getElementById('products-dept-filter');
    var sortKeyEl = document.getElementById('products-sort-key');
    var searchEl = document.getElementById('products-search');
    var pageSizeEl = document.getElementById('products-page-size');
    var tbody = document.getElementById('products-tbody');
    var emptyEl = document.getElementById('products-empty');
    var noDataEl = document.getElementById('products-no-data');
    var tableWrapper = document.getElementById('products-table-wrapper');
    var paginationEl = document.getElementById('products-pagination');
    if (!tbody) return;

    var storeId = storeEl ? storeEl.value : 'default';
    var dateFrom = dateFromEl ? dateFromEl.value : '';
    var dateTo = dateToEl ? dateToEl.value : '';
    var deptFilter = deptFilterEl ? deptFilterEl.value : '';
    var sortKey = sortKeyEl ? sortKeyEl.value : 'net';
    var searchQ = searchEl ? searchEl.value.trim().toLowerCase() : '';
    var pageSize = pageSizeEl ? parseInt(pageSizeEl.value, 10) : 20;

    if (!dateFrom) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (noDataEl) noDataEl.hidden = true;
      if (tableWrapper) tableWrapper.style.display = 'none';
      if (paginationEl) paginationEl.style.display = 'none';
      return;
    }

    if (!dateTo || dateTo < dateFrom) dateTo = dateFrom;

    // Build list of dates in range (string comparison avoids timezone issues)
    var dates = [];
    var cur = dateFrom;
    while (cur <= dateTo && dates.length < 90) {
      dates.push(cur);
      cur = addDays(cur, 1);
    }
    var isSingleDay = dates.length === 1;

    showLoading();
    Promise.all([
      Promise.all(dates.map(function (d) {
        return fetch('/api/report?referenceDate=' + encodeURIComponent(d) + '&storeId=' + encodeURIComponent(storeId))
          .then(function (res) { return parseJsonResponse(res); })
          .catch(function () { return null; });
      })),
      loadProductMaster(),
      loadProductGroups(),
    ])
      .then(function (results) {
        hideLoading();
        var reports = results[0];

        // Aggregate byProduct across all dates
        var mergedByProduct = {};
        reports.forEach(function (body) {
          if (!body || !body.today || !body.today.byProduct) return;
          Object.keys(body.today.byProduct).forEach(function (itemCode) {
            var p = body.today.byProduct[itemCode];
            if (!mergedByProduct[itemCode]) {
              mergedByProduct[itemCode] = {
                itemCode: p.itemCode,
                itemName: p.itemName,
                departmentName: p.departmentName,
                totalNetSales: 0,
                totalQuantitySold: 0,
              };
            }
            mergedByProduct[itemCode].totalNetSales += p.totalNetSales || 0;
            mergedByProduct[itemCode].totalQuantitySold += p.totalQuantitySold || 0;
          });
        });

        var yesterdayData = (isSingleDay && reports[0]) ? (reports[0].yesterday || null) : null;
        var lastWeekData = (isSingleDay && reports[0]) ? (reports[0].lastWeek || null) : null;

        if (Object.keys(mergedByProduct).length === 0) {
          tbody.innerHTML = '';
          var hasAnyData = reports.some(function (b) { return b && b.today; });
          if (emptyEl) emptyEl.hidden = hasAnyData;
          if (noDataEl) noDataEl.hidden = hasAnyData;
          if (tableWrapper) tableWrapper.style.display = 'none';
          if (paginationEl) paginationEl.style.display = 'none';
          return;
        }

        var products = Object.values(mergedByProduct);
        if (deptFilter) {
          products = products.filter(function (p) { return p.departmentName === deptFilter; });
        }
        products.sort(function (a, b) {
          if (sortKey === 'qty') return (b.totalQuantitySold || 0) - (a.totalQuantitySold || 0);
          return (b.totalNetSales || 0) - (a.totalNetSales || 0);
        });

        if (searchQ) {
          var master = productMasterCache || {};
          products = products.filter(function (p) {
            var m = master[p.itemCode] || {};
            return (
              (p.itemCode && p.itemCode.toLowerCase().includes(searchQ)) ||
              (p.itemName && p.itemName.toLowerCase().includes(searchQ)) ||
              (m.barcodeNo && m.barcodeNo.toLowerCase().includes(searchQ)) ||
              (m.nameEng && m.nameEng.toLowerCase().includes(searchQ)) ||
              (m.nameTha && m.nameTha.toLowerCase().includes(searchQ))
            );
          });
        }

        productsPagination.filtered = products;
        productsPagination.pageSize = pageSize;
        productsPagination.page = 0;
        productsPagination.yesterdayData = yesterdayData;
        productsPagination.lastWeekData = lastWeekData;
        renderProductsPage();
      })
      .catch(function () {
        hideLoading();
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        if (noDataEl) noDataEl.hidden = true;
        if (tableWrapper) tableWrapper.style.display = 'none';
        if (paginationEl) paginationEl.style.display = 'none';
      });
  }

  function renderDepartmentProductBreakdown(todayData, dept, forceFilterFromComposition) {
    var section = document.getElementById('product-breakdown-section');
    var list = document.getElementById('product-breakdown-list');
    var moreLink = document.getElementById('product-breakdown-more');
    if (!section || !list) return;

    var selectedDept = (!dept || dept === 'Total') ? null : dept;

    if (!todayData || !todayData.byProduct) {
      section.hidden = true;
      list.innerHTML = '';
      if (moreLink) moreLink.hidden = true;
      if (list) {
        list.style.maxHeight = '';
        list.style.overflowY = '';
      }
      return;
    }

    var products = Object.values(todayData.byProduct).filter(function (p) {
      if (!selectedDept || selectedDept === 'Total') return true;
      return p.departmentName === selectedDept;
    });
    products.sort(function (a, b) { return (b.totalNetSales || 0) - (a.totalNetSales || 0); });
    products = products.slice(0, 10);

    if (!products.length) {
      section.hidden = true;
      list.innerHTML = '';
      if (moreLink) moreLink.hidden = true;
      if (list) {
        list.style.maxHeight = '';
        list.style.overflowY = '';
      }
      return;
    }

    var html = '<div class="product-breakdown-row header">' +
      '<span>' + t('product_breakdown_rank') + '</span><span>' + t('product_breakdown_name') + '</span><span>' + t('qty_sold') + '</span><span>' + t('product_breakdown_sales') + '</span>' +
      '</div>';
    products.forEach(function (p, i) {
      html += '<div class="product-breakdown-row">';
      html += '<span class="product-breakdown-rank">' + (i + 1) + '</span>';
      html += '<span class="product-breakdown-name">' + escapeHtml(p.itemName || p.itemCode) + '</span>';
      html += '<span class="product-breakdown-qty">' + formatInt(p.totalQuantitySold || 0) + '</span>';
      html += '<span class="product-breakdown-value">' + formatCurrencyInteger(p.totalNetSales) + '</span>';
      html += '</div>';
    });
    list.innerHTML = html;
    if (moreLink) moreLink.hidden = false;
    section.hidden = false;
    syncInsightsSplitHeight();
  }

  function syncInsightsSplitHeight() {
    var split = document.getElementById('insights-split');
    var left = document.getElementById('composition-section');
    var right = document.getElementById('product-breakdown-section');
    var list = document.getElementById('product-breakdown-list');
    if (!split || !left || !right || !list || right.hidden) return;
    if (window.innerWidth <= 767) {
      right.style.height = '';
      right.style.overflow = '';
      list.style.maxHeight = '';
      list.style.height = '';
      list.style.overflowY = 'visible';
      return;
    }
    var leftHeight = left.getBoundingClientRect().height;
    if (!(leftHeight > 0)) return;
    right.style.height = '';
    right.style.overflow = '';
    var title = right.querySelector('h3');
    var more = document.getElementById('product-breakdown-more');
    var titleH = title ? title.getBoundingClientRect().height : 0;
    var moreEl = more && !more.hidden ? more : null;
    var moreH = moreEl ? (moreEl.getBoundingClientRect().height + 8) : 0;
    var style = window.getComputedStyle(right);
    var paddingTop = parseFloat(style.paddingTop) || 0;
    var paddingBottom = parseFloat(style.paddingBottom) || 0;
    var gap = 16;
    var available = Math.max(160, Math.floor(leftHeight - titleH - moreH - paddingTop - paddingBottom - gap));
    list.style.maxHeight = available + 'px';
    list.style.height = available + 'px';
    list.style.overflowY = 'auto';
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fillStoreSelect() {
    var sel = document.getElementById('store-select');
    var dailySel = document.getElementById('daily-store-select');
    var weeklySel = document.getElementById('weekly-store-select');
    var aiSel = document.getElementById('ai-store-select');
    var productsSel = document.getElementById('products-store-select');
    if (!sel) return Promise.resolve();
    return fetch('/api/stores').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var stores = body.stores || [];
      if (stores.length === 0) stores = [{ id: 'default', name: 'Default' }];
      state.stores = stores;
      state.exchangeRate = body.exchangeRate != null ? body.exchangeRate : null;
      state.exchangeRateUpdatedAt = body.exchangeRateUpdatedAt || null;
      function fillOne(selectEl) {
        if (!selectEl) return;
        var currentVal = selectEl.value;
        selectEl.innerHTML = '';
        stores.forEach(function (s) {
          var opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name || s.id;
          selectEl.appendChild(opt);
        });
        if (currentVal && stores.some(function (s) { return s.id === currentVal; })) selectEl.value = currentVal;
      }
      fillOne(sel);
      fillOne(dailySel);
      fillOne(weeklySel);
      fillOne(aiSel);
      fillOne(productsSel);
      state.storeId = getSelectedStoreId();
    }).catch(function () {
      var def = '<option value="default">Default</option>';
      if (sel) sel.innerHTML = def;
      if (dailySel) dailySel.innerHTML = def;
      if (weeklySel) weeklySel.innerHTML = def;
      if (aiSel) aiSel.innerHTML = def;
      if (productsSel) productsSel.innerHTML = def;
      state.storeId = 'default';
    });
  }

  function onStoreChange() {
    state.storeId = getSelectedStoreId();
    fetchBusinessHours();
    refreshOutputDateSelect();
    updateHourlyFiltersSummaryBar();
  }

  /* ── AI Tab ──────────────────────────────────────────── */

  var aiState = { available: null };

  function getAiStoreId() {
    var el = document.getElementById('ai-store-select');
    return el && el.value ? el.value : 'default';
  }

  function getAiLang() {
    return (window.i18n && window.i18n.getCurrentLang) ? window.i18n.getCurrentLang() : 'en';
  }

  function getAiDepartment() {
    var el = document.getElementById('ai-department-select');
    return el && el.value ? el.value : 'Total';
  }

  function checkAiStatus() {
    fetch('/api/ai/status').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      aiState.available = !!body.available;
      var notice = document.getElementById('ai-not-configured');
      var controls = document.getElementById('ai-controls');
      if (notice) notice.hidden = aiState.available;
      if (controls) {
        var btns = controls.querySelectorAll('.btn-ai');
        btns.forEach(function (b) { b.disabled = !aiState.available; });
      }
    }).catch(function () {
      aiState.available = false;
    });
  }

  function refreshAiDateSelect() {
    var storeId = getAiStoreId();
    fetch('/api/dates?storeId=' + encodeURIComponent(storeId)).then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var dates = body.dates || [];
      var el = document.getElementById('ai-reference-date');
      if (!el) return;
      var arr = dates.slice().sort();
      if (arr.length) {
        el.min = arr[0];
        el.max = arr[arr.length - 1];
        if (!el.value || arr.indexOf(el.value) === -1) {
          el.value = arr[arr.length - 1];
        }
      }
    }).catch(function () {});
  }

  function showAiLoading(show) {
    var el = document.getElementById('ai-loading');
    if (el) el.hidden = !show;
  }

  function showAiError(msg) {
    var el = document.getElementById('ai-error');
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function getAiErrorDetail(err) {
    if (err == null) return '';
    if (typeof err === 'string') {
      var s = err.trim();
      if (s.charAt(0) === '{') {
        try {
          var o = JSON.parse(s);
          var m = (o && o.error && o.error.message) || (o && o.message);
          if (m && typeof m === 'string') return m.replace(/\n/g, ' ').slice(0, 400);
        } catch (e) {}
      }
      return s.slice(0, 400);
    }
    if (typeof err === 'object') {
      var m = err.message || (err.error && err.error.message);
      if (m && typeof m === 'string') return m.replace(/\n/g, ' ').slice(0, 400);
    }
    return String(err).slice(0, 400);
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(text || '');
    }
    return '<p>' + (text || '').replace(/\n/g, '<br>') + '</p>';
  }

  function getTodayStr() {
    return getThailandDateStr();
  }

  function doAiGenerate() {
    var dateEl = document.getElementById('ai-reference-date');
    var refDate = dateEl ? dateEl.value : '';
    if (!refDate) return;
    var todayStr = getTodayStr();
    var storeId = getAiStoreId();
    var department = getAiDepartment();
    var lang = getAiLang();
    showAiError(null);
    showAiLoading(true);
    var btn = document.getElementById('btn-ai-generate');
    if (btn) btn.disabled = true;

    var analysisSection = document.getElementById('ai-analysis-section');
    var todaySection = document.getElementById('ai-today-section');
    var forecastSection = document.getElementById('ai-forecast-section');
    var results = document.getElementById('ai-results');

    function hideAllSections() {
      if (analysisSection) analysisSection.hidden = true;
      if (todaySection) todaySection.hidden = true;
      if (forecastSection) forecastSection.hidden = true;
    }

    function done() {
      showAiLoading(false);
      if (btn) btn.disabled = !aiState.available;
    }

    if (refDate < todayStr) {
      fetch('/api/ai/analyze?storeId=' + encodeURIComponent(storeId) + '&referenceDate=' + encodeURIComponent(refDate) + '&department=' + encodeURIComponent(department) + '&lang=' + encodeURIComponent(lang))
        .then(function (res) { return parseJsonResponse(res); })
        .then(function (body) {
          done();
          if (body.ok) {
            hideAllSections();
            var content = document.getElementById('ai-analysis-content');
            if (content) content.innerHTML = renderMarkdown(body.text);
            if (analysisSection) analysisSection.hidden = false;
            if (results) results.hidden = false;
          } else {
            var errKey = body.error === 'NO_DATA' ? 'ai_error_no_data'
              : body.error === 'AI_NOT_CONFIGURED' ? 'ai_error_not_configured'
              : 'ai_error_generic';
            var detail = (errKey === 'ai_error_generic' && body.error) ? ' ' + getAiErrorDetail(body.error) : '';
            showAiError(t(errKey) + detail);
          }
        })
        .catch(function (err) {
          done();
          var detail = (err && err.message) ? ' (' + String(err.message).slice(0, 200) + ')' : '';
          showAiError(t('ai_error_generic') + detail);
        });
    } else if (refDate > todayStr) {
      fetch('/api/ai/forecast?storeId=' + encodeURIComponent(storeId) + '&referenceDate=' + encodeURIComponent(refDate) + '&department=' + encodeURIComponent(department) + '&lang=' + encodeURIComponent(lang))
        .then(function (res) { return parseJsonResponse(res); })
        .then(function (body) {
          done();
          if (body.ok) {
            hideAllSections();
            var content = document.getElementById('ai-forecast-content');
            if (content) content.innerHTML = renderMarkdown(body.text);
            if (forecastSection) forecastSection.hidden = false;
            if (results) results.hidden = false;
          } else {
            var errKey = body.error === 'NO_DATA' ? 'ai_error_no_data'
              : body.error === 'AI_NOT_CONFIGURED' ? 'ai_error_not_configured'
              : 'ai_error_generic';
            var detail = (errKey === 'ai_error_generic' && body.error) ? ' ' + getAiErrorDetail(body.error) : '';
            showAiError(t(errKey) + detail);
          }
        })
        .catch(function (err) {
          done();
          var detail = (err && err.message) ? ' (' + String(err.message).slice(0, 200) + ')' : '';
          showAiError(t('ai_error_generic') + detail);
        });
    } else {
      var currentTimeIso = new Date().toISOString();
      var url = '/api/ai/today?storeId=' + encodeURIComponent(storeId) + '&referenceDate=' + encodeURIComponent(refDate) + '&department=' + encodeURIComponent(department) + '&lang=' + encodeURIComponent(lang) + '&currentTime=' + encodeURIComponent(currentTimeIso);
      fetch(url)
        .then(function (res) { return parseJsonResponse(res); })
        .then(function (body) {
          done();
          if (body.ok) {
            hideAllSections();
            var content = document.getElementById('ai-today-content');
            if (content) content.innerHTML = renderMarkdown(body.text);
            if (todaySection) todaySection.hidden = false;
            if (results) results.hidden = false;
          } else {
            var errKey = body.error === 'NO_DATA' ? 'ai_error_no_data'
              : body.error === 'AI_NOT_CONFIGURED' ? 'ai_error_not_configured'
              : 'ai_error_generic';
            var detail = (errKey === 'ai_error_generic' && body.error) ? ' ' + getAiErrorDetail(body.error) : '';
            showAiError(t(errKey) + detail);
          }
        })
        .catch(function (err) {
          done();
          var detail = (err && err.message) ? ' (' + String(err.message).slice(0, 200) + ')' : '';
          showAiError(t('ai_error_generic') + detail);
        });
    }
  }

  /* ── End AI Tab ─────────────────────────────────────── */

  var authState = {
    loggedIn: false,
    role: null,
    username: null,
    displayName: null,
    preferredStore: null,
    preferredDepartment: null,
    preferredCurrency: null,
    preferredLanguage: null,
    needsProfileSetup: false
  };

  function updateHeaderAuth() {
    return fetch('/api/auth/status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        authState.loggedIn = !!data.loggedIn;
        authState.role = data.role || null;
        authState.username = data.username || null;
        authState.displayName = data.displayName || null;
        authState.preferredStore = data.preferredStore || null;
        authState.preferredDepartment = data.preferredDepartment || null;
        authState.preferredCurrency = data.preferredCurrency || null;
        authState.preferredLanguage = data.preferredLanguage || null;
        authState.needsProfileSetup = !!data.needsProfileSetup;

        var usernameEl = document.getElementById('header-username');
        if (usernameEl) usernameEl.textContent = data.displayName || data.username || '';
        var userMenuEl = document.getElementById('user-menu');
        if (userMenuEl) userMenuEl.style.display = data.loggedIn ? '' : 'none';
        var settingsEl = document.getElementById('settings-link');
        if (settingsEl) settingsEl.style.display = data.loggedIn ? '' : 'none';
        var logoutEl = document.getElementById('logout-link');
        if (logoutEl) logoutEl.style.display = data.loggedIn ? '' : 'none';
        var setupEl = document.getElementById('setup-link');
        if (setupEl) setupEl.style.display = (data.loggedIn && data.role === 'admin') ? '' : 'none';

      })
      .catch(function () {
        authState.loggedIn = false;
        authState.role = null;
        authState.username = null;
        authState.displayName = null;
        authState.preferredStore = null;
        authState.preferredDepartment = null;
        authState.preferredCurrency = null;
        authState.preferredLanguage = null;
        authState.needsProfileSetup = false;
        var userMenuEl = document.getElementById('user-menu');
        if (userMenuEl) userMenuEl.style.display = 'none';
        var settingsEl = document.getElementById('settings-link');
        if (settingsEl) settingsEl.style.display = 'none';
        var logoutEl = document.getElementById('logout-link');
        if (logoutEl) logoutEl.style.display = 'none';
        var setupEl = document.getElementById('setup-link');
        if (setupEl) setupEl.style.display = 'none';
      });
  }

  function applyUserPreferences() {
    var storeId = authState.preferredStore;
    var department = authState.preferredDepartment || 'Total';
    var preferredCurrency = authState.preferredCurrency;
    var preferredLanguage = authState.preferredLanguage;
    var storeSelects = ['store-select', 'ai-store-select'];
    storeSelects.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && storeId && Array.prototype.some.call(el.options, function (o) { return o.value === storeId; })) {
        el.value = storeId;
      }
    });
    var deptSelects = ['department-select', 'ai-department-select', 'allstores-department-select', 'settings-department-select'];
    deptSelects.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && department && Array.prototype.some.call(el.options, function (o) { return o.value === department; })) {
        el.value = department;
      }
    });
    // daily-dept-select: Total option has value="" (not "Total")
    var dailyDeptEl = document.getElementById('daily-dept-select');
    if (dailyDeptEl) {
      var dailyDeptVal = (department === 'Total') ? '' : department;
      if (Array.prototype.some.call(dailyDeptEl.options, function (o) { return o.value === dailyDeptVal; })) {
        dailyDeptEl.value = dailyDeptVal;
      }
    }
    // Products tab dept filter: 'Total' maps to '' (all depts)
    var productsDeptEl = document.getElementById('products-dept-filter');
    if (productsDeptEl) {
      var prodDept = (department === 'Total') ? '' : department;
      if (Array.prototype.some.call(productsDeptEl.options, function (o) { return o.value === prodDept; })) {
        productsDeptEl.value = prodDept;
      }
    }
    if (preferredCurrency === 'THB' || preferredCurrency === 'JPY') {
      state.currency = preferredCurrency;
    }
    if (preferredLanguage && window.i18n && typeof window.i18n.setLanguage === 'function') {
      var currentLang = (window.i18n.getCurrentLang && window.i18n.getCurrentLang()) || null;
      if (currentLang !== preferredLanguage) window.i18n.setLanguage(preferredLanguage);
    }
    if (storeId) state.storeId = storeId;
    updateDailyExportOptions();
  }

  function openSettingsModal(forceInitialSetup) {
    var settingsModal = document.getElementById('settings-modal');
    if (!settingsModal) return;
    var storeSel = document.getElementById('settings-store-select');
    var mainStore = document.getElementById('store-select');
    if (storeSel && mainStore) {
      storeSel.innerHTML = '';
      Array.prototype.forEach.call(mainStore.options, function (opt) {
        var o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.textContent;
        storeSel.appendChild(o);
      });
      storeSel.value = authState.preferredStore && Array.prototype.some.call(storeSel.options, function (o) { return o.value === authState.preferredStore; })
        ? authState.preferredStore
        : (mainStore.value || 'default');
    }
    var deptSel = document.getElementById('settings-department-select');
    refreshDepartmentSelectLabels();
    if (deptSel) {
      deptSel.value = authState.preferredDepartment && Array.prototype.some.call(deptSel.options, function (o) { return o.value === authState.preferredDepartment; })
        ? authState.preferredDepartment
        : 'Total';
    }
    var currencySel = document.getElementById('settings-currency-select');
    if (currencySel) {
      currencySel.value = (authState.preferredCurrency === 'JPY' || authState.preferredCurrency === 'THB')
        ? authState.preferredCurrency
        : (state.currency === 'JPY' ? 'JPY' : 'THB');
    }
    var languageSel = document.getElementById('settings-language-select');
    if (languageSel) {
      var currentLang = (window.i18n && window.i18n.getCurrentLang) ? window.i18n.getCurrentLang() : 'ja';
      languageSel.value = (authState.preferredLanguage === 'ja' || authState.preferredLanguage === 'en' || authState.preferredLanguage === 'th')
        ? authState.preferredLanguage
        : currentLang;
    }
    var titleEl = document.getElementById('settings-modal-title');
    var cancelBtn = document.getElementById('settings-cancel-btn');
    if (forceInitialSetup) {
      if (titleEl) titleEl.textContent = (t('settings_title') || 'Settings') + ' *';
      if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
      if (titleEl) titleEl.textContent = t('settings_title') || 'Settings';
      if (cancelBtn) cancelBtn.style.display = '';
    }
    settingsModal.hidden = false;
  }

  function init() {
    var mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    var headerMenu = document.getElementById('header-menu');
    function closeMobileMenu() {
      if (!headerMenu || !mobileMenuToggle) return;
      headerMenu.classList.remove('mobile-open');
      mobileMenuToggle.setAttribute('aria-expanded', 'false');
    }
    function updateMobileMenuLayout() {
      if (window.innerWidth > 768) closeMobileMenu();
    }
    if (mobileMenuToggle && headerMenu) {
      mobileMenuToggle.addEventListener('click', function () {
        var expanded = mobileMenuToggle.getAttribute('aria-expanded') === 'true';
        mobileMenuToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        headerMenu.classList.toggle('mobile-open', !expanded);
      });
      document.addEventListener('click', function (e) {
        if (!headerMenu.classList.contains('mobile-open')) return;
        if (headerMenu.contains(e.target) || mobileMenuToggle.contains(e.target)) return;
        closeMobileMenu();
      });
      window.addEventListener('resize', updateMobileMenuLayout);
    }

    var userMenuButton = document.getElementById('user-menu-button');
    var userMenuDropdown = document.getElementById('user-menu-dropdown');
    function closeUserMenu() {
      if (!userMenuButton || !userMenuDropdown) return;
      userMenuButton.setAttribute('aria-expanded', 'false');
      userMenuDropdown.hidden = true;
    }
    if (userMenuButton && userMenuDropdown) {
      userMenuButton.addEventListener('click', function (e) {
        e.stopPropagation();
        var expanded = userMenuButton.getAttribute('aria-expanded') === 'true';
        userMenuButton.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        userMenuDropdown.hidden = expanded;
      });
      document.addEventListener('click', function (e) {
        if (userMenuDropdown.hidden) return;
        if (userMenuDropdown.contains(e.target) || userMenuButton.contains(e.target)) return;
        closeUserMenu();
      });
    }

    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    applySnapshotDetailVisibility();

    var storeSelectEl = document.getElementById('store-select');
    if (storeSelectEl) storeSelectEl.addEventListener('change', onStoreChange);

    function updateHourlyFiltersLayout() {
      var toggle = document.getElementById('hourly-filters-toggle');
      var header = document.getElementById('hourly-output-header');
      if (!toggle || !header) return;
      var mobile = window.innerWidth <= 768;
      if (!mobile) {
        toggle.hidden = true;
        header.classList.remove('is-collapsed');
        toggle.setAttribute('aria-expanded', 'true');
        return;
      }
      toggle.hidden = false;
      if (!header.classList.contains('is-collapsed') && toggle.getAttribute('aria-expanded') !== 'true') {
        header.classList.add('is-collapsed');
      }
      if (!toggle.hasAttribute('data-bound')) {
        toggle.addEventListener('click', function () {
          var expanded = toggle.getAttribute('aria-expanded') === 'true';
          toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
          header.classList.toggle('is-collapsed', expanded);
        });
        toggle.setAttribute('data-bound', '1');
      }
      updateHourlyFiltersSummaryBar();
    }
    window.addEventListener('resize', updateHourlyFiltersLayout);

    var departmentSelect = document.getElementById('department-select');
    if (departmentSelect) {
      departmentSelect.addEventListener('change', function () {
        selectedCompositionDept = null;
        renderReport();
        updateHourlyFiltersSummaryBar();
      });
    }

    var chartTabSales = document.getElementById('chart-tab-sales');
    var chartTabReceipts = document.getElementById('chart-tab-receipts');
    if (chartTabSales) {
      chartTabSales.addEventListener('click', function () { setHourlyChartTab('sales'); });
    }
    if (chartTabReceipts) {
      chartTabReceipts.addEventListener('click', function () { setHourlyChartTab('receipts'); });
    }
    var chartTabForecastSales = document.getElementById('chart-tab-forecast-sales');
    var chartTabForecastReceipts = document.getElementById('chart-tab-forecast-receipts');
    if (chartTabForecastSales) {
      chartTabForecastSales.addEventListener('click', function () { setForecastChartTab('sales'); });
    }
    if (chartTabForecastReceipts) {
      chartTabForecastReceipts.addEventListener('click', function () { setForecastChartTab('receipts'); });
    }
    window.addEventListener('resize', function () {
      if (lastCompositionData) renderComposition(lastCompositionData);
      syncInsightsSplitHeight();
      var hourlyPanel = document.getElementById('hourly-panel');
      if (hourlyPanel && hourlyPanel.classList.contains('active') && state.today) {
        renderReport();
      }
    });

    var outputDateEl = document.getElementById('output-date');
    if (outputDateEl) outputDateEl.addEventListener('change', function () {
      var date = this.value;
      if (!date) return;
      showLoading();
      var storeId = getSelectedStoreId();
      fetch('/api/report?referenceDate=' + encodeURIComponent(date) + '&storeId=' + encodeURIComponent(storeId)).then(function (res) {
        return parseJsonResponse(res).then(function (body) {
          if (!res.ok) throw new Error(body.error || 'Failed to load report');
          return body;
        });
      }).then(function (body) {
        state.today = body.today;
        state.yesterday = body.yesterday || null;
        state.lastWeek = body.lastWeek || null;
        state.referenceDate = body.referenceDate;
        var allstoresSync = document.getElementById('allstores-date');
        if (allstoresSync) allstoresSync.value = date;
        var productsSyncFrom = document.getElementById('products-date-from');
        var productsSyncTo = document.getElementById('products-date-to');
        if (productsSyncFrom) productsSyncFrom.value = date;
        if (productsSyncTo) productsSyncTo.value = date;
        renderReport();
        updateHourlyFiltersSummaryBar();
        updateAutoRefreshStatus();
        startAutoRefresh();
      }).then(function () { hideLoading(); }).catch(function () { hideLoading(); });
    });

    var allstoresDateEl = document.getElementById('allstores-date');
    var allstoresDeptEl = document.getElementById('allstores-department-select');
    var allstoresSortKeyEl = document.getElementById('allstores-sort-key');
    if (allstoresDateEl) allstoresDateEl.addEventListener('change', renderAllStoresDigest);
    if (allstoresDeptEl) allstoresDeptEl.addEventListener('change', renderAllStoresDigest);
    if (allstoresSortKeyEl) allstoresSortKeyEl.addEventListener('change', renderAllStoresDigest);

    var productsDeptFilterEl = document.getElementById('products-dept-filter');
    var productsSortKeyEl = document.getElementById('products-sort-key');
    var productsStoreEl = document.getElementById('products-store-select');
    var productsDateFromEl = document.getElementById('products-date-from');
    var productsDateToEl = document.getElementById('products-date-to');
    var productsSearchEl = document.getElementById('products-search');
    var productsPageSizeEl = document.getElementById('products-page-size');
    var productsPrevBtn = document.getElementById('products-prev');
    var productsNextBtn = document.getElementById('products-next');
    if (productsDeptFilterEl) productsDeptFilterEl.addEventListener('change', function () { productsPagination.page = 0; renderProductsTab(); });
    if (productsSortKeyEl) productsSortKeyEl.addEventListener('change', function () { productsPagination.page = 0; renderProductsTab(); });
    if (productsStoreEl) productsStoreEl.addEventListener('change', function () { productsPagination.page = 0; renderProductsTab(); });
    if (productsDateFromEl) productsDateFromEl.addEventListener('change', function () { productsPagination.page = 0; renderProductsTab(); });
    if (productsDateToEl) productsDateToEl.addEventListener('change', function () { productsPagination.page = 0; renderProductsTab(); });
    if (productsPageSizeEl) productsPageSizeEl.addEventListener('change', function () {
      productsPagination.pageSize = parseInt(this.value, 10);
      productsPagination.page = 0;
      renderProductsPage();
    });
    if (productsSearchEl) {
      var productsSearchTimer;
      productsSearchEl.addEventListener('input', function () {
        clearTimeout(productsSearchTimer);
        productsSearchTimer = setTimeout(function () { productsPagination.page = 0; renderProductsTab(); }, 200);
      });
    }
    if (productsPrevBtn) productsPrevBtn.addEventListener('click', function () {
      if (productsPagination.page > 0) { productsPagination.page--; renderProductsPage(); }
    });
    if (productsNextBtn) productsNextBtn.addEventListener('click', function () {
      var totalPages = Math.ceil(productsPagination.filtered.length / productsPagination.pageSize);
      if (productsPagination.page < totalPages - 1) { productsPagination.page++; renderProductsPage(); }
    });
    var productsExportBtn = document.getElementById('btn-products-export');
    var productsExportModal = document.getElementById('products-export-modal');
    var _productsExportParams = null;

    function doProductsExport(type) {
      if (!_productsExportParams) return;
      var params = new URLSearchParams(_productsExportParams);
      params.set('type', type || 'summary');
      window.location.href = '/api/products/export?' + params.toString();
    }

    if (productsExportBtn) {
      productsExportBtn.addEventListener('click', function () {
        var storeEl = document.getElementById('products-store-select');
        var dateFromEl = document.getElementById('products-date-from');
        var dateToEl = document.getElementById('products-date-to');
        var deptEl = document.getElementById('products-dept-filter');
        var dateFrom = dateFromEl ? dateFromEl.value : '';
        if (!dateFrom) return;
        var dateTo = dateToEl ? (dateToEl.value || dateFrom) : dateFrom;
        _productsExportParams = {
          storeId: storeEl ? storeEl.value : 'default',
          dateFrom: dateFrom,
          dateTo: dateTo,
        };
        if (deptEl && deptEl.value) _productsExportParams.dept = deptEl.value;

        var isMultiDate = dateTo && dateTo !== dateFrom;
        if (isMultiDate && productsExportModal) {
          // Reset radio to summary
          var radios = productsExportModal.querySelectorAll('input[name="products-export-type"]');
          radios.forEach(function(r) { r.checked = r.value === 'summary'; });
          productsExportModal.hidden = false;
        } else {
          doProductsExport('summary');
        }
      });
    }

    var productsExportConfirm = document.getElementById('products-export-confirm');
    if (productsExportConfirm) {
      productsExportConfirm.addEventListener('click', function () {
        var selected = document.querySelector('input[name="products-export-type"]:checked');
        var type = selected ? selected.value : 'summary';
        if (productsExportModal) productsExportModal.hidden = true;
        doProductsExport(type);
      });
    }

    var productsExportCancel = document.getElementById('products-export-cancel');
    if (productsExportCancel) {
      productsExportCancel.addEventListener('click', function () {
        if (productsExportModal) productsExportModal.hidden = true;
      });
    }

    if (productsExportModal) {
      productsExportModal.addEventListener('click', function (e) {
        if (e.target === productsExportModal) productsExportModal.hidden = true;
      });
    }
    var productBreakdownMore = document.getElementById('product-breakdown-more');
    if (productBreakdownMore) {
      productBreakdownMore.addEventListener('click', function (e) {
        e.preventDefault();
        switchTab('products');
        var deptFilterEl = document.getElementById('products-dept-filter');
        if (deptFilterEl && selectedCompositionDept) deptFilterEl.value = selectedCompositionDept;
        renderProductsTab();
      });
    }

    var langSelect = document.getElementById('lang-select');
    var logoutLink = document.getElementById('logout-link');
    var setupLink = document.getElementById('setup-link');
    var settingsLinkForMenu = document.getElementById('settings-link');
    if (langSelect) langSelect.addEventListener('change', closeMobileMenu);
    if (logoutLink) logoutLink.addEventListener('click', function () { closeMobileMenu(); closeUserMenu(); });
    if (setupLink) setupLink.addEventListener('click', closeMobileMenu);
    if (settingsLinkForMenu) settingsLinkForMenu.addEventListener('click', closeUserMenu);

    var dailyStoreEl = document.getElementById('daily-store-select');
    var dailyStartEl = document.getElementById('daily-start-date');
    var dailyEndEl = document.getElementById('daily-end-date');
    if (dailyStoreEl) dailyStoreEl.addEventListener('change', function () { refreshDailyDateSelect(); });
    if (dailyStartEl) dailyStartEl.addEventListener('change', renderDailySummary);
    if (dailyEndEl) dailyEndEl.addEventListener('change', renderDailySummary);
    var dailyDeptEl = document.getElementById('daily-dept-select');
    if (dailyDeptEl) dailyDeptEl.addEventListener('change', function () {
      updateDailyExportOptions();
      renderDailySummary();
    });
    updateDailyExportOptions();

    var weeklyStoreEl = document.getElementById('weekly-store-select');
    var weeklyEndEl = document.getElementById('weekly-end-date');
    var weeklyNumEl = document.getElementById('weekly-num-weeks');
    if (weeklyStoreEl) weeklyStoreEl.addEventListener('change', function () { refreshWeeklyDateSelect(); });
    if (weeklyEndEl) weeklyEndEl.addEventListener('change', renderWeeklySummary);
    if (weeklyNumEl) weeklyNumEl.addEventListener('change', renderWeeklySummary);

    var btnDailyExcel = document.getElementById('btn-daily-excel');
    if (btnDailyExcel) {
      btnDailyExcel.addEventListener('click', function () {
        var sel = document.getElementById('daily-export-select');
        var opt = sel ? sel.value : 'all';
        var dept = getDailyDept();

        // Classification level exports for non-Total dept mode
        if (dept && opt === '1') { exportClassificationByLevel(1); return; }
        if (dept && opt === '2') { exportClassificationByLevel(2); return; }
        if (dept && opt === '3') { exportClassificationByLevel(3); return; }
        if (dept && opt === '4') { exportClassificationByLevel(4); return; }

        var dateStr = (document.getElementById('daily-start-date') || {}).value || '';
        var dateEnd = (document.getElementById('daily-end-date') || {}).value || '';
        var suffix = dateStr && dateEnd && dateStr !== dateEnd ? dateStr + '_' + dateEnd : (dateStr || dateEnd);
        // In dept mode, opt '4' (key_metrics) has no separate table → export all
        var tableOpt = (dept && opt === '4') ? 'all' : opt;
        var filename = 'daily_summary' + (dept ? '_' + dept.replace(/[^a-zA-Z0-9]/g, '') : '') + (suffix ? '_' + suffix : '') + '.xlsx';
        exportPanelTablesXlsx('daily-summary-tables', filename, tableOpt);
      });
    }
    var btnWeeklyExcel = document.getElementById('btn-weekly-excel');
    if (btnWeeklyExcel) {
      btnWeeklyExcel.addEventListener('click', function () {
        var sel = document.getElementById('weekly-export-select');
        var dateStr = (document.getElementById('weekly-end-date') || {}).value || '';
        exportPanelTablesXlsx('weekly-summary-tables', 'weekly_summary' + (dateStr ? '_' + dateStr : '') + '.xlsx', sel ? sel.value : 'all');
      });
    }

    window.addEventListener('languageChange', function () {
      refreshDepartmentSelectLabels();
      refreshCurrencyTexts();
      renderReport();
      var allstoresPanel = document.getElementById('allstores-panel');
      if (allstoresPanel && allstoresPanel.classList.contains('active')) renderAllStoresDigest();
      updateDailyExportOptions();
      var dailyEnd = document.getElementById('daily-end-date');
      if (dailyEnd && dailyEnd.value) renderDailySummary();
      var weeklyEnd = document.getElementById('weekly-end-date');
      if (weeklyEnd && weeklyEnd.value) renderWeeklySummary();
    });

    var btnHourlyExcel = document.getElementById('btn-hourly-excel');
    if (btnHourlyExcel) {
      btnHourlyExcel.addEventListener('click', function () {
        var dateStr = state.referenceDate || '';
        var table = document.getElementById('hourly-table');
        if (table) downloadXlsx('hourly_report_' + dateStr + '.xlsx', [{ sheetName: 'Hourly', tableEl: table }]);
      });
    }
    var btnAllstoresExcel = document.getElementById('btn-allstores-excel');
    if (btnAllstoresExcel) {
      btnAllstoresExcel.addEventListener('click', function () {
        var dateEl = document.getElementById('allstores-date');
        var dateStr = dateEl ? dateEl.value : '';
        var table = document.getElementById('allstores-table');
        if (table) downloadXlsx('allstores_' + dateStr + '.xlsx', [{ sheetName: 'AllStores', tableEl: table }]);
      });
    }
    /* AI tab event handlers */
    var btnAiGenerate = document.getElementById('btn-ai-generate');
    if (btnAiGenerate) btnAiGenerate.addEventListener('click', doAiGenerate);
    var aiStoreEl = document.getElementById('ai-store-select');
    if (aiStoreEl) aiStoreEl.addEventListener('change', refreshAiDateSelect);

    /* Settings modal */
    var settingsLink = document.getElementById('settings-link');
    var settingsModal = document.getElementById('settings-modal');
    var settingsSaveBtn = document.getElementById('settings-save-btn');
    var settingsCancelBtn = document.getElementById('settings-cancel-btn');
    if (settingsModal) {
      if (settingsLink) {
        settingsLink.addEventListener('click', function (e) {
          e.preventDefault();
          closeMobileMenu();
          openSettingsModal(false);
        });
      }
      function closeSettingsModal() {
        settingsModal.hidden = true;
        var cancelBtn = document.getElementById('settings-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = '';
      }
      if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettingsModal);
      settingsModal.addEventListener('click', function (e) {
        if (e.target === settingsModal) closeSettingsModal();
      });
      if (settingsSaveBtn) {
        settingsSaveBtn.addEventListener('click', function () {
          var storeSel = document.getElementById('settings-store-select');
          var deptSel = document.getElementById('settings-department-select');
          var currencySel = document.getElementById('settings-currency-select');
          var languageSel = document.getElementById('settings-language-select');
          var storeId = storeSel ? storeSel.value : null;
          var department = deptSel ? deptSel.value : 'Total';
          var currency = currencySel ? currencySel.value : null;
          var language = languageSel ? languageSel.value : null;
          fetch('/api/me/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storeId: storeId, department: department, currency: currency, language: language })
          }).then(function (r) { return r.json(); }).then(function () {
            authState.preferredStore = storeId;
            authState.preferredDepartment = department;
            authState.preferredCurrency = currency;
            authState.preferredLanguage = language;
            authState.needsProfileSetup = false;
            applyUserPreferences();
            onStoreChange();
            renderAllStoresDigest();
            refreshAiDateSelect();
            closeSettingsModal();
          }).catch(function () {});
        });
      }
    }

    /* Report page: load stores then initial data */
    updateHeaderAuth().then(function () {
      return fillStoreSelect();
    }).then(function () {
      refreshDepartmentSelectLabels();
      applyUserPreferences();
      fetchBusinessHours();
      checkAiStatus();
      updateHourlyFiltersLayout();
      updateHourlyFiltersSummaryBar();
      if (authState.loggedIn && authState.needsProfileSetup) openSettingsModal(true);
      if (authState.loggedIn) checkChangelog();
      if (outputDateEl) {
        refreshOutputDateSelect();
        renderReport();
      }
    });
  }

  function checkChangelog() {
    fetch('/api/changelog')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var version = data && data.version;
        if (!version) return;
        var seenKey = 'changelog_seen_version';
        var seen = '';
        try { seen = localStorage.getItem(seenKey) || ''; } catch (e) {}
        if (seen === version) return;

        var releases = data.releases || [];
        var latest = releases[0];
        if (!latest) return;

        var lang = (window.i18n && window.i18n.getCurrentLang) ? window.i18n.getCurrentLang() : 'en';
        var locale = latest[lang] || latest['en'] || {};
        var titleEl = document.getElementById('changelog-modal-title');
        var verEl = document.getElementById('changelog-modal-version');
        var listEl = document.getElementById('changelog-modal-list');
        var modal = document.getElementById('changelog-modal');
        if (!modal || !titleEl || !listEl) return;

        titleEl.textContent = locale.title || '';
        verEl.textContent = latest.version ? 'v' + latest.version + ' — ' + (latest.date || '') : '';
        listEl.innerHTML = (locale.items || []).map(function (item) {
          return '<li>' + escapeHtml(item) + '</li>';
        }).join('');

        modal.hidden = false;

        var closeBtn = document.getElementById('changelog-modal-close');
        function closeModal() {
          modal.hidden = true;
          try { localStorage.setItem(seenKey, version); } catch (e) {}
        }
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', function (e) {
          if (e.target === modal) closeModal();
        });
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
