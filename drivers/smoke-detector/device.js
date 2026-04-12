'use strict';

const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class SmokeDetectorDevice extends XSenseDeviceBase {
  /**
   * onInit is called when device is initialized.
   */
  async onInit() {
    await super.onInit();

    this.log('SmokeDetectorDevice has been initialized');
    this._prevSmokeStatus = null;

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

    // Initialize capabilities to ensure fresh timestamps appear in Homey UI.
    // Always force-set so that Homey records the current time as last-updated,
    // preventing the "56 years ago" display when the capability was never touched.
    const capDefaults = {
      alarm_smoke: false,
      alarm_co: false,
      measure_smoke_status: 'OK',
    };
    for (const [cap, defaultVal] of Object.entries(capDefaults)) {
      if (this.hasCapability(cap)) {
        const current = this.getCapabilityValue(cap);
        // Only force-set if still null (first add); existing values are preserved to avoid overwriting real state
        if (current === null || current === undefined) {
          this.setCapabilityValue(cap, defaultVal).catch(this.error);
        }
      }
    }
    // Always refresh measure_last_seen so the "last seen" timestamp is current
    if (this.hasCapability('measure_last_seen')) {
      this.setCapabilityValue('measure_last_seen', new Date().toISOString()).catch(this.error);
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
      // Also check alarmStatus from real-time event messages (which use a flat structure
      // with alarmStatus instead of the shadow's status.a field). Without this check,
      // real smoke alarms received via the @xsense/events topic never trigger alarm_smoke.
      if (this.hasCapability('alarm_smoke')) {
        const smokeFromShadow = status.a === '1' || status.a === 1;
        // alarmStatus === 1 from an event means smoke (not CO — CO events also have coPpm > 0)
        const coPpm = Number(deviceData.coPpm || deviceData.coLevel || status.coPpm || 0);
        const smokeFromEvent = deviceData.alarmStatus === 1 && coPpm === 0;
        const smokeAlarm = smokeFromShadow || smokeFromEvent;
        await this.setCapabilityValue('alarm_smoke', smokeAlarm).catch(e => this.error('Smoke alarm update failed:', e));
      }

      // CO alarm (if device supports it)
      if (this.hasCapability('alarm_co')) {
        const coPpm = Number(deviceData.coPpm || deviceData.coLevel || status.coPpm || 0);
        // CO alarm from shadow path (status.co) or event path (coPpm > 0 or alarmStatus with CO)
        const coAlarm = status.co === '1' || status.co === 1 || status.coAlarm === true || coPpm > 0;
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
        } else if (deviceData.alarmStatus === 1) {
          // Event path: alarmStatus=1 but no shadow status.a yet
          statusText = 'ALARM';
        }
        await this.setCapabilityValue('measure_smoke_status', statusText).catch(e => this.error('Smoke status update failed:', e));

        // Fire smoke_test_detected trigger on transition INTO test mode
        if (statusText === 'TEST' && this._prevSmokeStatus !== 'TEST') {
          this.homey.flow.getDeviceTriggerCard('smoke_test_detected')
            .trigger(this, { device: this.getName() })
            .catch(e => this.error('Failed to trigger smoke_test_detected:', e));
        }
        this._prevSmokeStatus = statusText;
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
      await this.api.muteAlarm(this.deviceData.id, this.deviceData.deviceSn);
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
