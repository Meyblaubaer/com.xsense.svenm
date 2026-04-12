'use strict';

const Homey = require('homey');

/**
 * Base class for all X-Sense devices with common functionality
 * - Device initialization
 * - API client setup
 * - Callback management (memory leak prevention)
 * - Debouncing for capability updates
 * - Common device update logic
 */
class XSenseDeviceBase extends Homey.Device {

  async onInit() {
    await super.onInit();

    // Debounce timers for capability updates
    this.updateDebounceTimers = new Map();
    this.pendingUpdates = new Map();
    this.updateCallback = null; // Callback reference for cleanup

    // Default debounce delays (ms)
    this.debounceDelays = {
      'measure_temperature': 1000,    // 1 second for temperature
      'measure_humidity': 1000,       // 1 second for humidity
      'measure_battery': 2000,        // 2 seconds for battery
      'measure_rssi': 2000,           // 2 seconds for WiFi signal
      'measure_last_seen': 500,       // 0.5 seconds for last seen
      'default': 500                  // 0.5 seconds for everything else
    };

    // Initialize common device properties
    this._initializeCommon();
  }

  /**
   * Initialize common device properties
   */
  _initializeCommon() {
    // Get device data
    this.deviceData = this.getData();
    this.settings = this.getSettings();

    // Normalize deviceSn early for shadow updates (some devices only store id)
    if (!this.deviceData.deviceSn && this.deviceData.id) {
      this.deviceData.deviceSn = this.deviceData.id;
    }

    // Get credentials from store (async for encryption support)
    const store = this.getStore();
    this.email = store.email;
    this.password = store.password;

    // Older paired devices had station/house IDs only in store, so copy them over
    if (!this.deviceData.stationId && store.stationId) {
      this.deviceData.stationId = store.stationId;
    }
    if (!this.deviceData.houseId && store.houseId) {
      this.deviceData.houseId = store.houseId;
    }
    if (!this.deviceData.deviceSn && store.deviceSn) {
      this.deviceData.deviceSn = store.deviceSn;
    }
  }

  /**
   * Setup API client
   */
  async _setupAPIClient() {
    try {
      this.api = await this.homey.app.getAPIClient(this.email, this.password);
    } catch (error) {
      this.error('Error setting up API client:', error);
      throw error;
    }
  }

  /**
   * Register update callback (FIXED: Prevents memory leaks)
   */
  _registerUpdateCallback() {
    if (!this.api) {
      this.error('API client not initialized');
      return;
    }

    this.updateCallback = (type, data) => {
      if (type === 'device') {
        const sameId = data.id === this.deviceData.id;
        const dataSn = data.deviceSn || data.deviceSN;
        const sameSn =
          dataSn &&
          (dataSn === this.deviceData.deviceSn || dataSn === this.deviceData.id);

        if (!sameId && !sameSn) {
          const deviceType = (this.deviceData.deviceType || this.deviceData.type || '').toUpperCase();
          const updateType = (data.deviceType || data.type || '').toUpperCase();
          const updateSn = dataSn || data.sn;
          const missingSn = !this.deviceData.deviceSn;

          if (
            missingSn &&
            deviceType.startsWith('STH') &&
            updateType.startsWith('STH') &&
            data.stationId &&
            this.deviceData.stationId &&
            data.stationId === this.deviceData.stationId
          ) {
            this.log('Fallback match by stationId for temp sensor update', {
              deviceId: this.deviceData?.id,
              stationId: this.deviceData?.stationId,
              updateSn,
              updateType
            });
            if (updateSn) {
              this.deviceData.deviceSn = updateSn;
              this.setStoreValue('deviceSn', updateSn).catch(this.error);
            }
          } else {
            this.log(`[UpdateCallback] Dropping update — no match. ThisDevice id=${this.deviceData.id} sn=${this.deviceData.deviceSn} type=${deviceType}. Received id=${data.id} sn=${dataSn} type=${updateType}`);
            return;
          }
        }
        if (!this._loggedUpdateMatch && this.deviceData?.deviceType?.startsWith('STH')) {
          this._loggedUpdateMatch = true;
          this.log('Matched temp update', {
            deviceId: this.deviceData?.id,
            deviceSn: this.deviceData?.deviceSn,
            updateId: data.id,
            updateSn: dataSn,
            updateType: data.type || data.deviceType
          });
        }
        this._handleDeviceUpdate(data);
      }
    };

    this.api.onUpdate(this.updateCallback);
  }

