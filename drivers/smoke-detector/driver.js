'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');
const DeviceModelRegistry = require('../../lib/DeviceModelRegistry');

class SmokeDetectorDriver extends Homey.Driver {
  async onInit() {
    this.log('SmokeDetectorDriver has been initialized');
  }

  _matchesSmokeDevice(device, type) {
    return DeviceModelRegistry.driverId(type || device) === 'smoke-detector';
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
