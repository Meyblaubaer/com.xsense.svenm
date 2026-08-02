'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class WaterSensorDevice extends XSenseDeviceBase {
  async onInit() {
    await super.onInit();

    this.log('WaterSensorDevice has been initialized');
    await this._startCloudUpdates().catch((error) => {
      this.error('Error initializing water sensor:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed')).catch(this.error);
    });
  }

  /**
   * Handle device data update (Water-Sensor specific implementation)
   * Overrides base class method to add water leak detection specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    try {
      // Update water leak alarm
      if (this.hasCapability('alarm_water')) {
        const status = deviceData.status || {};
        let waterDetected;
        if (deviceData.normalizedEvent === 'water_alarm') waterDetected = true;
        else if (deviceData.normalizedEvent === 'alarm_clear') waterDetected = false;
        else {
          const raw = this._getFirstValue(deviceData, ['waterDetected', 'isOpen', 'alarmStatus'], status);
          if (raw !== undefined) waterDetected = this._normalizeBool(raw);
        }
        if (waterDetected !== undefined) await this.setCapabilityValue('alarm_water', waterDetected);
      }

      // Update battery level
      if (this.hasCapability('measure_battery') && deviceData.batInfo !== undefined) {
        const batteryLevel = Math.round((deviceData.batInfo * 100) / 3);
        await this.setCapabilityValue('measure_battery', batteryLevel);

        // Update battery alarm
        if (this.hasCapability('alarm_battery')) {
          const lowBattery = batteryLevel < 20;
          const prevBattery = this.getCapabilityValue('alarm_battery');
          await this.setCapabilityValue('alarm_battery', lowBattery);
        }
      }
    } catch (error) {
      this.error('Error handling water-specific device update:', error);
    }
  }
}

module.exports = WaterSensorDevice;
