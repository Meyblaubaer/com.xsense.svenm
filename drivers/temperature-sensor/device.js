'use strict';

const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class TemperatureSensorDevice extends XSenseDeviceBase {
  async onInit() {
    await super.onInit();

    this.log('TemperatureSensorDevice has been initialized');
    this.log('Temp device identifiers:', {
      id: this.deviceData?.id,
      deviceSn: this.deviceData?.deviceSn,
      stationId: this.deviceData?.stationId,
      houseId: this.deviceData?.houseId,
      deviceType: this.deviceData?.deviceType,
    });

    // Force add Capability if missing (for existing devices)
    if (!this.hasCapability('measure_signal_strength')) {
      await this.addCapability('measure_signal_strength').catch(this.error);
    }
    if (!this.hasCapability('measure_temperature')) {
      await this.addCapability('measure_temperature').catch(this.error);
    }
    if (!this.hasCapability('measure_humidity')) {
      await this.addCapability('measure_humidity').catch(this.error);
    }

    // Previous values for change detection
    this.previousTemp = null;
    this.previousHumidity = null;

    // Setup API client (uses base class _initializeCommon())
    await this._setupAPIClient();

    // Register update callback (uses base class _registerUpdateCallback())
    this._registerUpdateCallback();

    try {
      // Connect MQTT for real-time updates (important for STH51/STH0A)
      await this.api.connectMQTT(this.deviceData.houseId, this.deviceData.stationId);

      // Initial Sync Request (only once, not duplicated)
      await this._requestTempDataSync();

      // Poll every 5 minutes (MQTT provides real-time updates too)
      this.pollInterval = setInterval(async () => {
        await this._requestTempDataSync();
      }, 300000); // 5 minutes (as per Android App)

    } catch (error) {
      this.error('Error initializing device:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed'));
    }
  }

  /**
   * onAdded is called when user adds device.
   */

  /**
   * Handle device data update (Temperature-Sensor specific implementation)
   * Overrides base class method to add temperature/humidity change detection logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    try {
      const status = deviceData.status || {};

      // Update temperature (support shadow status fields)
      if (this.hasCapability('measure_temperature')) {
        const temp =
          deviceData.temperature ??
          deviceData.temp ??
          status.b ??
          status.temperature ??
          status.temp;

        if (temp !== undefined && temp !== null) {
          const parsed = parseFloat(temp);
          if (!Number.isNaN(parsed)) {
            await this.setCapabilityValue('measure_temperature', parsed).catch(this.error);
            this.log(`Temperature updated: ${parsed}°C`);
          }
          
          // Trigger flow if temperature changed significantly (more than 1°C)
          if (this.previousTemp !== null && Math.abs(temp - this.previousTemp) > 1) {
            // Flow trigger removed
          }

          this.previousTemp = temp;
        }
      }

      // Update humidity (support shadow status fields)
      if (this.hasCapability('measure_humidity')) {
        const humidity =
          deviceData.humidity ??
          deviceData.humi ??
          status.c ??
          status.humidity ??
          status.humi;

        if (humidity !== undefined && humidity !== null) {
          const parsed = parseFloat(humidity);
          if (!Number.isNaN(parsed)) {
            await this.setCapabilityValue('measure_humidity', parsed).catch(this.error);
            this.log(`Humidity updated: ${parsed}%`);
          }
          
          // Track previous humidity for change detection
          if (this.previousHumidity !== null && Math.abs(humidity - this.previousHumidity) > 5) {
            // Significant change detected (>5%)
            this.log(`Humidity changed significantly: ${this.previousHumidity} -> ${humidity}`);
          }
          this.previousHumidity = humidity;
        }
      }

      // Update WiFi SSID if changed
      if (deviceData.wifiSsid && deviceData.wifiSsid !== this.settings.wifi_ssid) {
        await this.setSettings({
          wifi_ssid: deviceData.wifiSsid
        });
      }

      // Note: Battery and Signal Strength are handled by base class _handleDeviceUpdate()
    } catch (error) {
      this.error('Error handling temperature-specific device update:', error);
    }
  }

    /**
     * Wrapper for API call (base implementation)
     * Note: Overrides base class method because TemperatureSensor has special sync requirements
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
     * Update device from API
     * Uses base class implementation, Temperature-specific logic in _handleDeviceUpdate
     */
    async updateDevice() {
      await super.updateDevice();
    }

  /**
   * onAdded is called when the user adds the device.
   */
  async onAdded() {
    this.log('TemperatureSensorDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('TemperatureSensorDevice settings were changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   */
  async onRenamed(name) {
    this.log('TemperatureSensorDevice was renamed');
  }
}

module.exports = TemperatureSensorDevice;
