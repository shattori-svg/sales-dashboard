'use strict';

// External-context provider for the daily brief (tier 1 — free, key-less,
// commercial-OK sources only; see docs/tech-research/20260611-external-context-apis.md).
//   - day of week / payday window  : computed from the date
//   - public holiday               : static Thai table (Nager.Date does NOT
//                                     cover Thailand — verified 2026-06-11)
//   - weather                      : Open-Meteo forecast API (past_days)
//   - air quality (PM2.5)          : Open-Meteo air-quality API
//   - disasters (flood/storm/etc.) : GDACS event list (filtered to events
//                                     active on the business date)
//
// API sub-fetches are best-effort: on any failure that factor is returned as
// null and the brief is generated without it. Nothing here may throw.

const logger = require('./logger');

const BANGKOK = { lat: 13.7563, lon: 100.5018 };
const FETCH_TIMEOUT_MS = 8000;

async function fetchJson(url, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS);
    if (timer.unref) timer.unref();
  });
  try {
    const res = await Promise.race([fetch(url, { headers: { Accept: 'application/json' } }), timeout]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.warn({ event: 'external_context_fetch_failed', source: label, err: err && err.message }, `external context: ${label} failed`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- day of week / payday (computed, never fails) ---
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
function computeCalendar(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+07:00');
  const dow = d.getUTCDay();
  const dom = Number(dateStr.slice(8, 10));
  // Thai retail: monthly salaries land at/near month-end; the 25th is also a
  // common payday. Heuristic only — labelled as such in the brief.
  let payday = null;
  if (dom >= 26 || dom <= 1) payday = { phase: 'payday', note: '給料日直後（購買増の傾向）' };
  else if (dom >= 22 && dom <= 25) payday = { phase: 'pre_payday', note: '給料日前（買い控えの傾向）' };
  return {
    dow: DOW_JA[dow],
    isWeekend: dow === 0 || dow === 6,
    payday,
  };
}

// --- public holiday (static Thai table) ---
// Nager.Date does not cover Thailand. Thai public holidays include
// lunar-calendar Buddhist days that shift yearly, so this table MUST be
// updated each year (and ideally cross-checked against the Bank of Thailand
// announcement). Source: BOT / public calendar 2026.
const THAI_HOLIDAYS = {
  '2026-01-01': "New Year's Day",
  '2026-01-02': 'Additional Special Holiday',
  '2026-03-03': 'Makha Bucha Day',
  '2026-04-06': 'Chakri Memorial Day',
  '2026-04-13': 'Songkran Festival',
  '2026-04-14': 'Songkran Festival',
  '2026-04-15': 'Songkran Festival',
  '2026-05-01': 'National Labour Day',
  '2026-05-04': 'Coronation Day',
  '2026-05-11': 'Royal Ploughing Ceremony Day',
  '2026-05-31': 'Visakha Bucha Day',
  '2026-06-01': 'Substitution for Visakha Bucha Day',
  '2026-06-03': "H.M. Queen Suthida's Birthday",
  '2026-07-28': "H.M. King Vajiralongkorn's Birthday",
  '2026-07-29': 'Asarnha Bucha Day',
  '2026-08-12': "H.M. Queen Sirikit's Birthday / Mother's Day",
  '2026-10-13': 'H.M. King Bhumibol Memorial Day',
  '2026-10-23': 'Chulalongkorn Memorial Day',
  '2026-12-07': "Substitution for H.M. King Bhumibol's Birthday",
  '2026-12-10': 'Constitution Day',
  '2026-12-31': "New Year's Eve",
};
function lookupHoliday(dateStr) {
  if (THAI_HOLIDAYS[dateStr]) return { isHoliday: true, name: THAI_HOLIDAYS[dateStr] };
  // Year not in the table → unknown rather than a false "not a holiday".
  if (!Object.keys(THAI_HOLIDAYS).some((d) => d.slice(0, 4) === dateStr.slice(0, 4))) return null;
  return { isHoliday: false };
}

// --- weather (Open-Meteo forecast w/ past_days) ---
const WMO = {
  0: '快晴', 1: '晴れ', 2: '晴れ時々曇り', 3: '曇り',
  45: '霧', 48: '霧', 51: '霧雨', 53: '霧雨', 55: '霧雨',
  61: '雨', 63: '雨', 65: '強い雨', 66: '雨', 67: '雨',
  71: '雪', 73: '雪', 75: '雪', 80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
  95: '雷雨', 96: '雷雨', 99: '激しい雷雨',
};
async function fetchWeather(dateStr, coords) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum`
    + `&timezone=Asia%2FBangkok&start_date=${dateStr}&end_date=${dateStr}`;
  const data = await fetchJson(url, 'openmeteo_weather');
  const daily = data && data.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.indexOf(dateStr) === -1) return null;
  const i = daily.time.indexOf(dateStr);
  const code = daily.weather_code ? daily.weather_code[i] : null;
  const tMax = daily.temperature_2m_max ? daily.temperature_2m_max[i] : null;
  // Out-of-range dates come back with null fields — treat as "no data" rather
  // than showing a misleading 0℃.
  if (code == null && (tMax == null)) return null;
  return {
    summary: code != null && WMO[code] ? WMO[code] : '—',
    tempMax: tMax != null ? Math.round(tMax) : null,
    tempMin: daily.temperature_2m_min && daily.temperature_2m_min[i] != null ? Math.round(daily.temperature_2m_min[i]) : null,
    precipMm: daily.precipitation_sum && daily.precipitation_sum[i] != null ? Math.round(daily.precipitation_sum[i] * 10) / 10 : null,
  };
}

// --- air quality PM2.5 (Open-Meteo) ---
function pm25Band(v) {
  if (v == null) return null;
  if (v <= 15) return '良好';
  if (v <= 35) return '普通';
  if (v <= 55) return 'やや悪い';
  return '悪い';
}
async function fetchAirQuality(dateStr, coords) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coords.lat}&longitude=${coords.lon}`
    + `&hourly=pm2_5&timezone=Asia%2FBangkok&start_date=${dateStr}&end_date=${dateStr}`;
  const data = await fetchJson(url, 'openmeteo_aqi');
  const hourly = data && data.hourly;
  if (!hourly || !Array.isArray(hourly.pm2_5)) return null;
  const vals = hourly.pm2_5.filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const pm25 = Math.round(mean);
  return { pm25, band: pm25Band(pm25) };
}

// --- disasters near Thailand (GDACS) ---
const GDACS_TYPE_JA = { EQ: '地震', TC: '熱帯低気圧', FL: '洪水', VO: '火山', DR: '干ばつ', WF: '森林火災', TS: '津波' };
async function fetchDisasters(dateStr) {
  const data = await fetchJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH', 'gdacs');
  const feats = data && Array.isArray(data.features) ? data.features : null;
  if (!feats) return null;
  const hits = [];
  for (const f of feats) {
    const p = (f && f.properties) || {};
    const countries = String(p.country || p.affectedcountries || '').toLowerCase();
    if (countries.indexOf('thailand') === -1) continue;
    const level = String(p.alertlevel || '').toLowerCase();
    if (level === 'green' || level === '') continue; // only orange/red matter for retail
    // Only events active on the business date — the feed returns months of
    // history, so without this filter a stale flood would be shown.
    const from = p.fromdate ? String(p.fromdate).slice(0, 10) : null;
    const to = p.todate ? String(p.todate).slice(0, 10) : from;
    if (from && (dateStr < from || (to && dateStr > to))) continue;
    if (!from && !p.iscurrent) continue;
    const type = p.eventtype || '';
    hits.push({ type, typeLabel: GDACS_TYPE_JA[type] || type, level: p.alertlevel || '', name: p.name || p.eventname || '' });
  }
  return hits;
}

/**
 * Fetch the full external context for a business date. Best-effort: any failed
 * source is null. Returns an object always (never throws).
 * @param {string} dateStr YYYY-MM-DD (Bangkok local date)
 * @param {{lat:number,lon:number}} [coords]
 */
async function fetchExternalContext(dateStr, coords) {
  const c = coords && coords.lat != null ? coords : BANGKOK;
  const calendar = computeCalendar(dateStr);
  const [weather, airQuality, disasters] = await Promise.all([
    fetchWeather(dateStr, c),
    fetchAirQuality(dateStr, c),
    fetchDisasters(dateStr),
  ]);
  return {
    date: dateStr,
    dow: calendar.dow,
    isWeekend: calendar.isWeekend,
    payday: calendar.payday,
    holiday: lookupHoliday(dateStr),
    weather,
    airQuality,
    disasters,
  };
}

module.exports = { fetchExternalContext };
