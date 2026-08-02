'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');
const DeviceModelRegistry = require('../../lib/DeviceModelRegistry');

class HeatDetectorDriver extends Homey.Driver {
  async onInit() {
    this.log('HeatDetectorDriver has been initialized');
  }

  _matchesHeatDevice(device, type) {
    return DeviceModelRegistry.driverId(type || device) === 'heat-sensor';
  }

  async onPairListDevices(session) {
    return PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'heat detectors',
      matchDevice: (device, type) => this._matchesHeatDevice(device, type),
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

module.exports = HeatDetectorDriver;
