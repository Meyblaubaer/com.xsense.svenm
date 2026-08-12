'use strict';

const { normalizeSourceTimestamp } = require('./SourceTimestamp');
const DeviceModelRegistry = require('./DeviceModelRegistry');

const ONLINE_TIME_EXCLUDED_TYPES = new Set([
  'SC07-IA',
  'XP0J-IA',
  'XP0S-IA',
  'XP0T-IA',
  'XP0V-IA',
  'XP0W-IA',
  'XS0AA-IA',
  'XS0AB-IA',
  'XS0R-IA',
  'STH0C',
]);
const EXTENDED_OFFLINE_TYPES = new Set(['SWS0B', 'XR0A-IR']);

function inferOnlineFromReportTime(deviceData, now = Date.now()) {
  const type = DeviceModelRegistry.typeOf(deviceData);
  if (ONLINE_TIME_EXCLUDED_TYPES.has(type)) return undefined;

  const status = deviceData?.status || {};
  const reportedIso = normalizeSourceTimestamp(deviceData?.onlineTime ?? status.onlineTime);
  if (!reportedIso) return undefined;

  const referenceIso = normalizeSourceTimestamp(deviceData?.utcTime ?? status.utcTime);
  const referenceTime = referenceIso ? Date.parse(referenceIso) : now;
  const reportedTime = Date.parse(reportedIso);
  const offlineHours = EXTENDED_OFFLINE_TYPES.has(type) ? 49 : 34;

  return referenceTime <= reportedTime + (offlineHours * 60 * 60 * 1000);
}

module.exports = {
  inferOnlineFromReportTime,
};
