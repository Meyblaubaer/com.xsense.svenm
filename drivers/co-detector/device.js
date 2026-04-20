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
    if (this.hasCapability('measure_co') && this.getCapabilityValue('measure_co') === null) {
      this.setCapabilityValue('measure_co', 0).catch(this.error);
    }
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
        const coVal = Number(deviceData.coPpm || deviceData.coLevel || deviceData.coValue || deviceData.co || 0);
        const coDetected = coVal > 0;
        const prevCO = this.getCapabilityValue('alarm_co');
        await this.setCapabilityValue('alarm_co', coDetected);

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
        const coLevel = Number(deviceData.coPpm || deviceData.coLevel || deviceData.coValue || deviceData.co || 0);
        await this.setCapabilityValue('measure_co', coLevel);
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
