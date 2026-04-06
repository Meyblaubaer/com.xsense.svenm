'use strict';

const Homey = require('homey');
const XSenseAPI = require('./lib/XSenseAPI');

class XSenseApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('XSense App has been initialized');

    // Initialize API client storage
    this.apiClients = new Map();

    // MQTT Health Tracking (NEW)
    this.mqttHealthy = new Map(); // houseId → boolean

    // Register flow card actions
    this._registerFlowCards();

    // One-off repair for missing deviceSn on temperature sensors
    this._scheduleDeviceSnRepair();

    // Coordinated polling: Only when MQTT is unhealthy
    // Increased to 60s to reduce API load
    this.pollInterval = setInterval(() => {
      this._pollDeviceUpdatesIfNeeded();
    }, 60000); // Changed from 30000 to 60000
  }

  /**
   * Register flow cards
   */
  _registerFlowCards() {
    // Triggers
    this.homey.flow.getDeviceTriggerCard('co_detected');
    this.homey.flow.getDeviceTriggerCard('device_muted');

    // Conditions
    // Custom flow condition removed


    // Actions
    const testAlarmCard = this.homey.flow.getActionCard('test_alarm');
    testAlarmCard.registerRunListener(async (args, state) => {
      return await args.device.testAlarm();
    });

    // Global Fire Drill Action
    this.homey.flow.getActionCard('trigger_fire_drill')
      .registerRunListener(async (args, state) => {
        this.log('🚨 Starting Global Fire Drill! Triggering station fire drill...');
        const driver = this.homey.drivers.getDriver('smoke-detector');
        const devices = driver.getDevices();

        const byStation = new Map();
        for (const device of devices) {
          const data = device.getData();
          if (!data || !data.stationId) continue;
          if (!byStation.has(data.stationId)) {
            byStation.set(data.stationId, device);
          }
        }

        const promises = Array.from(byStation.values()).map((device) => {
          return device.api.triggerFireDrill(device.getData().id)
            .then(() => this.log(`Fire drill triggered on station for ${device.getName()}`))
            .catch(err => this.error(`Failed to trigger fire drill for ${device.getName()}:`, err));
        });

        await Promise.all(promises);
        return true;
      });
  }

  _scheduleDeviceSnRepair() {
    // Delay to allow API init and device objects to settle
    setTimeout(() => {
      this._repairDeviceSnOnce().catch((err) => {
        this.error('[Repair] deviceSn repair failed:', err);
      });
    }, 5000);
  }

  async _repairDeviceSnOnce() {
    const driver = this.homey.drivers.getDriver('temperature-sensor');
    if (!driver) {
      this.homey.settings.set('deviceSnRepairDone', true);
      return;
    }

    const devices = driver.getDevices();
    if (!devices || devices.length === 0) {
      this.homey.settings.set('deviceSnRepairDone', true);
      return;
    }

    const missing = devices.filter((device) => {
      const data = device.getData();
      const store = device.getStore();
      return !(data && data.deviceSn) && !(store && store.deviceSn);
    });

    if (missing.length === 0) {
      this.homey.settings.set('deviceSnRepairDone', true);
      return;
    }

    const alreadyDone = this.homey.settings.get('deviceSnRepairDone');
    if (alreadyDone) {
      this.log('[Repair] deviceSn repair previously completed, but missing devices detected. Re-running repair.');
    }

    this.log(`[Repair] Running one-time deviceSn repair for ${missing.length} temp sensor(s)`);

    // Group devices by credentials to avoid redundant API calls
    const byCred = new Map();
    for (const device of missing) {
      const store = device.getStore();
      const email = store?.email;
      const password = store?.password;
      if (!email || !password) continue;
      const key = `${email}:${password}`;
      if (!byCred.has(key)) {
        byCred.set(key, { email, password, devices: [] });
      }
      byCred.get(key).devices.push(device);
    }

    for (const { email, password, devices: group } of byCred.values()) {
      let api;
      let all;
      try {
        api = await this.getAPIClient(email, password);
        all = await api.getAllDevices();
      } catch (err) {
        this.error('[Repair] Failed to fetch devices for repair:', err);
        continue;
      }

      const list = all?.devices || [];
      const byId = new Map();
      const bySn = new Map();
      for (const d of list) {
        if (d.id) byId.set(d.id, d);
        if (d.deviceSn) bySn.set(d.deviceSn, d);
      }

      for (const device of group) {
        const data = device.getData();
        const settings = device.getSettings();
        const store = device.getStore();

        const candidates = [
          data?.id,
          data?.deviceSn,
          store?.deviceSn,
          settings?.device_id,
          settings?.deviceId,
        ].filter(Boolean);

        let match = null;
        for (const candidate of candidates) {
          match = byId.get(candidate) || bySn.get(candidate);
          if (match) break;
        }

        if (match && match.deviceSn) {
          await device.setStoreValue('deviceSn', match.deviceSn).catch(this.error);
          if (device.deviceData) {
            device.deviceData.deviceSn = match.deviceSn;
          }
          this.log(`[Repair] Set deviceSn for ${device.getName()}: ${match.deviceSn}`);
        }
      }
    }

    this.homey.settings.set('deviceSnRepairDone', true);
    this.log('[Repair] deviceSn repair completed');
  }

  /**
   * Get or create API client for credentials
   */
  async getAPIClient(email, password) {
    const key = `${email}:${password}`;
    const existing = this.apiClients.get(key);

    if (existing) {
      if (existing instanceof XSenseAPI) {
        return existing;
      }
      return await existing;
    }

    const client = new XSenseAPI(email, password, this.homey);

    // Register global error handler for this client
    client.onUpdate((type, data) => {
      if (type === 'error' && data) {
        // Handle different error types with appropriate user notifications
        if (data.type === 'AUTH_FAILED' || data.type === 'SESSION_EXPIRED') {
          this.log('Received critical auth/session error, sending notification...');
          this.homey.notifications.createNotification({
            excerpt: `X-Sense: ${data.message}`
          }).catch(err => this.error('Failed to send notification:', err));
        } else if (data.type === 'SERVER_ERROR') {
          // Only notify on persistent server errors (already filtered in XSenseAPI)
          this.log(`X-Sense server error (${data.errorCode}), backoff: ${data.backoffMinutes}min`);
          this.homey.notifications.createNotification({
            excerpt: `X-Sense: ${data.message}`
          }).catch(err => this.error('Failed to send notification:', err));
        }
      }
    });

    const initPromise = (async () => {
      try {
        await client.init();
        this.apiClients.set(key, client);
        return client;
      } catch (error) {
        this.apiClients.delete(key);
        throw error;
      }
    })();

    this.apiClients.set(key, initPromise);
    return initPromise;
  }

  /**
   * Poll device updates only if MQTT is unhealthy
   * Reduces API calls when real-time updates work
   */
  async _pollDeviceUpdatesIfNeeded() {
    for (const [key, clientOrPromise] of this.apiClients.entries()) {
      try {
        const client = await clientOrPromise;
        if (!client || typeof client.getAllDevices !== 'function') {
          continue;
        }

        // Check if MQTT is healthy for all houses of this client
        const houses = Array.from(client.houses.values());
        const needsPolling = houses.some(house => {
          const isHealthy = this.mqttHealthy.get(house.houseId);
          return isHealthy !== true; // Poll if unhealthy or unknown
        });

        if (needsPolling) {
          this.log(`Polling updates for client (MQTT unhealthy or unknown)`);
          await client.getAllDevices();
        } else {
          // Log less frequently (only every 10 minutes)
          if (!this._lastSkipLog || (Date.now() - this._lastSkipLog) > 600000) {
            this.log('Skipping poll - MQTT is healthy for all houses');
            this._lastSkipLog = Date.now();
          }
        }

      } catch (error) {
        this.error('Error polling device updates:', error);
      }
    }
  }

  /**
   * Set MQTT health status for a house
   * Called by XSenseAPI when MQTT connects/disconnects
   */
  setMQTTHealth(houseId, isHealthy) {
    this.mqttHealthy.set(houseId, isHealthy);
    this.log(`MQTT health for house ${houseId}: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
  }

  /**
   * onUninit is called when the app is destroyed.
   */
  async onUninit() {
    this.log('XSense App is being destroyed');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Cleanup all API clients
    for (const [key, client] of this.apiClients) {
      client.destroy();
    }
    this.apiClients.clear();
  }
  /**
   * Store credentials in settings (with Base64 encoding)
   * Note: Base64 is not encryption, but prevents plain-text visibility
   */
  async setStoredCredentials(email, password) {
    this.log(`Saving credentials for ${email}`);
    this.homey.settings.set('xsense_email', email);

    try {
      // Use Base64 encoding (not true encryption, but obfuscates the password)
      const encodedPassword = Buffer.from(password).toString('base64');
      this.homey.settings.set('xsense_password_encoded', encodedPassword);
      this.log('Password encoded and stored');
    } catch (error) {
      this.error('Failed to encode password:', error);
      throw error;
    }
  }

  /**
   * Get stored credentials (with Base64 decoding)
   */
  async getStoredCredentials() {
    const email = this.homey.settings.get('xsense_email');
    // Check for new encoded format first, then fall back to old encrypted format
    let encodedPassword = this.homey.settings.get('xsense_password_encoded');
    const legacyEncrypted = this.homey.settings.get('xsense_password_encrypted');
    
    const hasPassword = !!(encodedPassword || legacyEncrypted);
    this.log(`Retrieving credentials: ${email}, hasPassword: ${hasPassword}`);

    if (!encodedPassword && !legacyEncrypted) {
      return {
        email: email,
        password: null
      };
    }

    try {
      // If we have the new encoded format, use it
      if (encodedPassword) {
        const password = Buffer.from(encodedPassword, 'base64').toString('utf8');
        return {
          email: email,
          password: password
        };
      }
      
      // Legacy: If only old encrypted format exists, we can't decrypt it
      // User will need to re-enter credentials
      this.log('Legacy encrypted password found - user needs to re-authenticate');
      return {
        email: email,
        password: null
      };
    } catch (error) {
      this.error('Failed to decode password:', error);
      throw error;
    }
  }
}

module.exports = XSenseApp;
