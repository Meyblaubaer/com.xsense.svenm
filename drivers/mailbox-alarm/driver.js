'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

class MailboxAlarmDriver extends Homey.Driver {
  async onInit() {
    this.log('MailboxAlarmDriver has been initialized');
  }

  _matchesMailboxDevice(_device, type) {
    return type.includes('SMA') || type.includes('MAIL');
  }

  async onPairListDevices(session) {
    return PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'mailbox alarms',
      matchDevice: (device, type) => this._matchesMailboxDevice(device, type),
    });
  }

  async onPair(session) {
    this.log('Pairing session started');
    await PairingHelper.registerPairHandlers({
      driver: this,
      session,
      listDevicesHandler: async () => this.onPairListDevices(session),
    });
  }
}

module.exports = MailboxAlarmDriver;
