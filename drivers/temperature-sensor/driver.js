'use strict';

const Homey = require('homey');
const PairingHelper = require('../../lib/PairingHelper');

class TemperatureSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('TemperatureSensorDriver has been initialized');
  }

  _matchesTemperatureDevice(_device, type) {
    return type.includes('STH') || type.includes('TEMP') || type.includes('HYGROMETER');
  }

  async onPairListDevices(session) {
    const devices = await PairingHelper.listDevicesForPairing({
      driver: this,
      session,
      matchLabel: 'temperature/humidity sensors',
      matchDevice: (device, type) => this._matchesTemperatureDevice(device, type),
    });

    return devices.map((entry) => ({
      ...entry,
      settings: {
        ...entry.settings,
        wifi_ssid: 'N/A',
      },
    }));
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

module.exports = TemperatureSensorDriver;
