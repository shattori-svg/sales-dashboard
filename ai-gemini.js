'use strict';

const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const AI_ENABLED = GEMINI_API_KEY.length > 0;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 30000;

let ai = null;
if (AI_ENABLED) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

const DEPARTMENTS = ['Grocery', 'Fruit & Vegetable', 'Fish & Seafood', 'Meat', 'Delicatessen', 'Store Management'];

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

function summarizeReport(dateStr, report) {
  if (!report || !report.total || !report.total.hourly) return null;
  const hourly = report.total.hourly;
  let netSales = 0, grossSales = 0, receiptCount = 0, quantitySold = 0;
  hourly.forEach((h) => {
    netSales += h.netSales || 0;
    grossSales += h.grossSales || h.netSales || 0;
    receiptCount += h.receiptCount || 0;
    quantitySold += h.quantitySold || 0;
  });
  const byDept = {};
  DEPARTMENTS.forEach((dept) => {
    byDept[dept] = 0;
    if (report.byDepartment && report.byDepartment[dept] && report.byDepartment[dept].hourly) {
      report.byDepartment[dept].hourly.forEach((h) => {
        byDept[dept] += h.netSales || 0;
      });
    }
  });
  const dow = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  return { date: dateStr, dow, netSales, grossSales, receiptCount, quantitySold, hoursCount: hourly.length, byDepartment: byDept };
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function buildAnalysisDataText(summaries) {
  if (!summaries || summaries.length === 0) return '';
  let text = '## Sales Data Summary\n\n';
  summaries.forEach((s) => {
    if (!s) return;
    text += `### ${s.date} (${s.dow})\n`;
    text += `- Net Sales: ${formatNumber(s.netSales)} Baht\n`;
    text += `- Gross Sales: ${formatNumber(s.grossSales)} Baht\n`;
    text += `- Receipt Count: ${formatNumber(s.receiptCount)}\n`;
    text += `- Quantity Sold: ${formatNumber(s.quantitySold)}\n`;
    text += `- Hours with data: ${s.hoursCount}\n`;
    if (s.receiptCount > 0) {
      text += `- Avg receipt value: ${formatNumber(Math.round(s.netSales / s.receiptCount))} Baht\n`;
    }
    text += `- Department breakdown (Net Sales):\n`;
    DEPARTMENTS.forEach((dept) => {
      const val = s.byDepartment[dept] || 0;
      const pct = s.netSales > 0 ? ((val / s.netSales) * 100).toFixed(1) : '0.0';
      text += `  - ${dept}: ${formatNumber(val)} Baht (${pct}%)\n`;
    });
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

async function callGemini(prompt) {
  if (!ai) throw new Error('AI_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return response.text || '';
  } finally {
    clearTimeout(timer);
  }
}

async function generateAnalysis(getReport, storeId, referenceDate, lang) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const todayReport = await getReport(referenceDate, storeId);
  if (!todayReport) throw new Error('NO_DATA');

  const yesterdayStr = addDays(referenceDate, -1);
  const lastWeekStr = addDays(referenceDate, -7);
  const yesterdayReport = await getReport(yesterdayStr, storeId);
  const lastWeekReport = await getReport(lastWeekStr, storeId);

  const todaySummary = summarizeReport(referenceDate, todayReport);
  const yesterdaySummary = summarizeReport(yesterdayStr, yesterdayReport);
  const lastWeekSummary = summarizeReport(lastWeekStr, lastWeekReport);

  const dataText = buildAnalysisDataText([todaySummary, yesterdaySummary, lastWeekSummary].filter(Boolean));
  const compText = buildComparisonText(todaySummary, yesterdaySummary, lastWeekSummary);

  const langInstruction = lang === 'ja' ? '日本語で回答してください。'
    : lang === 'th' ? 'กรุณาตอบเป็นภาษาไทย'
    : 'Respond in English.';

  const prompt = `You are a retail sales analyst for LOPIA Thailand (a supermarket chain).
Analyze the following sales data and provide actionable insights.

${dataText}
${compText ? '### Comparison\n' + compText + '\n' : ''}
Please provide:
1. A brief overall summary of the day's performance (2-3 sentences)
2. Key findings: notable trends, anomalies, or patterns across departments (3-5 bullet points)
3. Actionable recommendations for store management (2-3 bullet points)

Format your response with clear headings. Keep it concise and practical.
${langInstruction}`;

  return callGemini(prompt);
}

async function generateForecast(getReport, storeId, referenceDate, lang) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const days = 7;
  const summaries = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = addDays(referenceDate, -i);
    const report = await getReport(dateStr, storeId);
    if (report) {
      summaries.push(summarizeReport(dateStr, report));
    }
  }

  if (summaries.length === 0) throw new Error('NO_DATA');

  const dataText = buildAnalysisDataText(summaries);
  const tomorrowStr = addDays(referenceDate, 1);
  const tomorrowDow = new Date(tomorrowStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

  const langInstruction = lang === 'ja' ? '日本語で回答してください。'
    : lang === 'th' ? 'กรุณาตอบเป็นภาษาไทย'
    : 'Respond in English.';

  const prompt = `You are a retail sales forecasting analyst for LOPIA Thailand (a supermarket chain).
Based on the following ${summaries.length} days of sales data, provide a forecast for tomorrow (${tomorrowStr}, ${tomorrowDow}).

${dataText}
Please provide:
1. **Tomorrow's Forecast**: Expected net sales range (estimated min - max in Baht), expected receipt count range, and key department trends
2. **Weekly Outlook**: Brief 2-3 sentence outlook for the coming week
3. **Key Factors**: What factors might influence sales (day of week patterns, trends observed)

Important: Clearly state that these are AI-generated estimates for reference only, not guaranteed predictions.
Format with clear headings. Be specific with numbers where possible.
${langInstruction}`;

  return callGemini(prompt);
}

/**
 * Build hourly context for today (so far) and daily totals for yesterday/last week.
 */
function buildHourlyForecastContext(todayReport, yesterdaySummary, lastWeekSummary) {
  if (!todayReport || !todayReport.total || !todayReport.total.hourly) return '';
  const hourly = todayReport.total.hourly;
  let text = '## Today (reference date) — hourly so far\n';
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
 * Returns { forecastTotalNetSales, forecastLowNetSales, forecastHighNetSales, forecastTotalReceipts, forecastLowReceipts, forecastHighReceipts }.
 */
async function generateHourlyForecast(getReport, storeId, referenceDate) {
  if (!AI_ENABLED) throw new Error('AI_NOT_CONFIGURED');

  const todayReport = await getReport(referenceDate, storeId);
  if (!todayReport) throw new Error('NO_DATA');

  const yesterdayStr = addDays(referenceDate, -1);
  const lastWeekStr = addDays(referenceDate, -7);
  const yesterdayReport = await getReport(yesterdayStr, storeId);
  const lastWeekReport = await getReport(lastWeekStr, storeId);

  const yesterdaySummary = summarizeReport(yesterdayStr, yesterdayReport);
  const lastWeekSummary = summarizeReport(lastWeekStr, lastWeekReport);

  const contextText = buildHourlyForecastContext(todayReport, yesterdaySummary, lastWeekSummary);

  const prompt = `You are a retail sales forecaster for LOPIA Thailand. For the SAME day (reference date: ${referenceDate}), predict END-OF-DAY totals.

${contextText}

Respond with ONLY a single JSON object, no other text or markdown. Use this exact structure:
{"forecastTotalNetSales": number, "forecastLowNetSales": number, "forecastHighNetSales": number, "forecastTotalReceipts": number, "forecastLowReceipts": number, "forecastHighReceipts": number}

Rules:
- All numbers are integers (Baht for sales, count for receipts).
- forecastTotalNetSales/Receipts = your best estimate for full-day total.
- forecastLow* and forecastHigh* = plausible range (min–max).
- If today already has cumulative data, your forecast total must be >= that cumulative (end-of-day cannot be less than current).`;

  const raw = await callGemini(prompt);
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
  generateHourlyForecast,
};
