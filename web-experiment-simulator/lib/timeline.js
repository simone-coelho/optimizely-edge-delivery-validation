/**
 * Timestamp distribution — this is the part that drives date attribution.
 *
 * Optimizely's stats engine attributes every event to the calendar day of the
 * `timestamp` on the payload (Unix epoch MILLISECONDS), NOT the wall-clock time
 * the request arrives. So to place events on a given day we stamp them inside
 * that day.
 *
 * Hard rules the engine enforces (the tool guarantees all three):
 *   1. A conversion with a timestamp OLDER than its visitor's `campaign_activated`
 *      timestamp is silently dropped. Conversions are always placed strictly
 *      after activation.
 *   2. A timestamp in the future is rejected/clamped. We never place an event
 *      after "now"; the current day only fills up to the current moment.
 *   3. (Operational) An experiment can't have data before it went live. Set
 *      `dates.startTime` and no event is placed before it — events live only in
 *      [startTime, now] on the current day.
 */
'use strict';

const DAY_MS = 86400000;

// Default diurnal shape over local hours 0–23: quiet overnight, midday plateau,
// early-evening peak. Only shapes the intraday spread; per-day totals are
// unaffected.
const DEFAULT_HOURLY = [
  2, 1, 1, 1, 1, 2, 4, 7, 10, 12, 13, 13,
  12, 12, 13, 14, 15, 16, 17, 16, 13, 9, 6, 3,
];

function localDayStartUtcMs(dateStr, tzOffsetMin) {
  // Interpret 'YYYY-MM-DD' as a LOCAL date; return the UTC instant of local midnight.
  const utcMidnight = Date.parse(dateStr + 'T00:00:00Z');
  if (Number.isNaN(utcMidnight)) throw new Error('Invalid date in dates.days: ' + dateStr);
  return utcMidnight - tzOffsetMin * 60000;
}

// startTime may be a full ISO ("2026-06-08T13:00:00Z" / with offset) or a local
// "HH:MM" applied to the first day in dates.days.
function parseFloorMs(startTime, firstDayStartUtc) {
  if (!startTime) return null;
  if (/^\d{1,2}:\d{2}$/.test(String(startTime))) {
    const parts = String(startTime).split(':');
    return firstDayStartUtc + (Number(parts[0]) * 60 + Number(parts[1])) * 60000;
  }
  const t = Date.parse(startTime);
  if (Number.isNaN(t)) throw new Error('Invalid dates.startTime: ' + startTime);
  return t;
}

function pickIndexWeighted(weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return weights.length - 1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

function makeTimeline(dates, nowMs) {
  const tz = dates.timezoneOffsetMinutes || 0;
  const diurnal = dates.diurnal !== false;
  const hourly = (dates.hourlyWeights && dates.hourlyWeights.length === 24) ? dates.hourlyWeights : DEFAULT_HOURLY;
  const firstDayStartUtc = localDayStartUtcMs(dates.days[0], tz);
  const floorMs = parseFloorMs(dates.startTime, firstDayStartUtc);

  const days = dates.days.map(function (d, i) {
    const startUtc = localDayStartUtcMs(d, tz);
    if (startUtc > nowMs) throw new Error('Date ' + d + ' starts in the future; cannot attribute events to a future day.');
    const dayEndUtc = startUtc + DAY_MS;
    const winStart = (floorMs != null && floorMs > startUtc) ? floorMs : startUtc;
    const winEnd = Math.min(dayEndUtc, nowMs);
    const startInto = winStart - startUtc;
    const endInto = winEnd - startUtc;
    const usable = endInto > startInto + 1;
    const weight = (dates.weights && dates.weights[i] != null) ? dates.weights[i] : 1;
    return { date: d, startUtc: startUtc, startInto: startInto, endInto: endInto, usable: usable, weight: usable ? weight : 0 };
  });

  if (!days.some(function (d) { return d.usable; })) {
    throw new Error('No usable time window — every day is empty after applying dates.startTime / now. Check dates.startTime.');
  }

  return { tz: tz, diurnal: diurnal, hourly: hourly, days: days, dayWeights: days.map(function (d) { return d.weight; }) };
}

// Pick an activation timestamp: choose a usable day (weighted), then a time
// within that day's [startInto, endInto] window, following the diurnal curve.
function sampleActivation(tl, rng) {
  const day = tl.days[pickIndexWeighted(tl.dayWeights, rng)];
  let into;
  if (tl.diurnal) {
    const firstHour = Math.floor(day.startInto / 3600000);
    const lastHour = Math.floor((day.endInto - 1) / 3600000);
    const weights = [];
    for (let h = firstHour; h <= lastHour; h++) weights.push(tl.hourly[h] != null ? tl.hourly[h] : 1);
    const h = firstHour + pickIndexWeighted(weights, rng);
    const lo = Math.max(day.startInto, h * 3600000);
    const hi = Math.min(day.endInto, (h + 1) * 3600000);
    into = lo + rng() * Math.max(1, hi - lo);
  } else {
    into = day.startInto + rng() * Math.max(1, day.endInto - day.startInto);
  }
  // dayStartUtc is wall-clock-independent — anchoring the visitor id to it keeps
  // a seeded population reproducible.
  return { ts: Math.floor(day.startUtc + into), date: day.date, dayStartUtc: day.startUtc };
}

// Conversion timestamp: a short, realistic delay after activation, never in the
// future, always strictly after activation (rule #1 above).
function sampleConversion(activationTs, conv, rng, nowMs) {
  conv = conv || {};
  const minD = conv.delaySecondsMin != null ? conv.delaySecondsMin : 30;
  const maxD = conv.delaySecondsMax != null ? conv.delaySecondsMax : 1800;
  const delayMs = (minD + rng() * Math.max(0, maxD - minD)) * 1000;
  let ts = Math.floor(activationTs + Math.max(1000, delayMs));
  if (ts > nowMs) ts = nowMs;
  if (ts <= activationTs) ts = activationTs + 1;
  return ts;
}

module.exports = { makeTimeline, sampleActivation, sampleConversion, DEFAULT_HOURLY, DAY_MS };