  /**
   * Update device from API (common implementation)
   */
  async updateDevice() {
    if (!this.api) {
      this.error('API client not initialized');
      return;
    }

    try {
      const devices = await this.api.getDevices(this.deviceData.stationId);

      // Match by ID preferred, fallback to SN
      const deviceData = devices.find(d =>
        d.id === this.deviceData.id ||
        d.deviceSn === this.deviceData.deviceSn
      );

      if (deviceData) {
        await this._handleDeviceUpdate(deviceData);
        // Only set available if we successfully updated
        if (!this.getAvailable()) {
          this.setAvailable();
        }
      } else {
        // Don't mark unavailable immediately to avoid flickering on partial API returns
        this.log('Device not found in API update, skipping update');
      }
    } catch (error) {
      this.error('Error updating device:', error);
      // this.setUnavailable(this.homey.__('error.update_failed')); // Optional: keep available but log error
    }
  }

  /**
   * Debounce capability updates to prevent UI flickering
   * @param {string} capabilityId - Capability to update
   * @param {*} value - New value
   * @param {number} delay - Optional delay override (ms)
   */
  _debounceCapabilityUpdate(capabilityId, value, delay = null) {
    // Get debounce delay
    const debounceDelay = delay || this.debounceDelays[capabilityId] || this.debounceDelays.default;

    // Store pending value
    this.pendingUpdates.set(capabilityId, value);

    // Clear existing timer
    if (this.updateDebounceTimers.has(capabilityId)) {
      clearTimeout(this.updateDebounceTimers.get(capabilityId));
    }

    // Set new timer
    const timer = setTimeout(async () => {
      const pendingValue = this.pendingUpdates.get(capabilityId);

      try {
        // Only update if value actually changed
        const currentValue = this.getCapabilityValue(capabilityId);
        if (currentValue !== pendingValue) {
          await this.setCapabilityValue(capabilityId, pendingValue);
          this.log(`[Debounced] Updated ${capabilityId} to ${pendingValue}`);
        }
      } catch (error) {
        this.error(`Failed to update ${capabilityId}:`, error);
      }

      // Cleanup
      this.updateDebounceTimers.delete(capabilityId);
      this.pendingUpdates.delete(capabilityId);
    }, debounceDelay);

    this.updateDebounceTimers.set(capabilityId, timer);
  }

