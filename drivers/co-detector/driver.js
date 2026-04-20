'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

const CO_TYPES = ['XC01-M', 'XC04-WX', 'XC0C-IR', 'XC0C-MR', 'XC01-WX', 'XC01WX'];

class CoDetectorDriver extends Homey.Driver {
  async onInit() {
    this.log('CoDetectorDriver has been initialized');
  }

  _matchesCoDevice(_device, type) {
    const normalized = String(type || '').replace(/\s+/g, '');
    if (CO_TYPES.some((candidate) => normalized.includes(candidate.replace(/\s+/g, '')))) {
      return true;
    }

    return normalized.startsWith('XC') && !normalized.includes('SC');
  }

  async onPairListDevices(session) {
    return PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'CO detectors',
      matchDevice: (device, type) => this._matchesCoDevice(device, type),
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

module.exports = CoDetectorDriver;
