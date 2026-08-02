'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');
const DeviceModelRegistry = require('../../lib/DeviceModelRegistry');

class CoDetectorDriver extends Homey.Driver {
  async onInit() {
    this.log('CoDetectorDriver has been initialized');
  }

  _matchesCoDevice(device, type) {
    return DeviceModelRegistry.driverId(type || device) === 'co-detector';
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
