'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

const SMOKE_TYPES = [
  'XS01-M', 'XS01-WX', 'XS03-IWX', 'XS03-WX', 'XS0B-MR', 'XS0B-IR', 'XS0D-MR',
  'SC06-WX', 'SC07-WX', 'SC07-MR',
  'XP02S-MR', 'XP0A-MR', 'XP0A-IR', 'XP0A',
  'SD11-MR'
];

class SmokeDetectorDriver extends Homey.Driver {
  async onInit() {
    this.log('SmokeDetectorDriver has been initialized');
  }

  _matchesSmokeDevice(_device, type) {
    const normalized = String(type || '').replace(/\s+/g, '');
    return SMOKE_TYPES.some((candidate) => normalized.includes(candidate.replace(/\s+/g, '')));
  }

  async onPairListDevices(session) {
    return PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'smoke/co combo detectors',
      matchDevice: (device, type) => this._matchesSmokeDevice(device, type),
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

module.exports = SmokeDetectorDriver;
