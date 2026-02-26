(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function (url, opts) {
      return origFetch.apply(this, arguments).then(function (res) {
        if (res.status === 401) window.location.href = '/login';
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
    storeId: 'default'
  };

  function getSelectedStoreId() {
    var el = document.getElementById('store-select');
    return el && el.value ? el.value : 'default';
  }

  var DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];
  var DEPARTMENT_COLORS = ['#9333ea', '#22c55e', '#38bdf8', '#ec4899', '#f97316', '#1f2937'];

  var chartInstances = { sales: null, receipts: null, forecastSales: null, forecastReceipts: null, composition: null, dailySales: null, dailyComposition: null, dailyMetrics: null };

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
    var canvas = document.getElementById('chart-composition');
    var tbody = document.getElementById('composition-tbody');
    if (!section || !canvas || !tbody) return;
    if (!compositionData || !compositionData.timeLabels.length || !compositionData.deptDatasets.length) {
      section.classList.add('hidden');
      if (chartInstances.composition) {
        chartInstances.composition.destroy();
        chartInstances.composition = null;
      }
      tbody.innerHTML = '';
      var tfootEl = document.getElementById('composition-tfoot');
      if (tfootEl) tfootEl.innerHTML = '';
      return;
    }
    section.classList.remove('hidden');
    var timeLabels = compositionData.timeLabels;
    var deptDatasets = compositionData.deptDatasets;

    if (chartInstances.composition) {
      chartInstances.composition.destroy();
      chartInstances.composition = null;
    }
    var chartDatasets = deptDatasets.map(function (d) {
      return {
        label: d.name,
        data: d.values,
        backgroundColor: d.color,
        borderColor: d.color,
        borderWidth: 1
      };
    });
    chartInstances.composition = new Chart(canvas, {
      type: 'bar',
      data: { labels: timeLabels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'top'
          },
          tooltip: {
            callbacks: {
              afterLabel: function (ctx) {
                var slotTotal = 0;
                var datasets = ctx.chart.data.datasets;
                for (var idx = 0; idx < datasets.length; idx++) {
                  slotTotal += (datasets[idx].data[ctx.dataIndex] || 0);
                }
                if (slotTotal <= 0) return '';
                var pct = ((ctx.raw / slotTotal) * 100).toFixed(1);
                return (t('share_pct').replace('{pct}', pct));
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: t('time_slot') }, stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: t('net_sales') } }
        }
      }
    });

    var thead = document.querySelector('#composition-table thead tr');
    var theadHtml = '<th>' + t('time_range_col') + '</th>';
    for (var idx = 0; idx < deptDatasets.length; idx++) theadHtml += '<th>' + deptDatasets[idx].name + '</th>';
    theadHtml += '<th>' + t('total') + '</th>';
    if (thead) thead.innerHTML = theadHtml;

    tbody.innerHTML = '';
    for (var i = 0; i < timeLabels.length; i++) {
      var slotTotal = 0;
      for (var j = 0; j < deptDatasets.length; j++) slotTotal += deptDatasets[j].values[i] || 0;
      var row = '<tr><td>' + timeLabels[i] + '</td>';
      for (var k = 0; k < deptDatasets.length; k++) {
        var v = deptDatasets[k].values[i] || 0;
        var pct = slotTotal > 0 ? ((v / slotTotal) * 100).toFixed(1) : '0.0';
        row += '<td>' + pct + '%</td>';
      }
      row += '<td>' + formatCurrency(slotTotal) + '</td></tr>';
      tbody.insertAdjacentHTML('beforeend', row);
    }

    var tfoot = document.getElementById('composition-tfoot');
    if (tfoot) {
      var deptTotals = [];
      var grandTotal = 0;
      for (var d = 0; d < deptDatasets.length; d++) {
        var sum = 0;
        for (var s = 0; s < deptDatasets[d].values.length; s++) sum += deptDatasets[d].values[s] || 0;
        deptTotals.push(sum);
        grandTotal += sum;
      }
      var footRow = '<tr><td>' + t('total') + '</td>';
      for (var n = 0; n < deptTotals.length; n++) {
        var pct = grandTotal > 0 ? ((deptTotals[n] / grandTotal) * 100).toFixed(1) : '0.0';
        footRow += '<td>' + pct + '%</td>';
      }
      footRow += '<td>' + formatCurrency(grandTotal) + '</td></tr>';
      tfoot.innerHTML = footRow;
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

  function getLastActualIndex(values) {
    for (var i = values.length - 1; i >= 0; i--) {
      if (values[i] != null && Number(values[i]) > 0) return i;
    }
    return values.length - 1;
  }

  function lerp(i, i0, v0, i1, v1) {
    if (i1 === i0) return v0;
    return v0 + (v1 - v0) * (i - i0) / (i1 - i0);
  }

  function computeForecastFromPast(actualCumAtLast, lastActualIndex, totalSlots, yesterdayTotal, lastWeekTotal) {
    var pastAvg = null;
    if (yesterdayTotal != null && lastWeekTotal != null) pastAvg = (yesterdayTotal + lastWeekTotal) / 2;
    else if (yesterdayTotal != null) pastAvg = yesterdayTotal;
    else if (lastWeekTotal != null) pastAvg = lastWeekTotal;
    var todayRate = (lastActualIndex >= 0 && actualCumAtLast > 0) ? actualCumAtLast / (lastActualIndex + 1) : 0;
    var todayProjection = todayRate * totalSlots;
    var result;
    if (pastAvg != null && todayProjection > 0) result = 0.5 * todayProjection + 0.5 * pastAvg;
    else if (pastAvg != null) result = pastAvg;
    else result = todayProjection || actualCumAtLast;
    return Math.max(result, actualCumAtLast || 0);
  }

  function buildForecastChartData(todayValues, yesterdayValues, lastWeekValues) {
    var n = todayValues.length;
    if (n === 0) return { actualCum: [], forecastLine: [], forecastLower: [], forecastUpper: [], lastActual: 0 };
    var cum = computeCumulative(todayValues);
    var lastActual = getLastActualIndex(todayValues);
    var yesterdayTotal = yesterdayValues.reduce(function (s, v) { return s + (v != null ? Number(v) : 0); }, 0);
    var lastWeekTotal = lastWeekValues.reduce(function (s, v) { return s + (v != null ? Number(v) : 0); }, 0);
    var forecastTotal = computeForecastFromPast(cum[lastActual], lastActual, n, yesterdayTotal, lastWeekTotal);
    forecastTotal = Math.max(forecastTotal, cum[lastActual]);
    var margin = 0.15;
    if (yesterdayTotal > 0 && lastWeekTotal > 0) {
      var lo = Math.min(yesterdayTotal, lastWeekTotal);
      var hi = Math.max(yesterdayTotal, lastWeekTotal);
      margin = Math.max(0.1, (hi - lo) / (forecastTotal || 1));
    }
    margin = Math.min(0.25, margin);
    var forecastLow = Math.max(forecastTotal * (1 - margin), cum[lastActual]);
    var forecastHigh = Math.max(forecastTotal * (1 + margin), forecastLow);
    var actualCum = [];
    var forecastLine = [];
    var forecastLower = [];
    var forecastUpper = [];
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

  function renderCharts(todayHourly, yesterdayHourly, lastWeekHourly) {
    if (typeof Chart === 'undefined' || !todayHourly || !todayHourly.length) return;
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
    if (!salesCanvas || !receiptsCanvas || !forecastSalesCanvas || !forecastReceiptsCanvas) return;

    var hasYesterday = yesterdayHourly && yesterdayHourly.length > 0;
    var hasLastWeek = lastWeekHourly && lastWeekHourly.length > 0;

    var salesDatasets = [
      { label: t('today'), data: todayNet, backgroundColor: 'rgba(37, 99, 235, 0.8)', borderColor: 'rgb(37, 99, 235)', borderWidth: 1 }
    ];
    if (hasYesterday) {
      salesDatasets.push({ label: t('yesterday'), data: yesterdayNet, backgroundColor: 'rgba(107, 114, 128, 0.6)', borderColor: 'rgb(107, 114, 128)', borderWidth: 1 });
    }
    if (hasLastWeek) {
      salesDatasets.push({ label: t('last_week'), data: lastWeekNet, backgroundColor: 'rgba(156, 163, 175, 0.5)', borderColor: 'rgb(156, 163, 175)', borderWidth: 1 });
    }

    chartInstances.sales = new Chart(salesCanvas, {
      type: 'bar',
      data: { labels: labels, datasets: salesDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { title: { display: true, text: 'Time Slot' } },
          y: { beginAtZero: true, title: { display: true, text: t('net_sales') } }
        }
      }
    });

    var receiptDatasets = [
      { label: t('today'), data: todayReceipts, backgroundColor: 'rgba(34, 197, 94, 0.8)', borderColor: 'rgb(34, 197, 94)', borderWidth: 1 }
    ];
    if (hasYesterday) {
      receiptDatasets.push({ label: t('yesterday'), data: yesterdayReceipts, backgroundColor: 'rgba(107, 114, 128, 0.6)', borderColor: 'rgb(107, 114, 128)', borderWidth: 1 });
    }
    if (hasLastWeek) {
      receiptDatasets.push({ label: t('last_week'), data: lastWeekReceipts, backgroundColor: 'rgba(156, 163, 175, 0.5)', borderColor: 'rgb(156, 163, 175)', borderWidth: 1 });
    }

    chartInstances.receipts = new Chart(receiptsCanvas, {
      type: 'bar',
      data: { labels: labels, datasets: receiptDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { title: { display: true, text: t('time_slot') } },
          y: { beginAtZero: true, title: { display: true, text: t('receipt_count') } }
        }
      }
    });

    var forecastSalesData = buildForecastChartData(todayNet, yesterdayNet, lastWeekNet);
    var forecastReceiptsData = buildForecastChartData(todayReceipts, yesterdayReceipts, lastWeekReceipts);

    chartInstances.forecastSales = new Chart(forecastSalesCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: t('forecast_band'),
            data: forecastSalesData.forecastLower,
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
            borderColor: 'rgb(234, 88, 12)',
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
            borderColor: 'rgb(37, 99, 235)',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
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
            labels: { filter: function (item, ch) { return item.datasetIndex !== 1; } }
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
          x: { title: { display: true, text: t('time_slot') } },
          y: { beginAtZero: true, title: { display: true, text: t('chart_forecast_net') } }
        }
      }
    });

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
            borderColor: 'rgb(234, 88, 12)',
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
            borderColor: 'rgb(37, 99, 235)',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
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
            labels: { filter: function (item, ch) { return item.datasetIndex !== 1; } }
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
          x: { title: { display: true, text: t('time_slot') } },
          y: { beginAtZero: true, title: { display: true, text: t('forecast_total_count') } }
        }
      }
    });
  }

  function getHourlyData(data, department) {
    if (!data) return null;
    if (department === 'Total') return data.total.hourly;
    if (data.byDepartment && data.byDepartment[department]) return data.byDepartment[department].hourly;
    return null;
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
  }

  function hideLoading() {
    var el = document.getElementById('loading-overlay');
    if (el) { el.hidden = true; el.setAttribute('aria-busy', 'false'); }
  }

  function tableToCsv(tableEl) {
    if (!tableEl || !tableEl.rows || !tableEl.rows.length) return '';
    var rows = [];
    for (var i = 0; i < tableEl.rows.length; i++) {
      var row = tableEl.rows[i];
      var cells = [];
      for (var j = 0; j < row.cells.length; j++) {
        var text = (row.cells[j].textContent || '').trim().replace(/"/g, '""');
        if (/[",\n\r]/.test(text)) text = '"' + text + '"';
        cells.push(text);
      }
      rows.push(cells.join(','));
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  function downloadCsv(filename, csvString) {
    if (!csvString) return;
    var blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportPanelTablesCsv(containerId, baseName, selectedOption) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var tables = container.querySelectorAll('table.report-table');
    if (tables.length === 0) return;
    var index = selectedOption !== undefined && selectedOption !== 'all' ? parseInt(selectedOption, 10) : -1;
    if (index >= 0 && index < tables.length) {
      downloadCsv(baseName + '_' + (index + 1) + '.csv', tableToCsv(tables[index]));
      return;
    }
    if (tables.length === 1) {
      downloadCsv(baseName + '.csv', tableToCsv(tables[0]));
      return;
    }
    tables.forEach(function (t, i) {
      var name = baseName + '_' + (i + 1) + '.csv';
      downloadCsv(name, tableToCsv(t));
    });
  }

  function fetchBusinessHours() {
    var storeId = getSelectedStoreId();
    fetch('/api/business-hours?storeId=' + encodeURIComponent(storeId)).then(function (res) { return parseJsonResponse(res); }).then(function (settings) {
      if (settings && typeof settings === 'object') {
        state.businessHoursSettings = settings;
        var startEl = document.getElementById('time-start');
        var endEl = document.getElementById('time-end');
        if (startEl && endEl && state.referenceDate) fillTimeSelects(state.referenceDate);
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

  function discountRate(gross, net) {
    if (gross == null || gross === 0) return null;
    if (net == null) return null;
    return ((gross - net) / gross) * 100;
  }

  function formatCurrency(n) {
    if (n == null) return '';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatInt(n) {
    if (n == null) return '';
    return Math.round(Number(n)).toLocaleString('en-US');
  }

  function formatPct(n) {
    if (n == null) return '';
    return Math.round(Number(n)) + '%';
  }

  function formatPct1(n) {
    if (n == null) return '';
    return Number(n).toFixed(1) + '%';
  }

  function renderHourlyRow(hour, yesterdayHour, lastWeekHour, isTotal) {
    var gross = hour.grossSales != null ? hour.grossSales : hour.netSales;
    var net = hour.netSales;
    var dod = yesterdayHour ? pctRatio(net, yesterdayHour.netSales) : null;
    var wow = lastWeekHour ? pctRatio(net, lastWeekHour.netSales) : null;
    var disc = isTotal && gross != null && gross > 0 ? discountRate(gross, net) : null;

    return '<tr>' +
      '<td>' + (hour.timeLabel || '') + '</td>' +
      '<td>' + (isTotal && hour.grossSales != null ? formatCurrency(hour.grossSales) : (hour.grossSales != null ? formatCurrency(hour.grossSales) : '—')) + '</td>' +
      '<td>' + formatCurrency(net) + '</td>' +
      '<td>' + formatPct(dod) + '</td>' +
      '<td>' + formatPct(wow) + '</td>' +
      '<td>' + (disc != null ? formatPct1(disc) : '—') + '</td>' +
      '<td>' + formatInt(hour.quantitySold) + '</td>' +
      '<td>' + formatInt(hour.receiptCount) + '</td>' +
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
    var grossSum = 0, netSum = 0, receiptSum = 0, qtySum = 0;
    var grossSumY = 0, netSumY = 0, receiptSumY = 0, qtySumY = 0;
    var grossSumW = 0, netSumW = 0, receiptSumW = 0, qtySumW = 0;

    todayHourly.forEach(function (h) {
      if (h.grossSales != null) grossSum += h.grossSales;
      netSum += h.netSales || 0;
      receiptSum += h.receiptCount || 0;
      qtySum += h.quantitySold || 0;
    });
    if (yesterdayHourly) {
      yesterdayHourly.forEach(function (h) {
        if (h.grossSales != null) grossSumY += h.grossSales;
        netSumY += h.netSales || 0;
        receiptSumY += h.receiptCount || 0;
        qtySumY += h.quantitySold || 0;
      });
    }
    if (lastWeekHourly) {
      lastWeekHourly.forEach(function (h) {
        if (h.grossSales != null) grossSumW += h.grossSales;
        netSumW += h.netSales || 0;
        receiptSumW += h.receiptCount || 0;
        qtySumW += h.quantitySold || 0;
      });
    }

    var dod = netSumY > 0 ? Math.round((netSum / netSumY) * 100) : null;
    var wow = netSumW > 0 ? Math.round((netSum / netSumW) * 100) : null;
    var disc = isTotal && grossSum > 0 ? ((grossSum - netSum) / grossSum) * 100 : null;

    return '<tr>' +
      '<td>' + t('total') + '</td>' +
      '<td>' + (isTotal ? formatCurrency(grossSum) : '—') + '</td>' +
      '<td>' + formatCurrency(netSum) + '</td>' +
      '<td>' + formatPct(dod) + '</td>' +
      '<td>' + formatPct(wow) + '</td>' +
      '<td>' + (disc != null ? formatPct1(disc) : '—') + '</td>' +
      '<td>' + formatInt(qtySum) + '</td>' +
      '<td>' + formatInt(receiptSum) + '</td>' +
    '</tr>';
  }

  function computeSummary(hourly) {
    if (!hourly || !hourly.length) return null;
    var netSum = 0, receiptSum = 0, qtySum = 0;
    var hoursWithSales = 0;
    hourly.forEach(function (h) {
      var n = h.netSales || 0;
      netSum += n;
      receiptSum += h.receiptCount || 0;
      qtySum += h.quantitySold || 0;
      if (n > 0) hoursWithSales++;
    });
    if (hoursWithSales === 0) hoursWithSales = 1;
    return {
      salesPerHour: netSum / hoursWithSales,
      txnPerHour: receiptSum / hoursWithSales,
      unitPerTxn: receiptSum > 0 ? qtySum / receiptSum : 0,
      avgTxnPrice: receiptSum > 0 ? netSum / receiptSum : 0,
      avgSellingPrice: qtySum > 0 ? netSum / qtySum : 0
    };
  }

  function renderReport() {
    var dept = document.getElementById('department-select').value;
    var startTime = (document.getElementById('time-start') && document.getElementById('time-start').value) || '00:00';
    var endTime = (document.getElementById('time-end') && document.getElementById('time-end').value) || '24:00';

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
    var summarySection = document.querySelector('.summary-section');
    var chartSection = document.getElementById('chart-section');
    var compositionSection = document.getElementById('composition-section');

    if (!todayHourly || !todayHourly.length) {
      reportTitle.textContent = dept;
      tbody.innerHTML = '';
      tfoot.innerHTML = '';
      emptyMsg.hidden = false;
      var dateEl = document.getElementById('output-date');
      var hasDate = dateEl && dateEl.value && dateEl.value.trim() !== '';
      emptyMsg.textContent = hasDate ? t('no_data_selected_date') : t('no_data_for_store');
      tableWrapper.style.display = 'none';
      summarySection.style.display = 'none';
      if (chartSection) chartSection.classList.add('hidden');
      if (compositionSection) compositionSection.classList.add('hidden');
      destroyCharts();
      renderComposition(null);
      return;
    }

    emptyMsg.hidden = true;
    tableWrapper.style.display = '';
    summarySection.style.display = '';
    if (chartSection) chartSection.classList.remove('hidden');

    reportTitle.textContent = dept;

    var isTotal = (dept === 'Total');
    var html = '';
    todayHourly.forEach(function (hour) {
      var yHour = findHour(yesterdayHourly, hour.timeKey);
      var wHour = findHour(lastWeekHourly, hour.timeKey);
      html += renderHourlyRow(hour, yHour, wHour, isTotal);
    });
    tbody.innerHTML = html;

    tfoot.innerHTML = renderTotalsRow(todayHourly, yesterdayHourly, lastWeekHourly, isTotal);

    renderCharts(todayHourly, yesterdayHourly, lastWeekHourly);

    var compositionData = getDepartmentCompositionByTime(state.today, startTime, endTime);
    renderComposition(compositionData);

    var sumToday = computeSummary(todayHourly);
    var sumYesterday = yesterdayHourly ? computeSummary(yesterdayHourly) : null;
    var sumLastWeek = lastWeekHourly ? computeSummary(lastWeekHourly) : null;

    function setSummary(id, val, dodId, wowId) {
      var el = document.getElementById(id);
      var dodEl = document.getElementById(dodId);
      var wowEl = document.getElementById(wowId);
      if (!el) return;
      el.textContent = val != null ? formatInt(Math.round(val)) : '';
      if (dodEl) dodEl.textContent = sumYesterday && val != null && sumYesterday[el.id.replace('sum-', '').replace(/-/g, '')] != null
        ? formatPct(pctRatio(val, sumYesterday.salesPerHour || sumYesterday.txnPerHour || sumYesterday.unitPerTxn || sumYesterday.avgTxnPrice || sumYesterday.avgSellingPrice))
        : (function(){
            var key = id.replace('sum-', '').replace(/-/g, '');
            var keyMap = { salesperhour: 'salesPerHour', txnperhour: 'txnPerHour', unitpertxn: 'unitPerTxn', avgtxnprice: 'avgTxnPrice', avgsellingprice: 'avgSellingPrice' };
            var yVal = sumYesterday && keyMap[key] ? sumYesterday[keyMap[key]] : null;
            return formatPct(pctRatio(val, yVal));
          })();
      if (wowEl) wowEl.textContent = sumLastWeek ? formatPct(pctRatio(val, (sumLastWeek.salesPerHour !== undefined && id.indexOf('sales-per-hour') !== -1) ? sumLastWeek.salesPerHour : (sumLastWeek.txnPerHour !== undefined && id.indexOf('txn-per-hour') !== -1) ? sumLastWeek.txnPerHour : (sumLastWeek.unitPerTxn !== undefined && id.indexOf('unit-per-txn') !== -1) ? sumLastWeek.unitPerTxn : (sumLastWeek.avgTxnPrice !== undefined && id.indexOf('avg-txn-price') !== -1) ? sumLastWeek.avgTxnPrice : sumLastWeek.avgSellingPrice)) : '';
    }

    if (sumToday) {
      document.getElementById('sum-sales-per-hour').textContent = formatInt(Math.round(sumToday.salesPerHour));
      document.getElementById('sum-sales-per-hour-dod').textContent = sumYesterday ? formatPct(pctRatio(sumToday.salesPerHour, sumYesterday.salesPerHour)) : '';
      document.getElementById('sum-sales-per-hour-wow').textContent = sumLastWeek ? formatPct(pctRatio(sumToday.salesPerHour, sumLastWeek.salesPerHour)) : '';

      document.getElementById('sum-txn-per-hour').textContent = formatInt(Math.round(sumToday.txnPerHour));
      document.getElementById('sum-txn-per-hour-dod').textContent = sumYesterday ? formatPct(pctRatio(sumToday.txnPerHour, sumYesterday.txnPerHour)) : '';
      document.getElementById('sum-txn-per-hour-wow').textContent = sumLastWeek ? formatPct(pctRatio(sumToday.txnPerHour, sumLastWeek.txnPerHour)) : '';

      document.getElementById('sum-unit-per-txn').textContent = sumToday.unitPerTxn ? sumToday.unitPerTxn.toFixed(1) : '';
      document.getElementById('sum-unit-per-txn-dod').textContent = sumYesterday ? formatPct(pctRatio(sumToday.unitPerTxn, sumYesterday.unitPerTxn)) : '';
      document.getElementById('sum-unit-per-txn-wow').textContent = sumLastWeek ? formatPct(pctRatio(sumToday.unitPerTxn, sumLastWeek.unitPerTxn)) : '';

      document.getElementById('sum-avg-txn-price').textContent = formatInt(Math.round(sumToday.avgTxnPrice));
      document.getElementById('sum-avg-txn-price-dod').textContent = sumYesterday ? formatPct(pctRatio(sumToday.avgTxnPrice, sumYesterday.avgTxnPrice)) : '';
      document.getElementById('sum-avg-txn-price-wow').textContent = sumLastWeek ? formatPct(pctRatio(sumToday.avgTxnPrice, sumLastWeek.avgTxnPrice)) : '';

      document.getElementById('sum-avg-selling-price').textContent = formatInt(Math.round(sumToday.avgSellingPrice));
      document.getElementById('sum-avg-selling-price-dod').textContent = sumYesterday ? formatPct(pctRatio(sumToday.avgSellingPrice, sumYesterday.avgSellingPrice)) : '';
      document.getElementById('sum-avg-selling-price-wow').textContent = sumLastWeek ? formatPct(pctRatio(sumToday.avgSellingPrice, sumLastWeek.avgSellingPrice)) : '';
    }
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
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
      var chosen = el.value;
      if (chosen) {
        fetch('/api/report?referenceDate=' + encodeURIComponent(chosen) + '&storeId=' + encodeURIComponent(storeId)).then(function (r) {
          return parseJsonResponse(r).then(function (data) {
            if (!r.ok) return;
            state.today = data.today;
            state.yesterday = data.yesterday || null;
            state.lastWeek = data.lastWeek || null;
            state.referenceDate = data.referenceDate;
            fillTimeSelects(state.referenceDate);
            renderReport();
          });
        }).then(function () { hideLoading(); }).catch(function () { hideLoading(); });
      } else {
        renderReport();
        hideLoading();
      }
    }).catch(function () { renderReport(); hideLoading(); });
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
    if (tabName === 'daily') {
      refreshDailyDateSelect();
      renderDailySummary();
    }
    if (tabName === 'weekly') {
      refreshWeeklyDateSelect();
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
    var storeId = getSelectedStoreId();
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
    var storeId = getSelectedStoreId();
    var url = '/api/daily-summary?referenceDate=' + encodeURIComponent(endDate) + '&storeId=' + encodeURIComponent(storeId);
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

      var table1 = '<section class="summary-section"><h3>' + t('daily_sales_by_dept') + '</h3><table class="report-table daily-table"><thead><tr><th>' + t('department') + '</th>';
      dateLabels.forEach(function (l) { table1 += '<th>' + l + '</th>'; });
      table1 += '<th>' + t('total_header') + '</th></tr></thead><tbody>';
      deptOrder.forEach(function (dept) {
        var rowTotal = 0;
        table1 += '<tr><td>' + dept + '</td>';
        days.forEach(function (d) {
          var v = (d.byDepartment && d.byDepartment[dept]) ? d.byDepartment[dept] : 0;
          rowTotal += v;
          table1 += '<td>' + formatInt(v) + '</td>';
        });
        table1 += '<td>' + formatInt(rowTotal) + '</td></tr>';
      });
      table1 += '<tr class="total-row"><td>' + t('total_header') + '</td>';
      totalRow.forEach(function (v) { table1 += '<td>' + formatInt(v) + '</td>'; });
      table1 += '</tr></tbody></table></section>';

      var table1b = '<section class="summary-section"><h3>' + t('daily_composition_pct') + '</h3><table class="report-table daily-table"><thead><tr><th>' + t('department') + '</th>';
      dateLabels.forEach(function (l) { table1b += '<th>' + l + '</th>'; });
      table1b += '<th>' + t('total_header') + '</th></tr></thead><tbody>';
      deptOrder.forEach(function (dept) {
        table1b += '<tr><td>' + dept + '</td>';
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
      table1b += '<td>100%</td></tr></tbody></table></section>';

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
      weeklyTotalHtml += '<tr><td>' + t('total_net_sales') + '</td><td>' + formatInt(grandTotalSales) + ' ' + t('currency_unit') + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('total_receipts') + '</td><td>' + formatInt(totalReceipts) + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('total_qty_sold') + '</td><td>' + formatInt(totalQty) + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('total_hours') + '</td><td>' + formatInt(totalHours) + ' h</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('sales_per_hour_label') + '</td><td>' + formatInt(totalHours ? Math.round(grandTotalSales / totalHours) : 0) + ' ' + t('currency_unit') + '</td></tr>';
      weeklyTotalHtml += '<tr><td>' + t('avg_receipt_value') + '</td><td>' + (totalReceipts ? formatInt(Math.round(grandTotalSales / totalReceipts)) : '—') + ' ' + t('currency_unit') + '</td></tr>';
      weeklyTotalHtml += '</tbody></table></section>';

      var table2 = '<section class="summary-section"><h3>' + t('key_metrics') + '</h3><table class="report-table daily-table"><thead><tr><th>' + t('metric') + '</th>';
      dateLabels.forEach(function (l) { table2 += '<th>' + l + '</th>'; });
      table2 += '<th>' + t('total_header') + '</th></tr></thead><tbody>';
      table2 += '<tr><td>' + t('sales_per_hour') + ' (' + t('currency_unit') + ')</td>';
      salesPerHour.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalHours ? Math.round(grandTotalSales / totalHours) : 0) + '</td></tr>';
      table2 += '<tr><td>' + t('receipts_per_hour') + '</td>';
      receiptsPerHour.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalHours ? Math.round(totalReceipts / totalHours) : 0) + '</td></tr>';
      table2 += '<tr><td>' + t('receipt_count') + '</td>';
      receiptCounts.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalReceipts) + '</td></tr>';
      table2 += '<tr><td>' + t('avg_receipt_value') + ' (' + t('currency_unit') + ')</td>';
      avgReceipt.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + (totalReceipts ? formatInt(Math.round(grandTotalSales / totalReceipts)) : '—') + '</td></tr>';
      table2 += '<tr><td>' + t('items_per_receipt') + '</td>';
      itemsPerReceipt.forEach(function (v) { table2 += '<td>' + v + '</td>'; });
      table2 += '<td>' + (totalReceipts ? (totalQty / totalReceipts).toFixed(1) : '—') + '</td></tr>';
      table2 += '<tr><td>' + t('quantity_sold') + '</td>';
      qtySold.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalQty) + '</td></tr>';
      table2 += '<tr><td>' + t('avg_item_price') + ' (' + t('currency_unit') + ')</td>';
      avgItemPrice.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + (totalQty ? formatInt(Math.round(grandTotalSales / totalQty)) : '—') + '</td></tr>';
      table2 += '</tbody></table></section>';

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
    if (arr.length) {
      el.min = arr[0];
      el.max = arr[arr.length - 1];
    } else {
      el.removeAttribute('min');
      el.removeAttribute('max');
    }
    var val = (selectedValue && dates && dates.indexOf(selectedValue) !== -1) ? selectedValue : (dates && dates.length ? dates[0] : '');
    el.value = val || '';
  }

  function refreshWeeklyDateSelect() {
    showLoading();
    var storeId = getSelectedStoreId();
    fetch('/api/dates?storeId=' + encodeURIComponent(storeId)).then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var dates = body.dates || [];
      var el = document.getElementById('weekly-end-date');
      fillWeeklyEndDateSelect(dates, el ? el.value : null);
      if (el && el.value) {
        renderWeeklySummary();
      } else {
        hideLoading();
      }
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
    var storeId = getSelectedStoreId();
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
        var startD = chunk[0].date;
        var endD = chunk[chunk.length - 1].date;
        weeks.push({
          label: startD + ' ～ ' + endD,
          shortLabel: startD.slice(5) + '～' + endD.slice(5),
          totalNetSales: totalNetSales,
          receiptCount: receiptCount,
          quantitySold: quantitySold,
          byDepartment: byDepartment
        });
      }
      if (weeks.length === 0) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      var sumNetSales = 0, sumReceipts = 0, sumQty = 0;
      weeks.forEach(function (w) {
        sumNetSales += w.totalNetSales || 0;
        sumReceipts += w.receiptCount || 0;
        sumQty += w.quantitySold || 0;
      });
      var table1 = '<section class="summary-section"><h3>' + t('weekly_net_title') + '</h3><table class="report-table daily-table"><thead><tr><th>' + t('week') + '</th><th>' + t('net_sales_thb') + '</th><th>' + t('wow') + '</th><th>' + t('receipt_count') + '</th><th>' + t('qty_sold_short') + '</th></tr></thead><tbody>';
      weeks.forEach(function (w, i) {
        var prev = weeks[i - 1];
        var wow = prev && prev.totalNetSales ? Math.round((w.totalNetSales / prev.totalNetSales) * 100) : '—';
        table1 += '<tr><td>' + w.label + '</td><td>' + formatInt(w.totalNetSales) + '</td><td>' + (wow === '—' ? wow : wow + '%') + '</td><td>' + formatInt(w.receiptCount) + '</td><td>' + formatInt(w.quantitySold) + '</td></tr>';
      });
      table1 += '<tr class="total-row"><td>' + t('total') + '</td><td>' + formatInt(sumNetSales) + '</td><td>—</td><td>' + formatInt(sumReceipts) + '</td><td>' + formatInt(sumQty) + '</td></tr></tbody></table></section>';

      var deptTotals = {};
      DEPARTMENTS.forEach(function (d) { deptTotals[d] = 0; });
      weeks.forEach(function (w) {
        DEPARTMENTS.forEach(function (dept) {
          deptTotals[dept] += w.byDepartment[dept] || 0;
        });
      });
      var grandTotalAll = 0;
      DEPARTMENTS.forEach(function (d) { grandTotalAll += deptTotals[d] || 0; });
      var table2 = '<section class="summary-section"><h3>' + t('sales_by_dept') + '</h3><table class="report-table daily-table"><thead><tr><th>' + t('week') + '</th>';
      DEPARTMENTS.forEach(function (d) { table2 += '<th>' + d + '</th>'; });
      table2 += '<th>' + t('total') + '</th></tr></thead><tbody>';
      weeks.forEach(function (w) {
        table2 += '<tr><td>' + w.shortLabel + '</td>';
        var rowTotal = 0;
        DEPARTMENTS.forEach(function (dept) {
          var v = w.byDepartment[dept] || 0;
          rowTotal += v;
          table2 += '<td>' + formatInt(v) + '</td>';
        });
        table2 += '<td>' + formatInt(rowTotal) + '</td></tr>';
      });
      table2 += '<tr class="total-row"><td>' + t('total') + '</td>';
      DEPARTMENTS.forEach(function (d) { table2 += '<td>' + formatInt(deptTotals[d]) + '</td>'; });
      table2 += '<td>' + formatInt(grandTotalAll) + '</td></tr></tbody></table></section>';

      var table3 = '<section class="summary-section"><h3>' + t('dept_composition_pct') + '</h3><table class="report-table daily-table"><thead><tr><th>' + t('week') + '</th>';
      DEPARTMENTS.forEach(function (d) { table3 += '<th>' + d + '</th>'; });
      table3 += '<th>' + t('total') + '</th></tr></thead><tbody>';
      weeks.forEach(function (w) {
        var weekTotal = w.totalNetSales || 1;
        table3 += '<tr><td>' + w.shortLabel + '</td>';
        DEPARTMENTS.forEach(function (dept) {
          var v = w.byDepartment[dept] || 0;
          var pct = weekTotal ? ((v / weekTotal) * 100).toFixed(1) : '—';
          table3 += '<td>' + pct + '%</td>';
        });
        table3 += '<td>100%</td></tr>';
      });
      table3 += '<tr class="total-row"><td>' + t('total') + '</td>';
      DEPARTMENTS.forEach(function (d) {
        var pct = grandTotalAll ? ((deptTotals[d] || 0) / grandTotalAll * 100).toFixed(1) : '—';
        table3 += '<td>' + pct + '%</td>';
      });
      table3 += '<td>100%</td></tr></tbody></table></section>';

      container.innerHTML = table1 + table2 + table3;
    }).then(function () { hideLoading(); }).catch(function () {
      container.innerHTML = '';
      if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = t('weekly_load_failed'); }
      hideLoading();
    });
  }

  function fillStoreSelect() {
    var sel = document.getElementById('store-select');
    if (!sel) return Promise.resolve();
    return fetch('/api/stores').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var stores = body.stores || [];
      if (stores.length === 0) stores = [{ id: 'default', name: 'Default' }];
      sel.innerHTML = '';
      stores.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name || s.id;
        sel.appendChild(opt);
      });
      state.storeId = getSelectedStoreId();
    }).catch(function () {
      sel.innerHTML = '<option value="default">Default</option>';
      state.storeId = 'default';
    });
  }

  function onStoreChange() {
    state.storeId = getSelectedStoreId();
    fetchBusinessHours();
    refreshOutputDateSelect();
    refreshDailyDateSelect();
    refreshWeeklyDateSelect();
  }

  function init() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    var storeSelectEl = document.getElementById('store-select');
    if (storeSelectEl) storeSelectEl.addEventListener('change', onStoreChange);

    var departmentSelect = document.getElementById('department-select');
    if (departmentSelect) departmentSelect.addEventListener('change', renderReport);
    fillTimeSelects(state.referenceDate);

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
        fillTimeSelects(state.referenceDate);
        renderReport();
      }).then(function () { hideLoading(); }).catch(function () { hideLoading(); });
    });

    var dailyStartEl = document.getElementById('daily-start-date');
    var dailyEndEl = document.getElementById('daily-end-date');
    if (dailyStartEl) dailyStartEl.addEventListener('change', renderDailySummary);
    if (dailyEndEl) dailyEndEl.addEventListener('change', renderDailySummary);

    var weeklyEndEl = document.getElementById('weekly-end-date');
    var weeklyNumEl = document.getElementById('weekly-num-weeks');
    if (weeklyEndEl) weeklyEndEl.addEventListener('change', renderWeeklySummary);
    if (weeklyNumEl) weeklyNumEl.addEventListener('change', renderWeeklySummary);

    var timeStart = document.getElementById('time-start');
    var timeEnd = document.getElementById('time-end');
    if (timeStart) timeStart.addEventListener('change', renderReport);
    if (timeEnd) timeEnd.addEventListener('change', renderReport);

    window.addEventListener('languageChange', function () {
      fillTimeSelects(state.referenceDate);
      renderReport();
      var dailyEnd = document.getElementById('daily-end-date');
      if (dailyEnd && dailyEnd.value) renderDailySummary();
      var weeklyEnd = document.getElementById('weekly-end-date');
      if (weeklyEnd && weeklyEnd.value) renderWeeklySummary();
    });

    var btnHourlyCsv = document.getElementById('btn-hourly-csv');
    if (btnHourlyCsv) {
      btnHourlyCsv.addEventListener('click', function () {
        var sel = document.getElementById('hourly-export-select');
        var opt = sel ? sel.value : 'hourly';
        var dateStr = state.referenceDate || '';
        if (opt === 'summary') {
          var summaryTable = document.getElementById('summary-table');
          if (summaryTable) downloadCsv('hourly_summary_' + dateStr + '.csv', tableToCsv(summaryTable));
        } else if (opt === 'all') {
          var hourlyTable = document.getElementById('hourly-table');
          if (hourlyTable) downloadCsv('hourly_report_' + dateStr + '.csv', tableToCsv(hourlyTable));
          var summaryTable = document.getElementById('summary-table');
          if (summaryTable) downloadCsv('hourly_summary_' + dateStr + '.csv', tableToCsv(summaryTable));
        } else {
          var table = document.getElementById('hourly-table');
          if (table) downloadCsv('hourly_report_' + dateStr + '.csv', tableToCsv(table));
        }
      });
    }
    var btnDailyCsv = document.getElementById('btn-daily-csv');
    if (btnDailyCsv) {
      btnDailyCsv.addEventListener('click', function () {
        var sel = document.getElementById('daily-export-select');
        var opt = sel ? sel.value : 'all';
        exportPanelTablesCsv('daily-summary-tables', 'daily_summary', opt);
      });
    }
    var btnWeeklyCsv = document.getElementById('btn-weekly-csv');
    if (btnWeeklyCsv) {
      btnWeeklyCsv.addEventListener('click', function () {
        var sel = document.getElementById('weekly-export-select');
        var opt = sel ? sel.value : 'all';
        exportPanelTablesCsv('weekly-summary-tables', 'weekly_summary', opt);
      });
    }

    /* Report page: load stores then initial data */
    fillStoreSelect().then(function () {
      fetchBusinessHours();
      if (outputDateEl) {
        refreshOutputDateSelect();
        renderReport();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
