'use strict';

const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class SmokeDetectorDevice extends XSenseDeviceBase {
  /**
   * onInit is called when device is initialized.
   */
  async onInit() {
    await super.onInit();

    this.log('SmokeDetectorDevice has been initialized');

    // Force add Capability if missing (for existing devices)
    if (!this.hasCapability('measure_signal_strength')) {
      await this.addCapability('measure_signal_strength').catch(this.error);
    }

    // Setup API client (uses base class _initializeCommon())
    await this._setupAPIClient();

    // Register update callback (uses base class _registerUpdateCallback())
    this._registerUpdateCallback();

    // Connect MQTT for real-time updates
    try {
      await this.api.connectMQTT(this.deviceData.houseId, this.deviceData.stationId);

      // Phase 1: Startup Synchronization (Blocking)
      // fetch latest state from Cloud API/Shadow immediately
      this.log('Performing startup synchronization...');
      try {
        const syncedData = await this.api.syncDevice(this.deviceData.id);
        if (syncedData) {
          await this._handleDeviceUpdate(syncedData);
        } else {
          await this.updateDevice();
        }
      } catch (e) {
        this.error('Sync failed, falling back to updateDevice', e);
        await this.updateDevice();
      }

      // Setup polling
      this.pollInterval = setInterval(() => {
        this.updateDevice();
      }, 60000); // Poll every minute

    } catch (error) {
      this.error('Error initializing device:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed'));
    }

    // Register capability listeners
    this._registerCapabilityListeners();

    // Initialize capabilities directly to ensure they appear in UI
    if (this.hasCapability('alarm_smoke') && this.getCapabilityValue('alarm_smoke') === null) {
      this.setCapabilityValue('alarm_smoke', false).catch(this.error);
    }
    if (this.hasCapability('alarm_co') && this.getCapabilityValue('alarm_co') === null) {
      this.setCapabilityValue('alarm_co', false).catch(this.error);
    }
    if (this.hasCapability('measure_smoke_status') && this.getCapabilityValue('measure_smoke_status') === null) {
      this.setCapabilityValue('measure_smoke_status', 'OK').catch(this.error);
    }
    if (this.hasCapability('measure_signal_strength') && this.getCapabilityValue('measure_signal_strength') === null) {
      // Default to something reasonable or leave null until update
      // this.setCapabilityValue('measure_signal_strength', -60).catch(this.error);
    }

    // Register Mute Action
    this.homey.flow.getActionCard('mute_alarm')
      .registerRunListener(async (args, state) => {
        return args.device.muteAlarm();
      });
  }

  /**
   * Handle device data update (Smoke Detector specific implementation)
   * Overrides base class method to add smoke/CO alarm logic
   * @param {Object} deviceData - Device data from API
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first for common capabilities
    await super._handleDeviceUpdate(deviceData);

    try {
      // Parse status if available
      const status = deviceData.status || {};

      // Smoke alarm (status.a = alarm state: 0=OK, 1=Alarm)
      if (this.hasCapability('alarm_smoke')) {
        const smokeAlarm = status.a === '1' || status.a === 1;
        await this.setCapabilityValue('alarm_smoke', smokeAlarm).catch(e => this.error('Smoke alarm update failed:', e));
      }

      // CO alarm (if device supports it)
      if (this.hasCapability('alarm_co')) {
        // CO alarm might be in a different status field depending on device type
        const coAlarm = status.co === '1' || status.co === 1 || status.coAlarm === true;
        await this.setCapabilityValue('alarm_co', coAlarm).catch(e => this.error('CO alarm update failed:', e));
      }

      // CO value (measure_co)
      if (this.hasCapability('measure_co')) {
        const coVal = Number(deviceData.coPpm || deviceData.coLevel || status.coPpm || 0);
        await this.setCapabilityValue('measure_co', coVal).catch(e => this.error('CO value update failed:', e));
      }

      // Smoke status text
      if (this.hasCapability('measure_smoke_status')) {
        let statusText = 'OK';
        if (status.a === '1' || status.a === 1) {
          statusText = 'ALARM';
        } else if (status.a === '2' || status.a === 2) {
          statusText = 'TEST';
        } else if (status.a === '3' || status.a === 3) {
          statusText = 'MUTED';
        }
        await this.setCapabilityValue('measure_smoke_status', statusText).catch(e => this.error('Smoke status update failed:', e));
      }

      // Temperature (some smoke detectors have temperature sensors)
      if (this.hasCapability('measure_temperature') && status.b !== undefined) {
        const temp = parseFloat(status.b);
        if (!isNaN(temp)) {
          await this.setCapabilityValue('measure_temperature', temp).catch(e => this.error('Temperature update failed:', e));
        }
      }

      this.log('Smoke detector device update completed');
    } catch (error) {
      this.error('Error handling smoke detector device update:', error);
    }
  }

  /**
   * Mute the alarm
   */
  async muteAlarm() {
    if (!this.api) {
      throw new Error('API client not initialized');
    }

    try {
      await this.api.muteAlarm(this.deviceData.stationId, this.deviceData.deviceSn);
      this.log('Alarm muted successfully');
      return true;
    } catch (error) {
      this.error('Failed to mute alarm:', error);
      throw error;
    }
  }

  /**
   * Test the alarm (triggers a test beep)
   */
  async testAlarm() {
    if (!this.api) {
      throw new Error('API client not initialized');
    }

    try {
      await this.api.testAlarm(this.deviceData.id);
      this.log('Test alarm triggered successfully');
      return true;
    } catch (error) {
      this.error('Failed to trigger test alarm:', error);
      throw error;
    }
  }

  /**
   * Register capability listeners
   */
  _registerCapabilityListeners() {
    // Currently no controllable capabilities
    // Smoke detectors are mainly monitoring devices
  }
}

module.exports = SmokeDetectorDevice;
