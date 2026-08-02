'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class HeatDetectorDevice extends XSenseDeviceBase {
  /**
   * onInit is called when device is initialized.
   */
  async onInit() {
    await super.onInit();

    this.log('HeatDetectorDevice has been initialized');

    // Initialize capabilities directly to ensure they appear in UI
    if (this.hasCapability('alarm_heat') && this.getCapabilityValue('alarm_heat') === null) {
      this.setCapabilityValue('alarm_heat', false).catch(this.error);
    }
    await this._startCloudUpdates().catch((error) => {
      this.error('Error initializing heat detector:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed')).catch(this.error);
    });
  }

  /**
   * Handle device data update (Heat-Sensor specific implementation)
   * Overrides base class method to add heat detection specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    // Heat detector uses the same base implementation (alarm_heat, temperature, battery)
    // No heat-specific overrides needed
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
        .catch((error) => this.error('Failed to trigger smoke_test_detected for heat detector:', error));

      return true;
    } catch (error) {
      this.error('Error testing alarm:', error);
      throw new Error(this.homey.__('error.test_alarm_failed'));
    }
  }
}

module.exports = HeatDetectorDevice;
