'use strict';

const BASE_STATION_PREFIXES = ['SBS'];

class DeviceModelRegistry {
  static normalizeType(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/_/g, '-');
  }

  static typeOf(device) {
    return this.normalizeType(
      device?.deviceType ||
      device?.type ||
      device?.category ||
      device?.stationType
    );
  }

  static entityType(value) {
    const type = typeof value === 'object' ? this.typeOf(value) : this.normalizeType(value);
    if (!type || BASE_STATION_PREFIXES.some((prefix) => type.startsWith(prefix))) return null;
    if (/^(SWS|XWS)/.test(type) || /(WATER|LEAK|FLOOD)/.test(type)) return 'water';
    if (/^STH/.test(type) || /(TEMP|HYGROMETER)/.test(type)) return 'climate';
    if (/^(SDS|SES|XDS)/.test(type) || /(DOOR|WINDOW|CONTACT)/.test(type)) return 'contact';
    if (/^(SMS|XMS)/.test(type) || /(MOTION|PIR)/.test(type)) return 'motion';
    if (/^SMA/.test(type) || type.includes('MAIL')) return 'mailbox';
    if (type.startsWith('SAL51')) return 'listener';
    if (/^XH/.test(type) || type.includes('HEAT')) return 'heat';
    if (/^XC/.test(type) && !type.startsWith('XCOM')) return 'co';
    if (/^(XS|SC|XP|SD|XCOM)/.test(type) || type.includes('SMOKE')) return 'smoke';
    return null;
  }

  static driverId(value) {
    const entityType = this.entityType(value);
    return {
      water: 'water-sensor',
      climate: 'temperature-sensor',
      contact: 'door-sensor',
      motion: 'motion-sensor',
      mailbox: 'mailbox-alarm',
      listener: 'smoke-detector',
      heat: 'heat-sensor',
      co: 'co-detector',
      smoke: 'smoke-detector',
    }[entityType] || null;
  }

  static isDirectStationDevice(station) {
    return !!this.driverId(station);
  }

  static isCombo(value) {
    const type = typeof value === 'object' ? this.typeOf(value) : this.normalizeType(value);
    return /^(SC|XP|XCOM|SAL51)/.test(type);
  }

  static supportsRemoteTest(value) {
    const type = typeof value === 'object' ? this.typeOf(value) : this.normalizeType(value);
    if (!type) return false;
    if (type.endsWith('-WX') || type.endsWith('-IWX') || type === 'XS0B-IR' || type === 'SC06-WX') return false;
    return /(-MR|-MN|^SD19-MN$|^XS0F-PMA$)/.test(type);
  }

  static capabilities(value) {
    const entityType = this.entityType(value);
    const common = ['alarm_battery', 'measure_battery', 'measure_last_seen', 'measure_signal_strength'];
    if (entityType === 'water') return ['alarm_water', ...common];
    if (entityType === 'climate') return ['measure_temperature', 'measure_humidity', ...common];
    if (entityType === 'contact') return ['alarm_contact', ...common];
    if (entityType === 'motion') return ['alarm_motion', ...common];
    if (entityType === 'mailbox') return ['alarm_contact', ...common];
    if (entityType === 'heat') return ['alarm_heat', 'measure_temperature', ...common];
    if (entityType === 'co') return ['alarm_co', 'measure_co', ...common];
    if (entityType === 'smoke' || entityType === 'listener') {
      const result = ['alarm_smoke', 'measure_smoke_status', ...common];
      if (this.isCombo(value) || entityType === 'listener') result.splice(2, 0, 'alarm_co', 'measure_co');
      if (this.normalizeType(typeof value === 'object' ? this.typeOf(value) : value) === 'XS0F-PMA') {
        result.push('alarm_ac_break', 'alarm_base_removed');
      }
      return result;
    }
    return null;
  }
}

module.exports = DeviceModelRegistry;
