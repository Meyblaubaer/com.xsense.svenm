'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

const DOOR_TYPES = ['SDS0A', 'SES01', 'XDS01', 'DOOR', 'WINDOW', 'CONTACT'];

class DoorSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('DoorSensorDriver has been initialized');
  }

  _matchesDoorDevice(_device, type) {
    return DOOR_TYPES.some((candidate) => type.includes(candidate));
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
