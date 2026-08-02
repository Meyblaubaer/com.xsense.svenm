'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class CoDetectorDevice extends XSenseDeviceBase {
  /**
   * onInit is called when device is initialized.
   */
  async onInit() {
    await super.onInit();

    this.log('CoDetectorDevice has been initialized');

    // Initialize capabilities directly to ensure they appear in UI
    if (this.hasCapability('alarm_co') && this.getCapabilityValue('alarm_co') === null) {
      this.setCapabilityValue('alarm_co', false).catch(this.error);
    }
    // Keep unknown CO measurements unset instead of reporting a false 0 ppm.
    await this._startCloudUpdates().catch((error) => {
      this.error('Error initializing CO detector:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed')).catch(this.error);
    });
  }

  /**
   * Handle device data update (CO-specific implementation)
   * Overrides base class method to add CO-specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    try {
      // Update CO alarm
      if (this.hasCapability('alarm_co')) {
        const status = deviceData.status || {};
        let coDetected;
        if (deviceData.normalizedEvent === 'co_alarm') coDetected = true;
        else if (deviceData.normalizedEvent === 'alarm_clear') coDetected = false;
        else if (deviceData.coAlarm !== undefined) coDetected = this._normalizeBool(deviceData.coAlarm);
        else if (status.coAlarm !== undefined) coDetected = this._normalizeBool(status.coAlarm);

        const prevCO = this.getCapabilityValue('alarm_co');
        if (coDetected !== undefined) await this.setCapabilityValue('alarm_co', coDetected);

        // Trigger flow if CO was just detected
        if (coDetected && !prevCO) {
          await this.homey.flow.getDeviceTriggerCard('co_detected')
            .trigger(this, {
              device: this.getName(),
              co_level: coVal
            });
        }
      }

      // Update CO level (ppm)
      if (this.hasCapability('measure_co')) {
        const coLevel = this._normalizeNumber(this._getFirstValue(deviceData, ['coPpm', 'coLevel', 'coValue', 'co'], deviceData.status));
        if (coLevel !== undefined) await this.setCapabilityValue('measure_co', coLevel);
      }
    } catch (error) {
      this.error('Error handling CO-specific device update:', error);
    }
  }

  /**
   * Test alarm
   */
  async testAlarm() {
    try {
      await this.api.testAlarm(this.deviceData.id);

      await this.homey.flow.getDeviceTriggerCard('smoke_test_detected')
        .trigger(this, {
          device: this.getName(),
        })
        .catch((error) => this.error('Failed to trigger smoke_test_detected for CO detector:', error));

      return true;
    } catch (error) {
      this.error('Error testing alarm:', error);
      throw new Error(this.homey.__('error.test_alarm_failed'));
    }
  }
}

module.exports = CoDetectorDevice;
