'use strict';

const Homey = require('homey');

class TemperatureSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('TemperatureSensorDriver has been initialized');
  }

  async onPairListDevices(session) {
    const devices = [];

    try {
      if (!session) {
        session = this.homey.app.currentPairSession;
      }

      if (!session || !session.credentials) {
        throw new Error('No credentials provided');
      }

      const { username, password } = session.credentials;
      const api = await this.homey.app.getAPIClient(username, password);
      const data = await api.getAllDevices();

      // Log all devices for debugging
      this.log('All devices from API:', data.devices.map(d => ({
        name: d.deviceName || d.name,
        type: d.type,
        deviceType: d.deviceType,
        id: d.id
      })));

      // Filter for temperature/humidity sensors (STH51, STH0A, STH54)
      for (const device of data.devices) {
        const deviceType = (device.type || device.deviceType || '').toUpperCase();

        if (deviceType.includes('STH') || deviceType.includes('TEMP') || deviceType.includes('HYGROMETER')) {
          // FIXED: Use the name from API directly (which includes our "Type SN" fix from XSenseAPI)
          let name = device.name || device.deviceName || `XSense ${deviceType}`;

          devices.push({
            name: name,
            data: {
              id: device.id,
              deviceSn: device.deviceSn || device.deviceSN || device.sn,
              stationId: device.stationId,
              houseId: device.houseId
            },
            store: {
              email: username,
              password: password,
              deviceSn: device.deviceSn || device.deviceSN || device.sn,
              stationId: device.stationId,
              houseId: device.houseId,
              deviceType: deviceType
            },
            settings: {
              device_id: device.id,
              device_type: deviceType,
              wifi_ssid: device.wifiSsid || 'N/A'
            }
          });
        } else {
          this.log(`Skipping device ${device.deviceName || device.name} (Type: ${deviceType}) - Not a temperature sensor`);
        }
      }

      return devices;
    } catch (error) {
      this.error('Error listing devices:', error);
      throw new Error(this.homey.__('pair.error.list_failed'));
    }
  }

  async onPair(session) {
    this.log('Pairing session started');
    // Keep this as fallback for now, but rely on passed session
    this.homey.app.currentPairSession = session;

    // Check for stored credentials (FIXED: Async for encryption)
    const stored = await this.homey.app.getStoredCredentials();
    if (stored.email && stored.password) {
      this.log('Found stored credentials, attempting auto-login');
      try {
        await this.homey.app.getAPIClient(stored.email, stored.password);
        session.credentials = { username: stored.email, password: stored.password };
        await session.showView('list_devices');
      } catch (error) {
        this.log('Auto-login failed with stored credentials');
      }
    }

    session.setHandler('login', async (data) => {
      try {
        const { username, password } = data;
        const api = await this.homey.app.getAPIClient(username, password);
        session.credentials = { username, password };

        // Save for future
        this.homey.app.setStoredCredentials(username, password);

        return true;
      } catch (error) {
        this.error('Login failed:', error);
        throw new Error(this.homey.__('pair.error.login_failed'));
      }
    });

    session.setHandler('list_devices', async () => {
      return await this.onPairListDevices(session);
    });
  }
}

module.exports = TemperatureSensorDriver;
