'use strict';

const DeviceModelRegistry = require('./DeviceModelRegistry');

const SIGNAL_KEYS = new Set([
  'alarmStatus', 'alarmType', 'event', 'eventType', 'status', 'muteStatus', 'mute',
  'isOpen', 'isMoved', 'waterDetected', 'coAlarm', 'smokeAlarm', 'selfTest',
  'acBreak', 'baseRemove', 'online', 'onLine',
]);

class EventNormalizer {
  static normalize(payload, { devices, devicesBySn } = {}) {
    const root = payload?.state?.reported || payload?.reported || payload;
    if (!root || typeof root !== 'object') return [];

    const results = [];
    const seen = new Set();
    const findBySn = (sn) => {
      if (!sn) return null;
      const id = devicesBySn?.get(String(sn));
      return id ? devices?.get(id) : devices?.get(sn) || devices?.get(String(sn)) || null;
    };

    const visit = (value, key = '', context = {}) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, '', context));
        return;
      }

      const explicitSn = value.deviceSN || value.deviceSn || value.deviceSnId || value.deviceId || value.id || value.sn;
      const keyedDevice = findBySn(key);
      const explicitDevice = findBySn(explicitSn);
      const existing = explicitDevice || keyedDevice || context.existing || null;
      const deviceSn = explicitSn || existing?.deviceSn || existing?.deviceSN || (keyedDevice ? key : context.deviceSn);
      const type = DeviceModelRegistry.typeOf(value) || DeviceModelRegistry.typeOf(existing) || context.type;
      const nextContext = { existing, deviceSn, type };
      const hasSignal = Object.keys(value).some((candidate) => SIGNAL_KEYS.has(candidate));

      let emitted = false;
      if (hasSignal && existing) {
        const identity = `${existing.id || deviceSn}:${JSON.stringify(value)}`;
        if (!seen.has(identity)) {
          seen.add(identity);
          results.push(this._buildUpdate(value, existing, deviceSn, type));
          emitted = true;
        }
      }

      for (const [childKey, child] of Object.entries(value)) {
        if (emitted && childKey === 'status') continue;
        if (child && typeof child === 'object') visit(child, childKey, nextContext);
      }
    };

    visit(root);
    return results;
  }

  static _buildUpdate(data, existing, deviceSn, type) {
    const status = data.status && typeof data.status === 'object' ? data.status : {};
    const update = {
      ...existing,
      ...data,
      id: existing.id,
      deviceSn: deviceSn || existing.deviceSn,
      type: type || existing.type,
      deviceType: type || existing.deviceType,
      status: { ...(existing.status || {}), ...status },
    };

    update.normalizedEvent = this._eventType(update);
    update.sourceTimestamp = this._first(update, status, [
      'timestamp', 'ts', 'time', 'updateTime', 'updatedAt', 'lastSeen', 'last_seen',
    ]);
    return update;
  }

  static _eventType(data) {
    const status = data.status || {};
    const entityType = DeviceModelRegistry.entityType(data);
    const text = String(data.event || data.eventType || data.alarmType || '').toLowerCase();
    const alarmStatus = this._number(this._first(data, status, ['alarmStatus', 'a']));

    if (text.includes('test') || this._truthy(data.selfTest) || alarmStatus === 2) return 'self_test';
    if (text.includes('mute') || text.includes('silence')) return 'mute';
    if (text.includes('clear') || text.includes('restore') || text.includes('normal') || alarmStatus === 0) return 'alarm_clear';
    if (entityType === 'water' && (alarmStatus === 1 || this._truthy(data.waterDetected) || this._truthy(data.isOpen))) return 'water_alarm';
    if ((text.includes('carbon') || /(^|[^a-z])co([^a-z]|$)/.test(text) || this._truthy(data.coAlarm) || this._truthy(status.coAlarm) || this._truthy(status.co)) && alarmStatus !== 0) return 'co_alarm';
    if ((entityType === 'smoke' || entityType === 'listener') && (alarmStatus === 1 || text.includes('smoke') || text.includes('fire') || this._truthy(data.smokeAlarm))) return 'smoke_alarm';
    if (this._truthy(data.muteStatus) || this._truthy(data.mute)) return 'mute';
    return null;
  }

  static _first(data, status, keys) {
    for (const key of keys) {
      if (data[key] !== undefined && data[key] !== null) return data[key];
      if (status[key] !== undefined && status[key] !== null) return status[key];
    }
    return undefined;
  }

  static _truthy(value) {
    return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
  }

  static _number(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const result = Number(value);
    return Number.isFinite(result) ? result : undefined;
  }
}

module.exports = EventNormalizer;
