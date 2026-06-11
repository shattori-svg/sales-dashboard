'use strict';

const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const AI_ENABLED = GEMINI_API_KEY.length > 0;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FORECAST_MODEL = process.env.GEMINI_FORECAST_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 30000;

let ai = null;
if (AI_ENABLED) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

const DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];
const THAILAND_TZ = 'Asia/Bangkok';

function getThailandTimeFromISO(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-GB', { timeZone: THAILAND_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (_) {
    return null;
  }
}

function isAvailable() {
  return AI_ENABLED;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function getHourlyForDepartment(report, department) {
  if (!report) return null;
  if (!department || department === 'Total') {
    return report.total && report.total.hourly ? report.total.hourly : null;
  }
  const dept = report.byDepartment && report.byDepartment[department];
  return dept && dept.hourly ? dept.hourly : null;
}

function summarizeReport(dateStr, report, department) {
  const hourly = getHourlyForDepartment(report, department || 'Total');
  if (!hourly || !hourly.length) return null;
  let netSales = 0, grossSales = 0, receiptCount = 0, quantitySold = 0;
  hourly.forEach((h) => {
    netSales += h.netSales || 0;
    grossSales += h.grossSales || h.netSales || 0;
    receiptCount += h.receiptCount || 0;
    quantitySold += h.quantitySold || 0;
  });
  const byDept = {};
  if (!department || department === 'Total') {
    DEPARTMENTS.forEach((dept) => {
      byDept[dept] = 0;
      if (report.byDepartment && report.byDepartment[dept] && report.byDepartment[dept].hourly) {
        report.byDepartment[dept].hourly.forEach((h) => {
          byDept[dept] += h.netSales || 0;
        });
      }
    });
  }
  const dow = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  return { date: dateStr, dow, netSales, grossSales, receiptCount, quantitySold, hoursCount: hourly.length, byDepartment: byDept };
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function buildAnalysisDataText(summaries, department) {
  if (!summaries || summaries.length === 0) return '';
  const singleDept = department && department !== 'Total';
  let text = singleDept ? `## Sales Data Summary (${department})\n\n` : '## Sales Data Summary\n\n';
  summaries.forEach((s) => {
    if (!s) return;
    text += `### ${s.date} (${s.dow})\n`;
    text += `- Net Sales: ${formatNumber(s.netSales)} Baht\n`;
    text += `- Gross Sales: ${formatNumber(s.grossSales)} Baht\n`;
    if (!singleDept) {
      text += `- Receipt Count: ${formatNumber(s.receiptCount)}\n`;
    }
    text += `- Quantity Sold: ${formatNumber(s.quantitySold)}\n`;
    text += `- Hours with data: ${s.hoursCount}\n`;
    if (!singleDept && s.receiptCount > 0) {
      text += `- Avg receipt value: ${formatNumber(Math.round(s.netSales / s.receiptCount))} Baht\n`;
    }
    if (!singleDept && s.byDepartment && Object.keys(s.byDepartment).length > 0) {
      text += `- Department breakdown (Net Sales):\n`;
      DEPARTMENTS.forEach((dept) => {
        const val = s.byDepartment[dept] || 0;
        const pct = s.netSales > 0 ? ((val / s.netSales) * 100).toFixed(1) : '0.0';
        text += `  - ${dept}: ${formatNumber(val)} Baht (${pct}%)\n`;
      });
    }
    text += '\n';
  });
  return text;
}

function buildComparisonText(todaySummary, yesterdaySummary, lastWeekSummary) {
  if (!todaySummary) return '';
  let text = '';
  if (yesterdaySummary) {
    const dodPct = yesterdaySummary.netSales > 0
      ? ((todaySummary.netSales / yesterdaySummary.netSales) * 100).toFixed(1)
      : 'N/A';
    text += `- Day-over-Day (vs ${yesterdaySummary.date}): ${dodPct}%\n`;
  }
  if (lastWeekSummary) {
    const wowPct = lastWeekSummary.netSales > 0
      ? ((todaySummary.netSales / lastWeekSummary.netSales) * 100).toFixed(1)
      : 'N/A';
    text += `- Week-over-Week (vs ${lastWeekSummary.date}): ${wowPct}%\n`;
  }
  return text;
}

async function callGemini(prompt, modelOverride, timeoutMs) {
  if (!ai) throw new Error('AI_NOT_CONFIGURED');
  const model = modelOverride || MODEL;
  const limit = timeoutMs || TIMEOUT_MS;
  // Promise.race-based timeout: the previous AbortController was never wired
  // to the request, so the 30s timeout silently did nothing.
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('AI_TIMEOUT')), limit);
    if (timer.unref) timer.unref();
  });
  try {
    const response = await Promise.race([
      ai.models.generateContent({ model, contents: prompt }),
      timeout,
    ]);
    return response.text || '';
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(raw) {
  const cleaned = String(raw).replace(/```json?\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  return JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned);
}

async function generateAnalysis(getReport, storeId, referenceDate, lang, department) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const dept = department || 'Total';

  const todayReport = await getReport(referenceDate, storeId);
  if (!todayReport) throw new Error('NO_DATA');
  if (!getHourlyForDepartment(todayReport, dept)) throw new Error('NO_DATA');

  const yesterdayStr = addDays(referenceDate, -1);
  const lastWeekStr = addDays(referenceDate, -7);
  const yesterdayReport = await getReport(yesterdayStr, storeId);
  const lastWeekReport = await getReport(lastWeekStr, storeId);

  const todaySummary = summarizeReport(referenceDate, todayReport, dept);
  const yesterdaySummary = summarizeReport(yesterdayStr, yesterdayReport, dept);
  const lastWeekSummary = summarizeReport(lastWeekStr, lastWeekReport, dept);

  const dataText = buildAnalysisDataText([todaySummary, yesterdaySummary, lastWeekSummary].filter(Boolean), dept);
  const compText = buildComparisonText(todaySummary, yesterdaySummary, lastWeekSummary);

  const langInstruction = lang === 'ja' ? '日本語で回答してください。'
    : lang === 'th' ? 'กรุณาตอบเป็นภาษาไทย'
    : 'Respond in English.';

  const scopeNote = dept !== 'Total' ? ` (Scope: ${dept} department only)` : '';

  const prompt = `You are a retail sales analyst for LOPIA Thailand (a supermarket chain).
Analyze the following sales data and provide actionable insights.${scopeNote}

${dataText}
${compText ? '### Comparison\n' + compText + '\n' : ''}
Please provide:
1. A brief overall summary of the day's performance (2-3 sentences)
2. Key findings: notable trends, anomalies, or patterns${dept !== 'Total' ? ' for this department' : ' across departments'} (3-5 bullet points)
3. Actionable recommendations for store management (2-3 bullet points)

Format your response with clear headings. Keep it concise and practical.
${langInstruction}`;

  return callGemini(prompt);
}

async function generateForecast(getReport, storeId, referenceDate, lang, department) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const dept = department || 'Total';

  const days = 7;
  const summaries = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = addDays(referenceDate, -i);
    const report = await getReport(dateStr, storeId);
    if (report && getHourlyForDepartment(report, dept)) {
      summaries.push(summarizeReport(dateStr, report, dept));
    }
  }

  if (summaries.length === 0) throw new Error('NO_DATA');

  const dataText = buildAnalysisDataText(summaries, dept);
  const tomorrowStr = addDays(referenceDate, 1);
  const tomorrowDow = new Date(tomorrowStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

  const langInstruction = lang === 'ja' ? '日本語で回答してください。'
    : lang === 'th' ? 'กรุณาตอบเป็นภาษาไทย'
    : 'Respond in English.';

  const scopeNote = dept !== 'Total' ? ` (Scope: ${dept} department only)` : '';

  const receiptPart = dept === 'Total' ? ', expected receipt count range' : '';
  const prompt = `You are a retail sales forecasting analyst for LOPIA Thailand (a supermarket chain).${scopeNote}
Based on the following ${summaries.length} days of sales data, provide a forecast for tomorrow (${tomorrowStr}, ${tomorrowDow}).

${dataText}
Please provide:
1. **Tomorrow's Forecast**: Expected net sales range (estimated min - max in Baht)${receiptPart}, and key department trends
2. **Weekly Outlook**: Brief 2-3 sentence outlook for the coming week
3. **Key Factors**: What factors might influence sales (day of week patterns, trends observed)

Important: Clearly state that these are AI-generated estimates for reference only, not guaranteed predictions.
Format with clear headings. Be specific with numbers where possible.
${langInstruction}`;

  return callGemini(prompt);
}

/**
 * Sum hourly totals up to and including slots that end by currentTimeStr (HH:MM).
 * timeKey format is "HH:MM-HH:MM"; we include slot if end part <= currentTimeStr.
 */
function sumHourlyUpTo(hourly, currentTimeStr) {
  if (!hourly || !hourly.length || !currentTimeStr) return { netSales: 0, receiptCount: 0 };
  let netSales = 0, receiptCount = 0;
  const current = String(currentTimeStr).trim();
  for (const h of hourly) {
    const timeKey = h.timeKey || '';
    const endTime = timeKey.includes('-') ? timeKey.split('-')[1].trim() : '';
    if (endTime && endTime <= current) {
      netSales += h.netSales || 0;
      receiptCount += h.receiptCount || 0;
    }
  }
  return { netSales, receiptCount };
}

/**
 * Build context for same-day insight: current time, today so far, yesterday/last week at same time.
 */
function buildTodayInsightContext(todayReport, yesterdayReport, lastWeekReport, currentTimeStr, department) {
  const dept = department || 'Total';
  const todayHourly = getHourlyForDepartment(todayReport, dept);
  if (!todayReport || !todayHourly || !todayHourly.length) return '';

  const yesterdayHourly = getHourlyForDepartment(yesterdayReport, dept);
  const lastWeekHourly = getHourlyForDepartment(lastWeekReport, dept);

  const todaySoFar = sumHourlyUpTo(todayHourly, currentTimeStr);
  const yesterdaySame = yesterdayHourly ? sumHourlyUpTo(yesterdayHourly, currentTimeStr) : { netSales: 0, receiptCount: 0 };
  const lastWeekSame = lastWeekHourly ? sumHourlyUpTo(lastWeekHourly, currentTimeStr) : { netSales: 0, receiptCount: 0 };

  const scopeNote = dept !== 'Total' ? ` (${dept})` : '';
  const includeReceipt = dept === 'Total';
  let text = `## Current time (as of ${currentTimeStr})${scopeNote}\n\n`;
  text += `### Today so far (cumulative up to ${currentTimeStr})\n`;
  text += `- Net Sales: ${formatNumber(todaySoFar.netSales)} Baht\n`;
  if (includeReceipt) text += `- Receipt Count: ${formatNumber(todaySoFar.receiptCount)}\n`;
  text += '\n';
  text += `### Yesterday at same time (up to ${currentTimeStr})\n`;
  text += `- Net Sales: ${formatNumber(yesterdaySame.netSales)} Baht\n`;
  if (includeReceipt) text += `- Receipt Count: ${formatNumber(yesterdaySame.receiptCount)}\n`;
  text += '\n';
  text += `### Same day last week at same time (up to ${currentTimeStr})\n`;
  text += `- Net Sales: ${formatNumber(lastWeekSame.netSales)} Baht\n`;
  if (includeReceipt) text += `- Receipt Count: ${formatNumber(lastWeekSame.receiptCount)}\n`;
  return text;
}

/**
 * Generate same-day insight: comparison at current time + end-of-day landing forecast (markdown).
 */
async function generateTodayInsight(getReport, storeId, referenceDate, currentTimeIso, lang, department) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const dept = department || 'Total';

  const todayReport = await getReport(referenceDate, storeId);
  if (!todayReport) throw new Error('NO_DATA');
  if (!getHourlyForDepartment(todayReport, dept)) throw new Error('NO_DATA');

  let currentTimeStr = getThailandTimeFromISO(currentTimeIso || new Date().toISOString()) || '23:59';

  const yesterdayStr = addDays(referenceDate, -1);
  const lastWeekStr = addDays(referenceDate, -7);
  const yesterdayReport = await getReport(yesterdayStr, storeId);
  const lastWeekReport = await getReport(lastWeekStr, storeId);

  const contextText = buildTodayInsightContext(todayReport, yesterdayReport, lastWeekReport, currentTimeStr, dept);

  const langInstruction = lang === 'ja' ? '日本語で回答してください。'
    : lang === 'th' ? 'กรุณาตอบเป็นภาษาไทย'
    : 'Respond in English.';

  const scopeNote = dept !== 'Total' ? ` (Scope: ${dept} department)` : '';
  const landingForecastPart = dept === 'Total'
    ? 'estimate the expected total net sales and receipt count at end of day'
    : 'estimate the expected total net sales at end of day for this department';

  const prompt = `You are a retail sales analyst for LOPIA Thailand (a supermarket chain).${scopeNote}
Today is ${referenceDate}. The current time is ${currentTimeStr}. Sales data so far today is partial (business is still open).

${contextText}

Please provide:
1. **Comparison at current time**: Brief comparison of today's performance so far vs. yesterday and same day last week at the same time (e.g. ahead/behind, % difference). Do not compare full-day totals—only the cumulative figures up to ${currentTimeStr}.
2. **End-of-day landing forecast (着地予測)**: Based on the trend so far and typical patterns, ${landingForecastPart}. Give a range (min–max) and brief reasoning. Clearly state these are AI estimates for reference only.

Format with clear headings. Be concise and practical.
${langInstruction}`;

  return callGemini(prompt);
}

/**
 * Build hourly context for today (so far, up to thailandTimeStr if provided) and daily totals for yesterday/last week.
 * When thailandTimeStr (HH:MM) is set, only slots that have ended by that time are included so the forecast is time-aware.
 */
function buildHourlyForecastContext(todayReport, yesterdaySummary, lastWeekSummary, thailandTimeStr) {
  if (!todayReport || !todayReport.total || !todayReport.total.hourly) return '';
  let hourly = todayReport.total.hourly;
  if (thailandTimeStr) {
    const t = String(thailandTimeStr).trim();
    hourly = hourly.filter((h) => {
      const timeKey = h.timeKey || '';
      const endTime = timeKey.includes('-') ? timeKey.split('-')[1].trim() : '';
      return endTime && endTime <= t;
    });
  }
  let text = thailandTimeStr
    ? `## Today (reference date) — hourly so far as of ${thailandTimeStr} Thailand time\n`
    : '## Today (reference date) — hourly so far\n';
  hourly.forEach((h) => {
    text += `- ${h.timeKey || h.timeLabel}: Net ${formatNumber(h.netSales || 0)} Baht, Receipts ${formatNumber(h.receiptCount || 0)}\n`;
  });
  const todayCumNet = hourly.reduce((s, h) => s + (h.netSales || 0), 0);
  const todayCumRcpt = hourly.reduce((s, h) => s + (h.receiptCount || 0), 0);
  text += `Cumulative so far: Net Sales ${formatNumber(todayCumNet)} Baht, Receipt Count ${formatNumber(todayCumRcpt)}\n\n`;
  if (yesterdaySummary) {
    text += `## Yesterday: Net Sales ${formatNumber(yesterdaySummary.netSales)} Baht, Receipt Count ${formatNumber(yesterdaySummary.receiptCount)}\n`;
  }
  if (lastWeekSummary) {
    text += `## Same day last week: Net Sales ${formatNumber(lastWeekSummary.netSales)} Baht, Receipt Count ${formatNumber(lastWeekSummary.receiptCount)}\n`;
  }
  return text;
}

/**
 * Generate end-of-day forecast numbers for the chart (sales and receipts).
 * currentTimeIso: optional ISO string; when set, "today so far" is filtered to Thailand time so forecast is time-aware.
 * Returns { forecastTotalNetSales, forecastLowNetSales, forecastHighNetSales, forecastTotalReceipts, forecastLowReceipts, forecastHighReceipts }.
 */
async function generateHourlyForecast(getReport, storeId, referenceDate, currentTimeIso) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const todayReport = await getReport(referenceDate, storeId);
  if (!todayReport) throw new Error('NO_DATA');

  const thailandTimeStr = getThailandTimeFromISO(currentTimeIso || new Date().toISOString());

  const yesterdayStr = addDays(referenceDate, -1);
  const lastWeekStr = addDays(referenceDate, -7);
  const yesterdayReport = await getReport(yesterdayStr, storeId);
  const lastWeekReport = await getReport(lastWeekStr, storeId);

  const yesterdaySummary = summarizeReport(yesterdayStr, yesterdayReport);
  const lastWeekSummary = summarizeReport(lastWeekStr, lastWeekReport);

  const contextText = buildHourlyForecastContext(todayReport, yesterdaySummary, lastWeekSummary, thailandTimeStr);

  const prompt = `You are a retail sales forecaster for LOPIA Thailand. For the SAME day (reference date: ${referenceDate}), predict END-OF-DAY totals. All times are Thailand time (Asia/Bangkok).${thailandTimeStr ? ` Current time in Thailand: ${thailandTimeStr}. "Today so far" below is cumulative only up to this time.` : ''}

${contextText}

Respond with ONLY a single JSON object, no other text or markdown. Use this exact structure:
{"forecastTotalNetSales": number, "forecastLowNetSales": number, "forecastHighNetSales": number, "forecastTotalReceipts": number, "forecastLowReceipts": number, "forecastHighReceipts": number}

Rules:
- All numbers are integers (Baht for sales, count for receipts).
- forecastTotalNetSales/Receipts = your best estimate for full-day total.
- forecastLow* and forecastHigh* = plausible range (min–max).
- If today already has cumulative data, your forecast total must be >= that cumulative (end-of-day cannot be less than current).`;

  const raw = await callGemini(prompt, FORECAST_MODEL);
  const parsed = extractJson(raw);

  return {
    forecastTotalNetSales: Number(parsed.forecastTotalNetSales),
    forecastLowNetSales: Number(parsed.forecastLowNetSales),
    forecastHighNetSales: Number(parsed.forecastHighNetSales),
    forecastTotalReceipts: Number(parsed.forecastTotalReceipts),
    forecastLowReceipts: Number(parsed.forecastLowReceipts),
    forecastHighReceipts: Number(parsed.forecastHighReceipts),
  };
}

