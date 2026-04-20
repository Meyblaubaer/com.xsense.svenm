'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

const MOTION_TYPES = ['SMS0A', 'SMS01', 'XMS01', 'MOTION', 'PIR'];

class MotionSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('MotionSensorDriver has been initialized');
  }

  _matchesMotionDevice(_device, type) {
    return MOTION_TYPES.some((candidate) => type.includes(candidate));
  }

  async onPairListDevices(session) {
    return PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'motion sensors',
      matchDevice: (device, type) => this._matchesMotionDevice(device, type),
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

module.exports = MotionSensorDriver;
