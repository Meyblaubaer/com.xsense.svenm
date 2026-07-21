'use strict';

const Homey = require('homey');

class SmokeDetectorDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('SmokeDetectorDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' template is used.
   */
  async onPairListDevices() {
    this.log('=== onPairListDevices called ===');
    const devices = [];

    try {
      // Get credentials from driver instance (set in onPair login handler)
      if (!this.pairingCredentials) {
        this.error('No pairing credentials available');
        throw new Error('No credentials provided');
      }

      const { username, password } = this.pairingCredentials;
      this.log(`Getting devices for user: ${username}`);

      // Get API client
      const api = await this.homey.app.getAPIClient(username, password);

      // Get all devices
      const data = await api.getAllDevices();
      this.log(`API returned data:`, JSON.stringify(data, null, 2));

      // Process devices
      for (const device of data.devices) {
        // Only add smoke detectors and CO detectors
        const deviceType = device.deviceType || device.type || '';
        this.log(`Processing device: ${device.deviceName}, type: ${deviceType}, id: ${device.id}`);

        // FIXED: Naming convention [Station Name] [Device Name]
        let name = device.deviceName || device.name || `XSense ${deviceType}`;
        if (device.stationName && !name.startsWith(device.stationName)) {
          // Basic check is not enough if stationName is just "Home" and device is "Home Sensor"
          // but it's better than nothing.
          name = `${device.stationName} ${name}`;
        }

        const deviceEntry = {
          name: name,
          data: {
            id: device.id,
            stationId: device.stationId,
            houseId: device.houseId
          },
          store: {
            email: username,
            password: password,
            stationId: device.stationId,
            houseId: device.houseId,
            deviceType: deviceType
          }
        };

        this.log(`Device entry created:`, JSON.stringify(deviceEntry, null, 2));
        devices.push(deviceEntry);
      }

      this.log(`=== Returning ${devices.length} devices ===`);
      this.log('Devices array:', JSON.stringify(devices, null, 2));
      return devices;
    } catch (error) {
      this.error('Error listing devices:', error);
      this.error('Stack:', error.stack);
      throw error;
    }
  }

  /**
   * Determine device capabilities based on device type and available data
   */
  _getCapabilities(device) {
    const capabilities = ['alarm_smoke'];

    // Battery capabilities
    if (device.batInfo !== undefined || device.batteryLevel !== undefined) {
      capabilities.push('measure_battery');

      // Add battery alarm if battery percentage can be determined
      if (device.batInfo !== undefined) {
        capabilities.push('alarm_battery');
      }
    }

    // Temperature
    if (device.temperature !== undefined || device.temp !== undefined) {
      capabilities.push('measure_temperature');
    }

    // Humidity
    if (device.humidity !== undefined || device.humi !== undefined) {
      capabilities.push('measure_humidity');
    }

    // CO detection
    if (device.coValue !== undefined || device.co !== undefined) {
      capabilities.push('alarm_co');
    }

    return capabilities;
  }

  /**
   * Handle pairing - with login_credentials template
   */
  async onPair(session) {
    this.log('Pairing session started');
    
    // Store session reference for other methods (like other drivers do)
    this.homey.app.currentPairSession = session;

    // Check for stored credentials (FIXED: Async for encryption)
    const stored = await this.homey.app.getStoredCredentials();
    this.log(`onPair: Stored credentials found? ${!!stored.email}`);

    if (stored.email && stored.password) {
      this.log('Found stored credentials, attempting auto-login');
      try {
        await this.homey.app.getAPIClient(stored.email, stored.password);
        // FIX: Store credentials in session object (like all other working drivers)
        session.credentials = {
          username: stored.email,
          password: stored.password
        };
        this.log('Auto-login successful, advancing view');
        // Use showView like all other drivers (more reliable than next())
        await session.showView('list_devices');
      } catch (error) {
        this.log('Auto-login failed with stored credentials:', error);
      }
    }

    // For login_credentials template, we need to handle the 'login' event
    session.setHandler('login', async (data) => {
      try {
        const { username, password } = data;
        this.log(`Login attempt for user: ${username}`);

        // Try to authenticate
        const api = await this.homey.app.getAPIClient(username, password);

        // FIX: Store credentials in session object (like all other working drivers)
        session.credentials = {
          username: username,
          password: password
        };

        // Save for future
        this.homey.app.setStoredCredentials(username, password);

        this.log('Login successful, credentials stored in session');
        return true;
      } catch (error) {
        this.error('Login failed:', error);
        throw new Error(`Login failed: ${error.message || error}`);
      }
    });

    // Manually handle list_devices since we're using login_credentials template
    session.setHandler('list_devices', async () => {
      this.log('list_devices handler called');

      // FIX: Check session.credentials (like all other working drivers)
      if (!session.credentials) {
        this.error('No credentials available in list_devices handler');
        throw new Error('Please login first');
      }

      const devices = [];
      try {
        const { username, password } = session.credentials;
        this.log(`Getting devices for user: ${username}`);

        // Get API client
        const api = await this.homey.app.getAPIClient(username, password);

        // Get all devices
        const data = await api.getAllDevices();
        if (!data || !Array.isArray(data.devices)) {
          this.error('getAllDevices returned unexpected result:', data);
          return devices;
        }
        this.log(`API returned ${data.devices.length} devices`);

        // Process devices
        for (const device of data.devices) {
          if (!device || !device.id) {
            this.log(`Skipping device with missing id: ${JSON.stringify(device)}`);
            continue;
          }
          const deviceType = device.deviceType || device.type || '';

          // FILTER: Only include Smoke detectors
          // Supported types:
          //   - XS01-M, XS01-WX: Standalone smoke detectors (WiFi)
          //   - XS03-iWX, XS03-WX: Smoke detectors
          //   - XS0B-MR, XS0B-iR, XS0D-MR: RF smoke detectors
          //   - SC06-WX, SC07-WX, SC07-MR: Smoke/CO Combo (WiFi)
          //   - XP02S-MR, XP0A-MR, XP0A-iR: Smoke/CO Combo
          //   - SD11-MR: Smoke only
          //   - XS0F-PMA: 230V smoke detector with RFM2300ZW-B RF module
          // Exclude: Heat (XH), Water (SWS), Temp (STH), Base Stations (SBS), CO-only (XC without smoke)
          const smokeTypes = [
            'XS01-M', 'XS01-WX', 'XS03-iWX', 'XS03-WX', 'XS0B-MR', 'XS0B-iR', 'XS0D-MR',
            'SC06-WX', 'SC07-WX', 'SC07-MR',
            'XP02S-MR', 'XP0A-MR', 'XP0A-iR', 'XP0A',
            'SD11-MR',
            'XS0F-PMA'
          ];
          
          if (!smokeTypes.some(t => deviceType.toUpperCase().includes(t.toUpperCase()))) {
            this.log(`Skipping device ${device.deviceName || device.name} (Type: ${deviceType}) - Not a smoke detector`);
            continue;
          }

          // FIXED: Use the name from API directly (which includes our "Type SN" fix from XSenseAPI)
          // Do NOT prepend station name as it leads to "Basisstation DeviceName" which is redundant/ugly.
          let name = device.deviceName || device.name || `XSense ${deviceType}`;

          const deviceEntry = {
            name: name,
            data: {
              id: device.id,
              stationId: device.stationId,
              houseId: device.houseId
            },
            store: {
              email: username,
              password: password,
              stationId: device.stationId,
              houseId: device.houseId,
              deviceType: deviceType
            }
          };

          this.log(`Adding device: ${deviceEntry.name}`);
          devices.push(deviceEntry);
        }

        this.log(`Returning ${devices.length} devices`);
        return devices;
      } catch (error) {
        this.error('Error listing devices:', error);
        throw error;
      }
    });
  }
}

module.exports = SmokeDetectorDriver;