// ---------------------------------------------------------------------------
// Daily brief — pre-computed numbers (code) + narrative (LLM).
// All percentages/aggregations are calculated here so the model only explains;
// it never invents figures. COGS comes from byProduct[*].costAmount (merged
// day-after from BC value entries).
// ---------------------------------------------------------------------------

// Items whose recorded cost exceeds 3x sales are BC master-data defects
// (case cost registered as unit cost) — excluded from margin math.
const COST_ANOMALY_RATIO = 3;

function productMarginStats(byProduct) {
  let net = 0, cogs = 0, covered = 0, anomalies = 0, total = 0;
  for (const p of Object.values(byProduct || {})) {
    const sales = Number(p.totalNetSales) || 0;
    const cost = Number(p.costAmount) || 0;
    total++;
    if (cost <= 0 || sales <= 0) continue;
    if (cost > sales * COST_ANOMALY_RATIO) { anomalies++; continue; }
    net += sales;
    cogs += cost;
    covered++;
  }
  return {
    marginPct: net > 0 ? Math.round((net - cogs) / net * 1000) / 10 : null,
    coveredItems: covered,
    totalItems: total,
    anomalyItems: anomalies,
  };
}

// Like summarizeReport but falls back to total.totalRow / department totalRow
// when the report has no hourly rows (item-sales-only reports store day totals
// without hourly slots).
function summarizeAny(dateStr, report) {
  if (!report) return null;
  const viaHourly = summarizeReport(dateStr, report, 'Total');
  if (viaHourly) return viaHourly;
  const tr = report.total && report.total.totalRow;
  if (!tr) return null;
  const byDept = {};
  DEPARTMENTS.forEach((dept) => {
    const d = report.byDepartment && report.byDepartment[dept];
    let v = 0;
    if (d) {
      if (d.totalRow && d.totalRow.netSales != null) v = d.totalRow.netSales;
      else if (d.daily && d.daily.netSales != null) v = d.daily.netSales;
      else if (d.hourly) v = d.hourly.reduce((s, h) => s + (h.netSales || 0), 0);
    }
    byDept[dept] = v || 0;
  });
  const dow = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  return {
    date: dateStr,
    dow,
    netSales: tr.netSales || 0,
    grossSales: tr.grossSales || tr.netSales || 0,
    receiptCount: tr.receiptCount || 0,
    quantitySold: tr.quantitySold || 0,
    hoursCount: 0,
    byDepartment: byDept,
  };
}

