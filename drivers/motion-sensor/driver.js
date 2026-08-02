'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');
const DeviceModelRegistry = require('../../lib/DeviceModelRegistry');

class MotionSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('MotionSensorDriver has been initialized');
  }

  _matchesMotionDevice(device, type) {
    return DeviceModelRegistry.driverId(type || device) === 'motion-sensor';
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
