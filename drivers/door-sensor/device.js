'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class DoorSensorDevice extends XSenseDeviceBase {
  async onInit() {
    await super.onInit();

    this.log('DoorSensorDevice has been initialized');

    // Initialize capabilities
    if (this.hasCapability('alarm_contact') && this.getCapabilityValue('alarm_contact') === null) {
      this.setCapabilityValue('alarm_contact', false).catch(this.error);
    }
    await this._startCloudUpdates().catch((error) => {
      this.error('Error initializing door sensor:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed')).catch(this.error);
    });
  }

  /**
   * Handle device data update (Door-Sensor specific implementation)
   * Overrides base class method to add door/window specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    try {
      // Update contact alarm (door/window open/closed)
      if (this.hasCapability('alarm_contact')) {
        const isOpen = this._getFirstValue(deviceData, ['isOpen'], deviceData.status);
        const contactOpen = this._normalizeBool(isOpen);
        if (contactOpen !== undefined) await this.setCapabilityValue('alarm_contact', contactOpen);
      }
    } catch (error) {
      this.error('Error handling door-specific device update:', error);
    }
  }
}

module.exports = DoorSensorDevice;