function pctChange(curr, prev) {
  if (prev == null || prev <= 0 || curr == null) return null;
  return Math.round((curr / prev - 1) * 1000) / 10;
}

function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

function buildBriefData(reports, master) {
  // reports: { target, d1, d7, d14, d21, d28 } (summaries already filtered to non-null where possible)
  const { targetDate, target, d1, d7, d14, d21, d28 } = reports;
  const tSum = summarizeAny(targetDate, target);
  if (!tSum) return null;
  const d1Sum = d1.report ? summarizeAny(d1.date, d1.report) : null;
  const d7Sum = d7.report ? summarizeAny(d7.date, d7.report) : null;
  const wAvgSrcs = [d7, d14, d21, d28].map((x) => (x.report ? summarizeAny(x.date, x.report) : null)).filter(Boolean);
  const avg4w = wAvgSrcs.length
    ? wAvgSrcs.reduce((s, x) => s + x.netSales, 0) / wAvgSrcs.length
    : null;

  const margin = productMarginStats(target.byProduct);

  // Departments: sales + share + DoD/WoW + margin
  const deptMargin = {};
  for (const p of Object.values(target.byProduct || {})) {
    const dn = p.departmentName;
    if (!dn) continue;
    const sales = Number(p.totalNetSales) || 0;
    const cost = Number(p.costAmount) || 0;
    if (!deptMargin[dn]) deptMargin[dn] = { net: 0, cogs: 0 };
    if (cost > 0 && sales > 0 && cost <= sales * COST_ANOMALY_RATIO) {
      deptMargin[dn].net += sales;
      deptMargin[dn].cogs += cost;
    }
  }
  const departments = DEPARTMENTS.map((dept) => {
    const val = (tSum.byDepartment && tSum.byDepartment[dept]) || 0;
    const prev1 = d1Sum && d1Sum.byDepartment ? d1Sum.byDepartment[dept] || 0 : null;
    const prev7 = d7Sum && d7Sum.byDepartment ? d7Sum.byDepartment[dept] || 0 : null;
    const dm = deptMargin[dept];
    return {
      name: dept,
      netSales: Math.round(val),
      sharePct: tSum.netSales > 0 ? round1(val / tSum.netSales * 100) : 0,
      dodPct: pctChange(val, prev1),
      wowPct: pctChange(val, prev7),
      marginPct: dm && dm.net > 0 ? round1((dm.net - dm.cogs) / dm.net * 100) : null,
    };
  }).filter((d) => d.netSales > 0 || d.name !== 'Store Management');

  // Products: top sellers, movers vs same weekday last week, possible stockouts
  const nameOf = (code, p) => {
    const m = master && master[code];
    return (m && (m.nameEng || m.nameTha)) || p.itemName || code;
  };
  const currProducts = Object.entries(target.byProduct || {});
  const prevByCode = (d7.report && d7.report.byProduct) || {};
  const productRow = ([code, p]) => {
    const sales = Number(p.totalNetSales) || 0;
    const cost = Number(p.costAmount) || 0;
    return {
      itemCode: code,
      name: nameOf(code, p),
      department: p.departmentName || '',
      netSales: Math.round(sales),
      qty: Number(p.totalQuantitySold) || 0,
      marginPct: cost > 0 && sales > 0 && cost <= sales * COST_ANOMALY_RATIO
        ? round1((sales - cost) / sales * 100) : null,
    };
  };
  const top = currProducts
    .slice().sort((a, b) => (b[1].totalNetSales || 0) - (a[1].totalNetSales || 0))
    .slice(0, 10).map(productRow);

  const movers = [];
  for (const [code, p] of currProducts) {
    const curr = Number(p.totalNetSales) || 0;
    const prev = Number(prevByCode[code] && prevByCode[code].totalNetSales) || 0;
    if (prev < 500 && curr < 500) continue; // ignore noise
    movers.push({ row: productRow([code, p]), curr, prev, diff: curr - prev });
  }
  movers.sort((a, b) => b.diff - a.diff);
  const fmtMover = (m) => ({ ...m.row, prevNetSales: Math.round(m.prev), changeTHB: Math.round(m.diff) });
  const risers = movers.slice(0, 5).filter((m) => m.diff > 0).map(fmtMover);
  const fallers = movers.slice(-5).reverse().filter((m) => m.diff < 0).map(fmtMover);

  const zeroSales = [];
  for (const [code, pp] of Object.entries(prevByCode)) {
    const prev = Number(pp.totalNetSales) || 0;
    if (prev < 1000) continue;
    const now = target.byProduct && target.byProduct[code];
    if (!now || (Number(now.totalNetSales) || 0) === 0) {
      zeroSales.push({ itemCode: code, name: nameOf(code, pp), department: pp.departmentName || '', prevNetSales: Math.round(prev) });
    }
  }
  zeroSales.sort((a, b) => b.prevNetSales - a.prevNetSales);

  return {
    businessDate: targetDate,
    dow: tSum.dow,
    kpi: {
      netSales: Math.round(tSum.netSales),
      receiptCount: tSum.receiptCount,
      avgReceipt: tSum.receiptCount > 0 ? Math.round(tSum.netSales / tSum.receiptCount) : null,
      quantitySold: tSum.quantitySold,
      marginPct: margin.marginPct,
      cogsCoverage: `${margin.coveredItems}/${margin.totalItems}`,
      costAnomalyItems: margin.anomalyItems,
      dodPct: d1Sum ? pctChange(tSum.netSales, d1Sum.netSales) : null,
      wowPct: d7Sum ? pctChange(tSum.netSales, d7Sum.netSales) : null,
      vs4wAvgPct: avg4w ? pctChange(tSum.netSales, avg4w) : null,
      receiptDodPct: d1Sum ? pctChange(tSum.receiptCount, d1Sum.receiptCount) : null,
      receiptWowPct: d7Sum ? pctChange(tSum.receiptCount, d7Sum.receiptCount) : null,
    },
    departments,
    products: { top, risers, fallers, zeroSales: zeroSales.slice(0, 8) },
  };
}

