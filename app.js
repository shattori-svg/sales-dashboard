(function () {
  'use strict';

  var state = {
    today: null,
    yesterday: null,
    lastWeek: null,
    referenceDate: null,
    businessHoursSettings: null
  };

  var DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];

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
    var colors = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0d9488'];
    for (var d = 0; d < DEPARTMENTS.length; d++) {
      var dept = DEPARTMENTS[d];
      var hourly = todayData.byDepartment[dept] && todayData.byDepartment[dept].hourly;
      if (!hourly) continue;
      var hourlyInHours = filterByBusinessHours(hourly, todayData.businessDate);
      var values = [];
      for (var i = 0; i < timeSlots.length; i++) {
        var h = findHour(hourlyInHours, timeSlots[i].timeKey);
        values.push(h ? (h.netSales || 0) : 0);
      }
      deptDatasets.push({ name: dept, values: values, color: colors[d % colors.length] });
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
          legend: { position: 'top' },
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
                return 'Share: ' + pct + '%';
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: 'Time Slot' }, stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Net Sales (THB)' } }
        }
      }
    });

    var thead = document.querySelector('#composition-table thead tr');
    var theadHtml = '<th>Time range</th>';
    for (var t = 0; t < deptDatasets.length; t++) theadHtml += '<th>' + deptDatasets[t].name + '</th>';
    theadHtml += '<th>Total</th>';
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
      var footRow = '<tr><td>Total</td>';
      for (var n = 0; n < deptTotals.length; n++) {
        var pct = grandTotal > 0 ? ((deptTotals[n] / grandTotal) * 100).toFixed(1) : '0.0';
        footRow += '<td>' + pct + '%</td>';
      }
      footRow += '<td>' + formatCurrency(grandTotal) + '</td></tr>';
      tfoot.innerHTML = footRow;
    }
  }

  function computeForecast(values) {
    var n = values.length;
    var out = [];
    var cum = 0;
    for (var i = 0; i < n; i++) {
      cum += values[i] || 0;
      out.push(i === 0 ? (values[0] || 0) * n : cum * n / (i + 1));
    }
    return out;
  }

  function renderCharts(todayHourly, yesterdayHourly, lastWeekHourly) {
    if (typeof Chart === 'undefined' || !todayHourly || !todayHourly.length) return;
    destroyCharts();
    var labels = todayHourly.map(function (h) { return h.timeLabel || h.timeKey || ''; });
    var todayNet = todayHourly.map(function (h) { return h.netSales || 0; });
    var todayReceipts = todayHourly.map(function (h) { return h.receiptCount || 0; });
    var forecastNet = computeForecast(todayNet);
    var forecastReceipts = computeForecast(todayReceipts);
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
      { label: 'Today', data: todayNet, backgroundColor: 'rgba(37, 99, 235, 0.8)', borderColor: 'rgb(37, 99, 235)', borderWidth: 1 }
    ];
    if (hasYesterday) {
      salesDatasets.push({ label: 'Yesterday', data: yesterdayNet, backgroundColor: 'rgba(107, 114, 128, 0.6)', borderColor: 'rgb(107, 114, 128)', borderWidth: 1 });
    }
    if (hasLastWeek) {
      salesDatasets.push({ label: 'Last Week', data: lastWeekNet, backgroundColor: 'rgba(156, 163, 175, 0.5)', borderColor: 'rgb(156, 163, 175)', borderWidth: 1 });
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
          y: { beginAtZero: true, title: { display: true, text: 'Net Sales (THB)' } }
        }
      }
    });

    var receiptDatasets = [
      { label: 'Today', data: todayReceipts, backgroundColor: 'rgba(34, 197, 94, 0.8)', borderColor: 'rgb(34, 197, 94)', borderWidth: 1 }
    ];
    if (hasYesterday) {
      receiptDatasets.push({ label: 'Yesterday', data: yesterdayReceipts, backgroundColor: 'rgba(107, 114, 128, 0.6)', borderColor: 'rgb(107, 114, 128)', borderWidth: 1 });
    }
    if (hasLastWeek) {
      receiptDatasets.push({ label: 'Last Week', data: lastWeekReceipts, backgroundColor: 'rgba(156, 163, 175, 0.5)', borderColor: 'rgb(156, 163, 175)', borderWidth: 1 });
    }

    chartInstances.receipts = new Chart(receiptsCanvas, {
      type: 'bar',
      data: { labels: labels, datasets: receiptDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { title: { display: true, text: 'Time Slot' } },
          y: { beginAtZero: true, title: { display: true, text: 'Receipt Count' } }
        }
      }
    });

    chartInstances.forecastSales = new Chart(forecastSalesCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Forecast (Landing) — Net Sales (THB)',
          data: forecastNet,
          borderColor: 'rgb(234, 88, 12)',
          backgroundColor: 'rgba(234, 88, 12, 0.1)',
          borderWidth: 2,
          borderDash: [4, 4],
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { title: { display: true, text: 'Time Slot' } },
          y: { beginAtZero: true, title: { display: true, text: 'Forecast total (THB)' } }
        }
      }
    });

    chartInstances.forecastReceipts = new Chart(forecastReceiptsCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Forecast (Landing) — Receipt Count',
          data: forecastReceipts,
          borderColor: 'rgb(234, 88, 12)',
          backgroundColor: 'rgba(234, 88, 12, 0.1)',
          borderWidth: 2,
          borderDash: [4, 4],
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { title: { display: true, text: 'Time Slot' } },
          y: { beginAtZero: true, title: { display: true, text: 'Forecast total (count)' } }
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

  function fetchBusinessHours() {
    fetch('/api/business-hours').then(function (res) { return parseJsonResponse(res); }).then(function (settings) {
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
      '<td>Total</td>' +
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
    var sel = document.getElementById('output-date');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select date —</option>';
    (dates || []).forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
    if (selectedValue && dates && dates.indexOf(selectedValue) !== -1) {
      sel.value = selectedValue;
    }
  }

  function getTodayYYYYMMDD() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function refreshOutputDateSelect() {
    var sel = document.getElementById('output-date');
    if (!sel) return;
    fetch('/api/dates').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var dates = body.dates || [];
      var todayStr = getTodayYYYYMMDD();
      var initialDate = state.referenceDate || sel.value || (dates.indexOf(todayStr) !== -1 ? todayStr : (dates.length ? dates[0] : null));
      fillOutputDateSelect(dates, initialDate);
      var chosen = sel.value;
      if (chosen && dates.indexOf(chosen) !== -1) {
        fetch('/api/report?referenceDate=' + encodeURIComponent(chosen)).then(function (r) {
          return parseJsonResponse(r).then(function (data) {
            if (!r.ok) return;
            state.today = data.today;
            state.yesterday = data.yesterday || null;
            state.lastWeek = data.lastWeek || null;
            state.referenceDate = data.referenceDate;
            fillTimeSelects(state.referenceDate);
            renderReport();
          });
        }).catch(function () {});
      } else {
        renderReport();
      }
    }).catch(function () { renderReport(); });
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
  }

  function fillDailyEndDateSelect(dates, selectedValue) {
    var sel = document.getElementById('daily-end-date');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select date —</option>';
    (dates || []).forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
    if (selectedValue && dates && dates.indexOf(selectedValue) !== -1) {
      sel.value = selectedValue;
    } else if (dates && dates.length) {
      sel.value = dates[0];
    }
  }

  function refreshDailyDateSelect() {
    fetch('/api/dates').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var dates = body.dates || [];
      var sel = document.getElementById('daily-end-date');
      fillDailyEndDateSelect(dates, sel ? sel.value : null);
      if (dates.length && (!sel || !sel.value)) {
        renderDailySummary();
      } else {
        renderDailySummary();
      }
    }).catch(function () {});
  }

  function renderDailySummary() {
    var endDate = document.getElementById('daily-end-date') && document.getElementById('daily-end-date').value;
    var container = document.getElementById('daily-summary-tables');
    var emptyEl = document.getElementById('daily-empty');
    if (!container) return;
    if (!endDate) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    fetch('/api/daily-summary?referenceDate=' + encodeURIComponent(endDate) + '&days=7').then(function (res) {
      return parseJsonResponse(res).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Failed to load daily summary');
        return body;
      });
    }).then(function (body) {
      var days = body.days || [];
      if (days.length === 0) {
        container.innerHTML = '';
        if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = 'No data for the selected period.'; }
        return;
      }
      destroyDailyCharts();
      var deptOrder = DEPARTMENTS.slice();
      var dailyChartColors = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0d9488'];
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

      var table1 = '<section class="summary-section"><h3>Sales by Department (Net Sales)</h3><table class="report-table daily-table"><thead><tr><th>Department</th>';
      dateLabels.forEach(function (l) { table1 += '<th>' + l + '</th>'; });
      table1 += '<th>Grand Total</th></tr></thead><tbody>';
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
      table1 += '<tr class="total-row"><td>Grand Total</td>';
      totalRow.forEach(function (v) { table1 += '<td>' + formatInt(v) + '</td>'; });
      table1 += '</tr></tbody></table></section>';

      var table1b = '<section class="summary-section"><h3>Department composition by day (share of net sales %)</h3><table class="report-table daily-table"><thead><tr><th>Department</th>';
      dateLabels.forEach(function (l) { table1b += '<th>' + l + '</th>'; });
      table1b += '<th>Grand Total</th></tr></thead><tbody>';
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
      table1b += '<tr class="total-row"><td>Total</td>';
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

      var table2 = '<section class="summary-section"><h3>Key metrics</h3><table class="report-table daily-table"><thead><tr><th>Metric</th>';
      dateLabels.forEach(function (l) { table2 += '<th>' + l + '</th>'; });
      table2 += '<th>Grand Total</th></tr></thead><tbody>';
      table2 += '<tr><td>Sales per hour (JPY)</td>';
      salesPerHour.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalHours ? Math.round(grandTotalSales / totalHours) : 0) + '</td></tr>';
      table2 += '<tr><td>Receipts per hour</td>';
      receiptsPerHour.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalHours ? Math.round(totalReceipts / totalHours) : 0) + '</td></tr>';
      table2 += '<tr><td>Receipt count</td>';
      receiptCounts.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalReceipts) + '</td></tr>';
      table2 += '<tr><td>Avg receipt value (JPY)</td>';
      avgReceipt.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + (totalReceipts ? formatInt(Math.round(grandTotalSales / totalReceipts)) : '—') + '</td></tr>';
      table2 += '<tr><td>Items per receipt</td>';
      itemsPerReceipt.forEach(function (v) { table2 += '<td>' + v + '</td>'; });
      table2 += '<td>' + (totalReceipts ? (totalQty / totalReceipts).toFixed(1) : '—') + '</td></tr>';
      table2 += '<tr><td>Quantity sold</td>';
      qtySold.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + formatInt(totalQty) + '</td></tr>';
      table2 += '<tr><td>Avg item price (JPY)</td>';
      avgItemPrice.forEach(function (v) { table2 += '<td>' + formatInt(v) + '</td>'; });
      table2 += '<td>' + (totalQty ? formatInt(Math.round(grandTotalSales / totalQty)) : '—') + '</td></tr>';
      table2 += '</tbody></table></section>';

      var chartSectionHtml = '<section class="summary-section chart-section"><h3 class="chart-title">Weekly sales by department (Net Sales)</h3><div class="chart-wrapper"><canvas id="daily-chart-sales"></canvas></div><h3 class="chart-title">Department composition by day (%)</h3><div class="chart-wrapper"><canvas id="daily-chart-composition"></canvas></div><h3 class="chart-title">Key metrics trend</h3><div class="chart-wrapper"><canvas id="daily-chart-metrics"></canvas></div></section>';

      container.innerHTML = table1 + table1b + chartSectionHtml + table2;

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
                x: { stacked: true, title: { display: true, text: 'Date' } },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Net Sales (JPY)' } }
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
                x: { stacked: true, title: { display: true, text: 'Date' } },
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
                { label: 'Sales per hour (JPY)', data: salesPerHour, borderColor: 'rgb(37, 99, 235)', backgroundColor: 'rgba(37, 99, 235, 0.1)', borderWidth: 2, fill: true, tension: 0.2, pointRadius: 4, yAxisID: 'y' },
                { label: 'Receipt count', data: receiptCounts, borderColor: 'rgb(34, 197, 94)', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderWidth: 2, fill: false, tension: 0.2, pointRadius: 4, yAxisID: 'y1' }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              interaction: { mode: 'index', intersect: false },
              plugins: { legend: { position: 'top' } },
              scales: {
                x: { title: { display: true, text: 'Date' } },
                y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'Sales per hour (JPY)' } },
                y1: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Receipt count' }, grid: { drawOnChartArea: false } }
              }
            }
          });
        }
      }
    }).catch(function () {
      container.innerHTML = '';
      if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = 'Failed to load daily summary.'; }
    });
  }

  function init() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    var departmentSelect = document.getElementById('department-select');
    if (departmentSelect) departmentSelect.addEventListener('change', renderReport);
    fillTimeSelects(state.referenceDate);

    var outputDateEl = document.getElementById('output-date');
    if (outputDateEl) outputDateEl.addEventListener('change', function () {
      var date = this.value;
      if (!date) return;
      fetch('/api/report?referenceDate=' + encodeURIComponent(date)).then(function (res) {
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
      }).catch(function () {});
    });

    var dailyEndEl = document.getElementById('daily-end-date');
    if (dailyEndEl) dailyEndEl.addEventListener('change', renderDailySummary);

    var timeStart = document.getElementById('time-start');
    var timeEnd = document.getElementById('time-end');
    if (timeStart) timeStart.addEventListener('change', renderReport);
    if (timeEnd) timeEnd.addEventListener('change', renderReport);

    /* Report page: load initial data for hourly tab */
    if (outputDateEl) {
      fetchBusinessHours();
      refreshOutputDateSelect();
      renderReport();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
