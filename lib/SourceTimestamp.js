'use strict';

function parseCompactTimestamp(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, milliseconds = '0'] = match;
  const parts = [year, month, day, hour, minute, second, milliseconds].map(Number);
  const [y, mo, d, h, mi, s, ms] = parts;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));

  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    date.getUTCHours() !== h ||
    date.getUTCMinutes() !== mi ||
    date.getUTCSeconds() !== s ||
    date.getUTCMilliseconds() !== ms
  ) {
    return null;
  }

  return date.toISOString();
}

function normalizeSourceTimestamp(raw) {
  if (raw === undefined || raw === null || raw === '') return null;

  const value = typeof raw === 'string' ? raw.trim() : String(raw);
  if (!value) return null;

  // X-Sense also reports UTC timestamps as YYYYMMDDHHmmss[SSS].
  if (/^\d{14}(\d{3})?$/.test(value)) {
    return parseCompactTimestamp(value);
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeLatestSourceTimestamp(values) {
  let latest = null;
  let latestMillis = -Infinity;

  for (const value of values) {
    const normalized = normalizeSourceTimestamp(value);
    if (!normalized) continue;
    const millis = Date.parse(normalized);
    if (millis > latestMillis) {
      latest = normalized;
      latestMillis = millis;
    }
  }

  return latest;
}

module.exports = {
  normalizeLatestSourceTimestamp,
  normalizeSourceTimestamp,
};
