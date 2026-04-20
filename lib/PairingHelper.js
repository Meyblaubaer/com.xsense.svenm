'use strict';

class PairingHelper {
  static _normalizeType(device) {
    return String(device?.deviceType || device?.type || '').trim().toUpperCase();
  }

  static _defaultName(device, type) {
    return device?.name || device?.deviceName || `XSense ${type || 'Device'}`;
  }

  static _buildEntry({ username, password, device, type }) {
    return {
      name: PairingHelper._defaultName(device, type),
      data: {
        id: device.id,
        deviceSn: device.deviceSn || device.deviceSN || device.sn,
        stationId: device.stationId,
        houseId: device.houseId,
      },
      store: {
        email: username,
        password: password,
        deviceSn: device.deviceSn || device.deviceSN || device.sn,
        stationId: device.stationId,
        houseId: device.houseId,
        deviceType: type,
      },
      settings: {
        device_id: device.id,
        device_type: type,
      },
    };
  }

  static async listDevicesForPairing({ driver, session, matchDevice, matchLabel }) {
    if (!session || !session.credentials) {
      throw new Error(driver.homey.__('pair.error.not_logged_in'));
    }

    const { username, password } = session.credentials;
    const api = await driver.homey.app.getAPIClient(username, password);
    const data = await api.getAllDevices();

    if (!data || !Array.isArray(data.devices)) {
      driver.error('Pairing failed: getAllDevices returned unexpected result', data);
      throw new Error(driver.homey.__('pair.error.list_failed'));
    }

    let total = 0;
    let matched = 0;
    const rejected = [];
    const devices = [];

    for (const device of data.devices) {
      if (!device || !device.id) {
        continue;
      }

      total += 1;
      const type = PairingHelper._normalizeType(device);
      const isMatch = !!matchDevice(device, type);

      if (!isMatch) {
        rejected.push({ id: device.id, type, name: device.deviceName || device.name || 'Unknown' });
        continue;
      }

      matched += 1;
      devices.push(PairingHelper._buildEntry({ username, password, device, type }));
    }

    driver.log(`[Pairing] ${driver.id}: total=${total}, matched=${matched}, rejected=${total - matched}, filter=${matchLabel}`);

    if (matched === 0) {
      driver.log(`[Pairing] ${driver.id}: no matching devices. Rejected sample: ${JSON.stringify(rejected.slice(0, 10))}`);
      throw new Error(driver.homey.__('pair.error.no_supported_devices', {
        deviceType: matchLabel,
      }));
    }

    return devices;
  }

  static async registerPairHandlers({ driver, session, listDevicesHandler }) {
    driver.homey.app.currentPairSession = session;

    const stored = await driver.homey.app.getStoredCredentials();
    if (stored.email && stored.password) {
      try {
        await driver.homey.app.getAPIClient(stored.email, stored.password);
        session.credentials = { username: stored.email, password: stored.password };
        await session.showView('list_devices');
      } catch (error) {
        driver.log('Auto-login with stored credentials failed:', error.message || error);
      }
    }

    session.setHandler('login', async ({ username, password }) => {
      try {
        await driver.homey.app.getAPIClient(username, password);
        session.credentials = { username, password };
        await driver.homey.app.setStoredCredentials(username, password);
        return true;
      } catch (error) {
        driver.error('Login failed:', error);
        throw new Error(driver.homey.__('pair.error.login_failed'));
      }
    });

    session.setHandler('list_devices', async () => {
      try {
        return await listDevicesHandler();
      } catch (error) {
        driver.error('list_devices failed:', error);
        throw error;
      }
    });
  }
}

module.exports = PairingHelper;
