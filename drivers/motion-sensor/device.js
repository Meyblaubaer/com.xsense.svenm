'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class MotionSensorDevice extends XSenseDeviceBase {
  async onInit() {
    await super.onInit();

    this.log('MotionSensorDevice has been initialized');

    // Initialize capabilities
    if (this.hasCapability('alarm_motion') && this.getCapabilityValue('alarm_motion') === null) {
      this.setCapabilityValue('alarm_motion', false).catch(this.error);
    }
    await this._startCloudUpdates().catch((error) => {
      this.error('Error initializing motion sensor:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed')).catch(this.error);
    });
  }

  /**
   * Handle device data update (Motion-Sensor specific implementation)
   * Overrides base class method to add motion detection specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    try {
      // Update motion alarm
      if (this.hasCapability('alarm_motion')) {
        const isMoved = this._getFirstValue(deviceData, ['isMoved'], deviceData.status);
        const motionDetected = this._normalizeBool(isMoved);
        if (motionDetected !== undefined) await this.setCapabilityValue('alarm_motion', motionDetected);
      }
    } catch (error) {
      this.error('Error handling motion-specific device update:', error);
    }
  }
}

module.exports = MotionSensorDevice;
