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

async function callGemini(prompt, modelOverride) {
  if (!ai) throw new Error('AI_NOT_CONFIGURED');
  const model = modelOverride || MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    return response.text || '';
  } finally {
    clearTimeout(timer);
  }
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
  const cleaned = raw.replace(/```json?\s*/gi, '').replace(/```\s*/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
  const parsed = JSON.parse(jsonStr);

  return {
    forecastTotalNetSales: Number(parsed.forecastTotalNetSales),
    forecastLowNetSales: Number(parsed.forecastLowNetSales),
    forecastHighNetSales: Number(parsed.forecastHighNetSales),
    forecastTotalReceipts: Number(parsed.forecastTotalReceipts),
    forecastLowReceipts: Number(parsed.forecastLowReceipts),
    forecastHighReceipts: Number(parsed.forecastHighReceipts),
  };
}

module.exports = {
  isAvailable,
  generateAnalysis,
  generateForecast,
  generateTodayInsight,
  generateHourlyForecast,
};
