'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');
const DeviceModelRegistry = require('../../lib/DeviceModelRegistry');

class WaterSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('WaterSensorDriver has been initialized');
  }

  _matchesWaterDevice(device, type) {
    return DeviceModelRegistry.driverId(type || device) === 'water-sensor';
  }

  async onPairListDevices(session) {
    return PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'water leak detectors',
      matchDevice: (device, type) => this._matchesWaterDevice(device, type),
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

module.exports = WaterSensorDriver;
