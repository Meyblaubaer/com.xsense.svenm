'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');
const DeviceModelRegistry = require('../../lib/DeviceModelRegistry');

class DoorSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('DoorSensorDriver has been initialized');
  }

  _matchesDoorDevice(device, type) {
    return DeviceModelRegistry.driverId(type || device) === 'door-sensor';
  }

  async onPairListDevices(session) {
    return PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'door/window sensors',
      matchDevice: (device, type) => this._matchesDoorDevice(device, type),
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

module.exports = DoorSensorDriver;