  /**
   * Handle device data update (base implementation)
   * Override in subclasses for device-specific logic
   * @param {Object} deviceData - Device data from API
   */
  async _handleDeviceUpdate(deviceData) {
    if (!deviceData) {
      this.log('No device data provided for update');
      return;
    }

    try {
      const updateSn =
        deviceData.deviceSn ||
        deviceData.deviceSN ||
        deviceData.sn;
      if (updateSn && this.deviceData.deviceSn !== updateSn) {
        this.deviceData.deviceSn = updateSn;
        this.setStoreValue('deviceSn', updateSn).catch(this.error);
      }

      // Add optional capabilities if data is available
      await this._ensureOptionalCapabilities(deviceData);

      // Update common capabilities

      const batteryPercent = this._normalizeNumber(this._getFirstValue(deviceData, [
        'battery', 'batteryPercent', 'bat'
      ], deviceData.status));

      // Battery level (batInfo is 0-3 scale)
      if (this.hasCapability('measure_battery')) {
        if (deviceData.batInfo !== undefined) {
          const batteryLevel = Math.round((parseInt(deviceData.batInfo, 10) * 100) / 3);
          await this.setCapabilityValue('measure_battery', Math.min(100, Math.max(0, batteryLevel))).catch(e => this.error('Battery update failed:', e));
        } else if (batteryPercent !== undefined) {
          await this.setCapabilityValue('measure_battery', Math.min(100, Math.max(0, batteryPercent))).catch(e => this.error('Battery update failed:', e));
        }
      }

      // Battery alarm
      if (this.hasCapability('alarm_battery')) {
        let batteryLevel = null;
        if (deviceData.batInfo !== undefined) {
          batteryLevel = Math.round((parseInt(deviceData.batInfo, 10) * 100) / 3);
        } else if (batteryPercent !== undefined) {
          batteryLevel = batteryPercent;
        }
        if (batteryLevel !== null) {
          const lowBattery = batteryLevel < 20;
          await this.setCapabilityValue('alarm_battery', lowBattery).catch(e => this.error('Battery alarm update failed:', e));
        }
      }

      // Signal strength (rfLevel is 0-4 scale or direct dBm)
      if (this.hasCapability('measure_signal_strength')) {
        const signalVal = this._getFirstValue(deviceData, [
          'wifiRssi', 'wifiRSSI', 'signal', 'rssi', 'rfLevel', 'signalLevel'
        ], deviceData.status);
        const signalNum = this._normalizeNumber(signalVal);

        if (signalNum !== undefined) {
          let signalStrengthDbm = -100;

          if (signalNum < 0) {
            // Already in dBm
            signalStrengthDbm = signalNum;
          } else if (signalNum > 4) {
            // Likely RSSI as positive value (e.g. 65 => -65 dBm)
            signalStrengthDbm = -Math.abs(signalNum);
          } else {
            // Convert 0-4 scale to dBm
            const s = Math.round(signalNum);
            if (s >= 4) signalStrengthDbm = -55;
            else if (s === 3) signalStrengthDbm = -67;
            else if (s === 2) signalStrengthDbm = -79;
            else if (s === 1) signalStrengthDbm = -91;
            else if (s === 0) signalStrengthDbm = -100;
          }

          await this.setCapabilityValue('measure_signal_strength', signalStrengthDbm).catch(e => this.error('Signal strength update failed:', e));
        }
      }

      // Online status
      if (deviceData.online !== undefined) {
        const isOnline = deviceData.online === '1' || deviceData.online === 1 || deviceData.online === true;
        if (!isOnline && this.getAvailable()) {
          this.log('Device reported offline');
        }
      }

      // Update last seen timestamp
      if (this.hasCapability('measure_last_seen')) {
        await this.setCapabilityValue('measure_last_seen', new Date().toISOString()).catch(e => {});
      }

      // Update optional diagnostics / parity capabilities
      await this._updateOptionalCapabilities(deviceData);

      this.log('Base device update completed');
    } catch (error) {
      this.error('Error in base _handleDeviceUpdate:', error);
    }
  }

  /**
   * Wrapper for temp data sync request (used by TemperatureSensor)
   */
  async _requestTempDataSync() {
    if (!this.api) {
      this.error('API client not initialized');
      return;
    }

    try {
      // Station ID is needed, devices list is optional/all
      await this.api.requestTempDataSync(this.deviceData.stationId, [this.deviceData.deviceSn]);
    } catch (err) {
      this.error('Failed to request temp data sync:', err);
    }
  }

  /**
   * Update capability immediately (bypass debouncing)
   * Use for critical updates like alarms
   */
  async _immediateCapabilityUpdate(capabilityId, value) {
    // Cancel pending debounced update
    if (this.updateDebounceTimers.has(capabilityId)) {
      clearTimeout(this.updateDebounceTimers.get(capabilityId));
      this.updateDebounceTimers.delete(capabilityId);
      this.pendingUpdates.delete(capabilityId);
    }

    // Update immediately
    try {
      const currentValue = this.getCapabilityValue(capabilityId);
      if (currentValue !== value) {
        await this.setCapabilityValue(capabilityId, value);
        this.log(`[Immediate] Updated ${capabilityId} to ${value}`);
      }
    } catch (error) {
      this.error(`Failed to update ${capabilityId}:`, error);
    }
  }

