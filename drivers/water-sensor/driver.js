'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

class WaterSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('WaterSensorDriver has been initialized');
  }

  _matchesWaterDevice(_device, type) {
    return (
      type.includes('SWS') ||
      type.includes('XWS') ||
      type.includes('WATER') ||
      type.includes('LEAK') ||
      type.includes('FLOOD')
    );
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
