'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

class HeatDetectorDriver extends Homey.Driver {
  async onInit() {
    this.log('HeatDetectorDriver has been initialized');
  }

  _matchesHeatDevice(_device, type) {
    return type.includes('XH') || type.includes('HEAT');
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
