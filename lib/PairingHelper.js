'use strict';

const DeviceModelRegistry = require('./DeviceModelRegistry');

class PairingHelper {
  static _normalizeType(device) {
    return DeviceModelRegistry.typeOf(device);
  }

  static _defaultName(device, type) {
    return device?.name || device?.deviceName || `XSense ${type || 'Device'}`;
  }

  static _buildEntry({ username, password, device, type }) {
    const id = device.id || device.deviceId || device.deviceSn || device.deviceSN || device.sn || device.stationId;
    const deviceSn = device.deviceSn || device.deviceSN || device.sn || device.stationSn || device.stationSN || id;
    const stationSn = device.stationSn || device.stationSN;
    const entry = {
      name: PairingHelper._defaultName(device, type),
      data: {
        id,
        deviceSn,
        deviceType: type,
        stationId: device.stationId,
        stationSn,
        houseId: device.houseId,
      },
      store: {
        email: username,
        password: password,
        deviceSn,
        stationSn,
        stationId: device.stationId,
        houseId: device.houseId,
        deviceType: type,
      },
      settings: {
        device_id: device.id,
        device_type: type,
      },
    };

    const capabilities = DeviceModelRegistry.capabilities(type);
    if (capabilities) entry.capabilities = capabilities;
    return entry;
  }

  static async _getDevicesWithRetry(api, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const data = await api.getAllDevices();
        if (data && Array.isArray(data.devices) && data.devices.length > 0) return data;
        lastError = new Error('Discovery returned an empty device list');
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
      }
    }
    throw lastError;
  }

  static async listDevicesForPairing({ driver, session, matchDevice, matchLabel }) {
    if (!session || !session.credentials) {
      throw new Error(driver.homey.__('pair.error.not_logged_in'));
    }

    const { username, password } = session.credentials;
    const api = await driver.homey.app.getAPIClient(username, password);
    let data;
    try {
      data = await PairingHelper._getDevicesWithRetry(api);
    } catch (error) {
      driver.error('Pairing discovery failed after retries:', error);
      throw new Error(driver.homey.__('pair.error.list_failed'));
    }

    if (!data || !Array.isArray(data.devices)) {
      driver.error('Pairing failed: getAllDevices returned an unexpected result');
      throw new Error(driver.homey.__('pair.error.list_failed'));
    }

    let total = 0;
    let matched = 0;
    const rejected = [];
    const devices = [];
    const seenIds = new Set();

    for (const device of data.devices) {
      if (!device) {
        continue;
      }

      const id = device.id || device.deviceId || device.deviceSn || device.deviceSN || device.sn || device.stationId;
      if (!id || seenIds.has(String(id))) continue;

      total += 1;
      const type = PairingHelper._normalizeType(device);
      const isMatch = !!matchDevice(device, type);

      if (!isMatch) {
        rejected.push(type || 'UNKNOWN');
        continue;
      }

      matched += 1;
      devices.push(PairingHelper._buildEntry({ username, password, device, type }));
      seenIds.add(String(id));
    }

    driver.log(`[Pairing] ${driver.id}: total=${total}, matched=${matched}, rejected=${total - matched}, filter=${matchLabel}`);

    if (matched === 0) {
      const rejectedTypes = Array.from(new Set(rejected)).slice(0, 10);
      driver.log(`[Pairing] ${driver.id}: no matching devices. Rejected types: ${rejectedTypes.join(', ')}`);
      throw new Error(`${driver.homey.__('pair.error.no_supported_devices')} (${matchLabel})`);
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
        const normalizedUsername = typeof username === 'string' ? username.trim() : '';
        if (!normalizedUsername || typeof password !== 'string' || !password) {
          throw new Error('Missing email or password');
        }
        await driver.homey.app.getAPIClient(normalizedUsername, password);
        session.credentials = { username: normalizedUsername, password };
        await driver.homey.app.setStoredCredentials(normalizedUsername, password);
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