/**
 * Generate and return the daily brief object (computed data + LLM narrative).
 * Heavy by design — runs as a scheduled pre-process, not interactively.
 */
async function generateDailyBrief(getReport, master, storeId, businessDate, lang) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const dates = {
    d1: addDays(businessDate, -1),
    d7: addDays(businessDate, -7),
    d14: addDays(businessDate, -14),
    d21: addDays(businessDate, -21),
    d28: addDays(businessDate, -28),
  };
  const target = await getReport(businessDate, storeId);
  const hasHourly = !!(target && target.total && target.total.hourly && target.total.hourly.length);
  const hasTotalRow = !!(target && target.total && target.total.totalRow);
  if (!hasHourly && !hasTotalRow) throw new Error('NO_DATA');
  const [r1, r7, r14, r21, r28] = await Promise.all([
    getReport(dates.d1, storeId).catch(() => null),
    getReport(dates.d7, storeId).catch(() => null),
    getReport(dates.d14, storeId).catch(() => null),
    getReport(dates.d21, storeId).catch(() => null),
    getReport(dates.d28, storeId).catch(() => null),
  ]);

  const data = buildBriefData({
    targetDate: businessDate,
    target,
    d1: { date: dates.d1, report: r1 },
    d7: { date: dates.d7, report: r7 },
    d14: { date: dates.d14, report: r14 },
    d21: { date: dates.d21, report: r21 },
    d28: { date: dates.d28, report: r28 },
  }, master);
  if (!data) throw new Error('NO_DATA');

  const langName = lang === 'en' ? 'English' : lang === 'th' ? 'Thai' : 'Japanese';
  const prompt = `You are a retail analyst writing the morning daily brief for LOPIA Thailand store managers.
All figures below are pre-computed and correct — do NOT recompute or invent numbers. Margin = gross margin from actual COGS; null margin means cost data is missing (do not treat as 0%). "vs4wAvgPct" compares against the average of the same weekday over the last 4 weeks (seasonality-adjusted).

${JSON.stringify(data)}

Write concise, practical commentary in ${langName}. Respond with ONLY a JSON object:
{"headline": string, "departments": string, "products": string, "actions": string}

- headline: 2-3 sentences. Overall verdict for the day (sales vs the same-weekday average and day before, margin). Mention the single most important fact first.
- departments: 2-4 sentences on department mix: which drove/dragged the day, margin standouts.
- products: 2-4 sentences: notable top sellers, risers/fallers, and possible stockouts (zeroSales items sold well last week but zero this day). If costAnomalyItems > 0, add one sentence that those items have broken cost master data in BC.
- actions: 2-3 short imperative bullet lines (separated by \\n) a store manager should do today.
No markdown headings inside values. Keep each value plain text (line breaks allowed).`;

  const raw = await callGemini(prompt, MODEL, 90000);
  const narrative = extractJson(raw);

  return {
    businessDate,
    storeId,
    lang: lang || 'ja',
    generatedAt: new Date().toISOString(),
    data,
    narrative: {
      headline: String(narrative.headline || ''),
      departments: String(narrative.departments || ''),
      products: String(narrative.products || ''),
      actions: String(narrative.actions || ''),
    },
  };
}

module.exports = {
  isAvailable,
  generateAnalysis,
  generateForecast,
  generateTodayInsight,
  generateHourlyForecast,
  generateDailyBrief,
};