  _getFirstValue(deviceData, keys, status = null) {
    for (const key of keys) {
      if (deviceData && deviceData[key] !== undefined && deviceData[key] !== null) {
        return deviceData[key];
      }
      if (status && status[key] !== undefined && status[key] !== null) {
        return status[key];
      }
    }
    return undefined;
  }

  _normalizeBool(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === '1' || v === 'true' || v === 'yes') return true;
      if (v === '0' || v === 'false' || v === 'no') return false;
    }
    return undefined;
  }

  _normalizeNumber(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }

  _getMQTTConnected() {
    const app = this.homey && this.homey.app;
    if (!app || !app.mqttHealthy) return undefined;
    const houseId = this.deviceData && this.deviceData.houseId;
    if (!houseId) return undefined;
    const value = app.mqttHealthy.get(houseId);
    if (value === undefined) return undefined;
    return !!value;
  }

  async _ensureOptionalCapabilities(deviceData) {
    const status = deviceData.status || {};
    const mqttConnected = this._getMQTTConnected();

    const candidates = [
      { cap: 'measure_wifi_rssi', value: this._getFirstValue(deviceData, ['wifiRssi', 'wifiRSSI'], status) },
      { cap: 'measure_rf_level', value: this._getFirstValue(deviceData, ['rfLevel'], status) },
      { cap: 'measure_wifi_ssid', value: this._getFirstValue(deviceData, ['wifiSsid', 'ssid', 'wifiSSID'], status) },
      { cap: 'measure_ip_address', value: this._getFirstValue(deviceData, ['ip', 'ipAddress'], status) },
      { cap: 'measure_sw_version', value: this._getFirstValue(deviceData, ['sw', 'swVersion', 'firmwareVersion'], status) },
      { cap: 'measure_wifi_sw', value: this._getFirstValue(deviceData, ['wifiSw', 'wifi_sw', 'wifiSW'], status) },
      { cap: 'measure_alarm_volume', value: this._getFirstValue(deviceData, ['alarmVol', 'alarm_volume'], status) },
      { cap: 'measure_voice_volume', value: this._getFirstValue(deviceData, ['voiceVol', 'voice_volume'], status) },
      { cap: 'alarm_life_end', value: this._getFirstValue(deviceData, ['isLifeEnd', 'lifeEnd'], status) },
      { cap: 'alarm_muted', value: this._getFirstValue(deviceData, ['muteStatus', 'mute'], status) },
      { cap: 'alarm_activate', value: this._getFirstValue(deviceData, ['activate'], status) },
      { cap: 'alarm_mqtt_connected', value: mqttConnected },
    ];

    for (const { cap, value } of candidates) {
      if (value !== undefined && !this.hasCapability(cap)) {
        try {
          await this.addCapability(cap);
        } catch (err) {
          this.error(`Failed to add capability ${cap}:`, err);
        }
      }
    }
  }

  async _updateOptionalCapabilities(deviceData) {
    const status = deviceData.status || {};

    const wifiRssi = this._normalizeNumber(this._getFirstValue(deviceData, ['wifiRssi', 'wifiRSSI'], status));
    if (wifiRssi !== undefined && this.hasCapability('measure_wifi_rssi')) {
      await this.setCapabilityValue('measure_wifi_rssi', wifiRssi).catch(e => this.error('WiFi RSSI update failed:', e));
    }

    const rfLevel = this._normalizeNumber(this._getFirstValue(deviceData, ['rfLevel'], status));
    if (rfLevel !== undefined && this.hasCapability('measure_rf_level')) {
      await this.setCapabilityValue('measure_rf_level', rfLevel).catch(e => this.error('RF level update failed:', e));
    }

    const wifiSsid = this._getFirstValue(deviceData, ['wifiSsid', 'ssid', 'wifiSSID'], status);
    if (wifiSsid !== undefined && this.hasCapability('measure_wifi_ssid')) {
      await this.setCapabilityValue('measure_wifi_ssid', String(wifiSsid)).catch(e => this.error('WiFi SSID update failed:', e));
    }

    const ipAddress = this._getFirstValue(deviceData, ['ip', 'ipAddress'], status);
    if (ipAddress !== undefined && this.hasCapability('measure_ip_address')) {
      await this.setCapabilityValue('measure_ip_address', String(ipAddress)).catch(e => this.error('IP address update failed:', e));
    }

    const swVersion = this._getFirstValue(deviceData, ['sw', 'swVersion', 'firmwareVersion'], status);
    if (swVersion !== undefined && this.hasCapability('measure_sw_version')) {
      await this.setCapabilityValue('measure_sw_version', String(swVersion)).catch(e => this.error('Firmware version update failed:', e));
    }

    const wifiSw = this._getFirstValue(deviceData, ['wifiSw', 'wifi_sw', 'wifiSW'], status);
    if (wifiSw !== undefined && this.hasCapability('measure_wifi_sw')) {
      await this.setCapabilityValue('measure_wifi_sw', String(wifiSw)).catch(e => this.error('WiFi firmware update failed:', e));
    }

    const alarmVol = this._normalizeNumber(this._getFirstValue(deviceData, ['alarmVol', 'alarm_volume'], status));
    if (alarmVol !== undefined && this.hasCapability('measure_alarm_volume')) {
      await this.setCapabilityValue('measure_alarm_volume', alarmVol).catch(e => this.error('Alarm volume update failed:', e));
    }

    const voiceVol = this._normalizeNumber(this._getFirstValue(deviceData, ['voiceVol', 'voice_volume'], status));
    if (voiceVol !== undefined && this.hasCapability('measure_voice_volume')) {
      await this.setCapabilityValue('measure_voice_volume', voiceVol).catch(e => this.error('Voice volume update failed:', e));
    }

    const lifeEnd = this._normalizeBool(this._getFirstValue(deviceData, ['isLifeEnd', 'lifeEnd'], status));
    if (lifeEnd !== undefined && this.hasCapability('alarm_life_end')) {
      await this.setCapabilityValue('alarm_life_end', lifeEnd).catch(e => this.error('Life end update failed:', e));
    }

    const muted = this._normalizeBool(this._getFirstValue(deviceData, ['muteStatus', 'mute'], status));
    if (muted !== undefined && this.hasCapability('alarm_muted')) {
      const prev = this.getCapabilityValue('alarm_muted');
      await this.setCapabilityValue('alarm_muted', muted).catch(e => this.error('Muted update failed:', e));
      if (muted && !prev) {
        try {
          await this.homey.flow.getDeviceTriggerCard('device_muted').trigger(this, {
            device: this.getName()
          });
        } catch (err) {
          this.error('Failed to trigger device_muted flow:', err);
        }
      }
    }

    const activate = this._normalizeBool(this._getFirstValue(deviceData, ['activate'], status));
    if (activate !== undefined && this.hasCapability('alarm_activate')) {
      await this.setCapabilityValue('alarm_activate', activate).catch(e => this.error('Activate update failed:', e));
    }

    const mqttConnected = this._getMQTTConnected();
    if (mqttConnected !== undefined && this.hasCapability('alarm_mqtt_connected')) {
      await this.setCapabilityValue('alarm_mqtt_connected', mqttConnected).catch(e => this.error('MQTT status update failed:', e));
    }
  }

  /**
   * Cleanup debounce timers and callbacks on device deletion
   */
  async onDeleted() {
    this.log('Device is being deleted, cleaning up...');

    // Clear all pending timers
    for (const timer of this.updateDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.updateDebounceTimers.clear();
    this.pendingUpdates.clear();

    // FIX: Remove callback from API to prevent memory leak
    if (this.updateCallback && this.api) {
      this.api.removeUpdateCallback(this.updateCallback);
      this.updateCallback = null;
    }

    // Clear polling interval
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.log('Device cleanup completed');
  }

  /**
   * onUninit is called when the device is uninitialized (e.g., app restart)
   */
  async onUninit() {
    // Reuse onDeleted cleanup logic
    await this.onDeleted();
  }
}

module.exports = XSenseDeviceBase;
