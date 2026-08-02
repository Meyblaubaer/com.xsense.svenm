'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class MailboxAlarmDevice extends XSenseDeviceBase {
  async onInit() {
    await super.onInit();

    this.log('MailboxAlarmDevice has been initialized');
    await this._startCloudUpdates().catch((error) => {
      this.error('Error initializing mailbox alarm:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed')).catch(this.error);
    });
  }

  /**
   * Handle device data update (Mailbox-Alarm specific implementation)
   * Overrides base class method to add mailbox alarm specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    // Mailbox alarm uses smoke detector capabilities (smoke_status, etc.)
    // No mailbox-specific overrides needed beyond base implementation
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
        .catch((error) => this.error('Failed to trigger smoke_test_detected for mailbox alarm:', error));

      return true;
    } catch (error) {
      this.error('Error testing alarm:', error);
      throw new Error(this.homey.__('error.test_alarm_failed'));
    }
  }
}

module.exports = MailboxAlarmDevice;
