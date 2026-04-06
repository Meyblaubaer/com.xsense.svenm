// HACK: Fix for AWS SDK 'uv_os_homedir returned ENOENT' on Homey
if (!process.env.HOME) {
  process.env.HOME = '/tmp';
}

'use strict';

const mqtt = require('mqtt');
const crypto = require('crypto');
const DataSanitizer = require('./DataSanitizer');
const DebugLogger = require('./DebugLogger');
const MQTTReconnectStrategy = require('./MQTTReconnectStrategy');
const fetch = require('node-fetch');
const AwsSigner = require('./AwsSigner');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { CognitoIdentityProviderClient, InitiateAuthCommand, RespondToAuthChallengeCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { createSrpSession, wrapInitiateAuth, signSrpSession, wrapAuthChallenge, createSecretHash } = require('cognito-srp-helper');


/**
 * Simple Mutex for serializing async operations
 */
class SimpleMutex {
  constructor() {
    this._lock = Promise.resolve();
  }

  async runExclusive(fn) {
    let release;
    const nextLock = new Promise((resolve) => {
      release = resolve;
    });
    const currentLock = this._lock;
    this._lock = nextLock;
    try {
      await currentLock;
      return await fn();
    } finally {
      release();
    }
  }
}

// Polyfill for fetch in Node.js
global.fetch = fetch;

/**
 * XSense API Client with AWS Cognito Authentication
 * Based on python-xsense library: https://github.com/theosnel/python-xsense
 */
class XSenseAPI {
  constructor(email, password, homey = null) {
    this.email = email;
    this.password = password;
    this.homey = homey; // NEW: Homey instance for callbacks
    this.baseUrl = 'https://api.x-sense-iot.com';

    // Initialize debug logger
    this.debug = new DebugLogger(homey, 'XSenseAPI');

    // Cognito configuration (will be fetched dynamically)
    this.userPoolId = null;
    this.clientId = null;
    this.clientSecret = null;
    this.region = null;
    this.userPool = null;

    // Authentication tokens
    this.accessToken = null;
    this.idToken = null;
    this.refreshToken = null;

    // App info
    this.appVersion = 'v1.22.0_20240914.1';
    this.appCode = '1220';
    this.clientType = '1';

    // Data storage
    this.houses = new Map();
    this.stations = new Map();
    this.devices = new Map();
    this.mqttClients = new Map();
    this.updateCallbacks = [];
    this.devicesBySn = new Map();
    this.stationsBySn = new Map();
    this.shadowFailureCount = new Map();
    this.legacyAccessToken = null;
    this.legacyRefreshToken = null;
    this.legacyUserId = null;
    this.legacyLoginAttempted = false;
    this._signerDebugLogged = false;
    this._signerDebugConfig = undefined;

    // Mutex to prevent parallel connection attempts
    this.mqttMutex = new SimpleMutex();

    // Server Error Retry Strategy (Exponential Backoff)
    this.serverErrorCount = 0;
    this.lastServerError = null;
    this.serverErrorBackoffUntil = null;
  }

  /**
   * Initialize API - Get Cognito credentials and authenticate
   */
  async init() {
    this.debug.log('[XSenseAPI] Initializing...');

    // Step 1: Get Cognito client info
    await this.getClientInfo();

    // Step 2: Authenticate with Cognito
    await this.login();

    // Step 3: Get AWS IoT credentials for Thing Shadow API
    await this.getAWSTokens();

    // Step 4: Fetch initial device data
    await this.getAllDevices();

    this.debug.log('[XSenseAPI] Initialization complete');
  }

  _getSignerDebugConfig() {
    if (this._signerDebugConfig !== undefined) {
      return this._signerDebugConfig;
    }

    const filePath = path.join(__dirname, '..', 'signer-debug.json');
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      this._signerDebugConfig = JSON.parse(raw);
    } catch (error) {
      this._signerDebugConfig = null;
    }
    return this._signerDebugConfig;
  }

  /**
   * Get Cognito client configuration from XSense API
   */
  async getClientInfo() {
    this.debug.log('[XSenseAPI] Fetching Cognito client info...');

    const response = await this._apiCall('101001', {}, true);

    // XSense API returns data in 'reData' field
    const data = response?.reData || response?.data;

    if (data) {
      this.clientId = data.clientId;
      this.clientSecret = this._decodeSecret(data.clientSecret);
      this.region = data.cgtRegion;
      this.userPoolId = data.userPoolId;

      this.debug.log(`[XSenseAPI] Cognito configured: Region=${this.region}, Pool=${this.userPoolId}`);
    } else {
      throw new Error('Failed to get client info');
    }
  }

  async _legacyRequest(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.legacyAccessToken) {
      headers['Authorization'] = `Bearer ${this.legacyAccessToken}`;
    }

    const options = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (response.status === 401 && this.legacyRefreshToken) {
      await this._legacyRefreshAccessToken();
      return this._legacyRequest(method, path, body);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Legacy API ${response.status}: ${text}`);
    }

    return response.json();
  }

  async _legacyLogin() {
    if (this.legacyAccessToken || this.legacyLoginAttempted) {
      return !!this.legacyAccessToken;
    }

    this.legacyLoginAttempted = true;
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password })
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 403) {
          // Common for newer accounts that only support SRP
          // this.debug.log('[WARN]', `[XSenseAPI] Legacy login failed: 403 ${text}`);
          return null; // Fallback will handle this
        }
        this.debug.log('[WARN]', `[XSenseAPI] Legacy login failed: ${response.status} ${text}`);
        return false;
      }

      const data = await response.json();
      if (data && data.data) {
        this.legacyAccessToken = data.data.access_token || null;
        this.legacyRefreshToken = data.data.refresh_token || null;
        this.legacyUserId = data.data.user_id || null;
        this.debug.log('[XSenseAPI] Legacy login successful');
        return true;
      }
    } catch (error) {
      this.debug.log('[WARN]', '[XSenseAPI] Legacy login error:', error.message);
    }

    return false;
  }

  async _legacyRefreshAccessToken() {
    if (!this.legacyRefreshToken) {
      throw new Error('Legacy refresh token missing');
    }

    const response = await fetch(`${this.baseUrl}/api/v1/user/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.legacyRefreshToken })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Legacy refresh failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    if (data && data.data && data.data.access_token) {
      this.legacyAccessToken = data.data.access_token;
      this.debug.log('[XSenseAPI] Legacy access token refreshed');
      return true;
    }

    throw new Error('Legacy refresh returned no access token');
  }

  async getLegacyMqttConfig(stationId) {
    if (!stationId) {
      return null;
    }

    const loggedIn = await this._legacyLogin();
    if (!loggedIn) {
      return null;
    }

    try {
      const response = await this._legacyRequest('GET', `/api/v1/stations/${stationId}/mqtt`);
      return response?.data || response || null;
    } catch (error) {
      this.debug.log('[WARN]', `[XSenseAPI] Legacy MQTT config failed for ${stationId}:`, error.message);
      return null;
    }
  }

  /**
   * Decode client secret (base64 + slice)
   * Based on python-xsense: base64decode, then remove first 4 bytes and last 1 byte
   */
  _decodeSecret(encodedSecret) {
    const decoded = Buffer.from(encodedSecret, 'base64');
    // Remove first 4 bytes and last 1 byte (Python: value[4:-1])
    const secretBuffer = decoded.slice(4, -1);
    const secret = secretBuffer.toString('utf-8');
    this.debug.log(`[XSenseAPI] Decoded secret length: ${secret.length}`);

    // Store both string and buffer versions
    this.clientSecretBuffer = secretBuffer;
    return secret;
  }

  /**
   * Calculate MAC for API requests
   * Based on python-xsense: concatenate all param values + clientsecret, then MD5 hash
   */
  _calculateMac(params) {
    const values = [];

    if (params) {
      for (const key in params) {
        const value = params[key];
        if (Array.isArray(value)) {
          if (value.length > 0 && typeof value[0] === 'string') {
            values.push(...value);
          } else {
            values.push(JSON.stringify(value));
          }
        } else if (typeof value === 'object' && value !== null) {
          values.push(JSON.stringify(value));
        } else {
          values.push(String(value));
        }
      }
    }

    // Concatenate all values
    const concatenated = values.join('');

    // Append client secret as bytes and calculate MD5
    const macData = Buffer.concat([
      Buffer.from(concatenated, 'utf-8'),
      this.clientSecretBuffer
    ]);

    const mac = crypto.createHash('md5').update(macData).digest('hex');
    this.debug.log(`[XSenseAPI] Calculated MAC for params:`, params, `=> ${mac}`);
    return mac;
  }

  /**
   * Calculate SECRET_HASH for Cognito (using cognito-srp-helper)
   */
  _calculateSecretHash(username) {
    this.debug.log(`[XSenseAPI] Calculating SECRET_HASH for: ${username}`);
    const hash = createSecretHash(username, this.clientId, this.clientSecret);
    this.debug.log(`[XSenseAPI] SECRET_HASH: ${hash}`);
    return hash;
  }

  /**
   * Authenticate with AWS Cognito using SRP
   */
  async login() {
    this.debug.log(`[XSenseAPI] Authenticating user: ${this.email} with SRP...`);

    try {
      // Pass dummy credentials to prevent AWS SDK from trying to read ~/.aws/credentials
      // (which causes 'uv_os_homedir returned ENOENT' on Homey)
      const client = new CognitoIdentityProviderClient({
        region: this.region,
        credentials: {
          accessKeyId: 'dummy',
          secretAccessKey: 'dummy'
        }
      });
      const secretHash = this._calculateSecretHash(this.email);

      // Step 1: Create SRP session
      const srpSession = createSrpSession(this.email, this.password, this.userPoolId, false);
      this.debug.log('[XSenseAPI] SRP session created');

      // Step 2: Initiate Auth with SRP_A
      const initiateAuthCommand = new InitiateAuthCommand(
        wrapInitiateAuth(srpSession, {
          ClientId: this.clientId,
          AuthFlow: 'USER_SRP_AUTH',
          AuthParameters: {
            SECRET_HASH: secretHash,
            USERNAME: this.email
          }
        })
      );

      this.debug.log('[XSenseAPI] Sending InitiateAuth command...');
      const initiateAuthResponse = await client.send(initiateAuthCommand);

      if (!initiateAuthResponse.ChallengeName || initiateAuthResponse.ChallengeName !== 'PASSWORD_VERIFIER') {
        throw new Error(`Unexpected challenge: ${initiateAuthResponse.ChallengeName}`);
      }

      this.debug.log('[XSenseAPI] PASSWORD_VERIFIER challenge received, signing session...');

      // Step 3: Sign the SRP session with the challenge response
      const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);

      // Step 4: Respond to Challenge
      const respondToChallengeCommand = new RespondToAuthChallengeCommand(
        wrapAuthChallenge(signedSrpSession, {
          ClientId: this.clientId,
          ChallengeName: 'PASSWORD_VERIFIER',
          ChallengeResponses: {
            SECRET_HASH: secretHash,
            USERNAME: this.email
          }
        })
      );

      this.debug.log('[XSenseAPI] Sending RespondToAuthChallenge command...');
      const respondToChallengeResponse = await client.send(respondToChallengeCommand);

      if (respondToChallengeResponse.AuthenticationResult) {
        this.accessToken = respondToChallengeResponse.AuthenticationResult.AccessToken;
        this.idToken = respondToChallengeResponse.AuthenticationResult.IdToken;
        this.refreshToken = respondToChallengeResponse.AuthenticationResult.RefreshToken;

        this.debug.log('[XSenseAPI] SRP Authentication successful');
        return true;
      } else {
        throw new Error('No authentication result received');
      }
    } catch (error) {
      this.debug.error(`[XSenseAPI] SRP Authentication failed for ${this.email}:`, error.message);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Get AWS IoT credentials for Thing Shadow API
   */
  async getAWSTokens() {
    this.debug.log('[XSenseAPI] Getting AWS IoT credentials...');

    const response = await this._apiCall('101003', { userName: this.email });
    const data = response?.reData;

    if (data) {
      this.awsAccessKeyId = data.accessKeyId;
      this.awsSecretAccessKey = data.secretAccessKey;
      this.awsSessionToken = data.sessionToken;
      if (this.awsSigner) {
        this.awsSigner.updateCredentials(this.awsAccessKeyId, this.awsSecretAccessKey, this.awsSessionToken);
      } else {
        this.awsSigner = new AwsSigner(
          this.awsAccessKeyId,
          this.awsSecretAccessKey,
          this.awsSessionToken
        );
      }

      this.debug.log('[XSenseAPI] AWS IoT credentials obtained');
      // Set expiration to 50 minutes (3,000,000 ms) to be safe (tokens last 60 mins)
      this.awsTokenExpiration = Date.now() + 3000000;
    } else {
      this.debug.log('[WARN]', '[XSenseAPI] No AWS credentials in response, Thing Shadow API may not work');
    }
  }

  /**
   * Ensure AWS Tokens are valid, refreshing if necessary
   */
  async _ensureAWSTokens() {
    if (!this.awsTokenExpiration || Date.now() > this.awsTokenExpiration) {
      this.debug.log('[XSenseAPI] AWS tokens expired or missing, refreshing...');
      await this.getAWSTokens();
    }
  }

  /**
   * Make API call to XSense backend
   */
  async _apiCall(bizCode, params = {}, unauth = false) {
    const url = `${this.baseUrl}/app`;

    // Check if we have a valid access token for authenticated calls
    if (!unauth && !this.accessToken) {
      this.debug.error('[XSenseAPI] No access token available for authenticated API call');
      throw new Error('SessionExpired: No access token available. Please log in again.');
    }

    // Calculate MAC from params only (not the full body)
    const mac = unauth ? 'abcdefg' : this._calculateMac(params);

    // Build request body - params are spread at root level, not inside 'data'
    const body = {
      ...params,  // Spread params first (e.g., utctimestamp, houseId, etc.)
      bizCode: bizCode,
      appCode: this.appCode,
      clientType: this.clientType,
      version: this.appVersion,
      mac: mac
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    if (!unauth && this.accessToken) {
      headers['Authorization'] = this.accessToken;
    }

    try {
      // Check if we're in backoff period due to server errors
      if (this.serverErrorBackoffUntil && Date.now() < this.serverErrorBackoffUntil) {
        const remainingSeconds = Math.ceil((this.serverErrorBackoffUntil - Date.now()) / 1000);
        this.debug.log(`[XSenseAPI] In backoff period, skipping call. Retry in ${remainingSeconds}s`);
        throw new Error(`Server temporarily unavailable. Retrying in ${remainingSeconds}s`);
      }

      const startTime = Date.now();
      this.debug.log(`[XSenseAPI] Calling bizCode ${bizCode} with params:`, JSON.stringify(params));

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });

      this.debug.log(`[XSenseAPI] Response status: ${response.status}`);

      // ============================================================
      // PRIORITY 1: Handle Server Errors (502, 503, 504) FIRST
      // Do NOT invalidate tokens on server errors!
      // ============================================================
      if (response.status >= 500 && response.status < 600) {
        this.serverErrorCount++;
        this.lastServerError = Date.now();

        // Calculate exponential backoff: 1min, 2min, 5min, 10min, max 15min
        const backoffMinutes = Math.min(
          [1, 2, 5, 10, 15][Math.min(this.serverErrorCount - 1, 4)],
          15
        );
        this.serverErrorBackoffUntil = Date.now() + (backoffMinutes * 60 * 1000);

        const errorText = await response.text().catch(() => 'No response body');
        this.debug.error(`[XSenseAPI] Server error ${response.status}. Backoff: ${backoffMinutes}min. Error count: ${this.serverErrorCount}`);
        this.debug.error(`[XSenseAPI] Server error response:`, errorText);

        // Emit user notification for persistent server errors
        if (this.serverErrorCount >= 3) {
          this._emitUpdate('error', {
            type: 'SERVER_ERROR',
            message: `X-Sense server temporarily unavailable (${response.status}). Automatic retry in ${backoffMinutes} minutes.`,
            errorCode: response.status,
            backoffMinutes: backoffMinutes
          });
        }

        throw new Error(`Server Error ${response.status}: ${response.statusText}. Retry in ${backoffMinutes}min`);
      }

      // If we got a successful response, reset server error counter
      if (response.ok) {
        if (this.serverErrorCount > 0) {
          this.debug.log(`[XSenseAPI] Server recovered after ${this.serverErrorCount} errors`);
          this.serverErrorCount = 0;
          this.serverErrorBackoffUntil = null;
        }
      }

      // ============================================================
      // PRIORITY 2: Handle Authentication Errors (401)
      // ============================================================
      if (response.status === 401 && !params._isRetry) {
        this.debug.log('[WARN]', '[XSenseAPI] Received 401 Unauthorized, attempting re-login and retry...');
        try {
          // Force re-login
          await this.login();

          // Retry the call with _isRetry flag to prevent infinite loops
          const retryParams = { ...params, _isRetry: true };
          delete retryParams._isRetry; // FIX: Internen Parameter entfernen
          return await this._apiCall(bizCode, retryParams, unauth);
        } catch (retryError) {
          this.debug.error('[XSenseAPI] Re-login/retry failed:', retryError);
          // Emit critical error for App to handle (Timeline notification)
          this._emitUpdate('error', {
            type: 'AUTH_FAILED',
            message: 'Session expired and re-login failed. Please check your credentials in settings.'
          });

          // If retry fails, throw the original error (or new one)
          throw new Error('Session expired and re-login failed');
        }
      }

      // ============================================================
      // PRIORITY 3: Handle Other HTTP Errors (400, 403, 404, etc.)
      // ============================================================
      if (!response.ok) {
        const text = await response.text();
        this.debug.error(`[XSenseAPI] HTTP error ${response.status}:`, text);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;
      this.debug.log(`[XSenseAPI] Response data:`, JSON.stringify(data).substring(0, 500));

      // DEBUG: Log API call
      this.debug.logAPICall('POST', url, bizCode, params, data, duration);

      // Check if response has error code (XSense uses reCode)
      const errorCode = data.reCode || data.code;
      if (errorCode !== undefined && errorCode !== 200 && errorCode !== 0) {
        const errorMsg = data.reMsg || data.msg || data.message || 'Unknown error';

        // Handle session expiration or "another device logged in"
        // 10000008/10000020 are known Session Expired codes
        // Also handle "bizCode cannot be empty" which indicates invalid session state
        if (['10000008', '10000020', '10000004'].includes(String(errorCode)) || errorMsg.includes('another device is logged in') || errorMsg.includes('Authorization cannot be empty') || errorMsg.includes('bizCode cannot be empty')) {
          this.debug.log('[WARN]', `[XSenseAPI] Session invalid (Code: ${errorCode}, Msg: ${errorMsg}). Attempting re-authentication...`);

          // If this is NOT a retry, attempt to re-authenticate
          if (!params._isRetry) {
            try {
              this.debug.log('[XSenseAPI] Re-authenticating due to session expiration...');
              await this.login();

              // Retry the call with _isRetry flag to prevent infinite loops
              const retryParams = { ...params, _isRetry: true };
              delete retryParams._isRetry; // FIX: Internen Parameter entfernen
              this.debug.log('[XSenseAPI] Retrying API call after re-authentication...');
              return await this._apiCall(bizCode, retryParams, unauth);
            } catch (retryError) {
              this.debug.error('[XSenseAPI] Re-authentication failed:', retryError.message);

              // Emit critical error for App to handle (Timeline notification)
              this._emitUpdate('error', {
                type: 'SESSION_EXPIRED',
                message: errorMsg.includes('another device is logged in')
                  ? this.homey.__('error.another_device_logged_in')
                  : this.homey.__('error.session_expired_retry_failed'),
                errorCode: errorCode
              });

              // Clear tokens to force fresh login next time
              this.accessToken = null;
              this.idToken = null;
              this.refreshToken = null;

              throw new Error(`SessionExpired: ${errorMsg}`);
            }
          } else {
            // Already retried, give up
            this.debug.error('[XSenseAPI] Session re-authentication retry failed. Giving up.');
            this.accessToken = null;
            this.idToken = null;
            this.refreshToken = null;

            throw new Error(`SessionExpired: ${errorMsg}`);
          }
        }

        throw new Error(`API Error ${errorCode}: ${errorMsg}`);
      }

      return data;
    } catch (error) {
      this.debug.error(`[XSenseAPI] API call failed (${bizCode}):`, error.message);

      // If we caught our own SessionExpired error, re-throw it so caller handles it (or just let it bubble)
      throw error;
    }
  }

  /**
   * Get all houses (including shared ones)
   */
  async getHouses() {
    const response = await this._apiCall('102007', { utctimestamp: '0' });
    const reData = response?.reData;

    if (!reData) {
      return [];
    }

    // Pattern 1: reData is an array of houses (own houses)
    if (Array.isArray(reData)) {
      this.debug.log(`[XSenseAPI] Found ${reData.length} houses (direct array)`);
      return reData;
    }

    // Pattern 2: reData is an object containing multiple lists (Shared Accounts)
    if (typeof reData === 'object') {
      const ownHouses = reData.houseInfoList || [];
      const sharedHouses = reData.shareHouseInfoList || [];
      const total = ownHouses.concat(sharedHouses);
      this.debug.log(`[XSenseAPI] Found ${total.length} houses (${ownHouses.length} own, ${sharedHouses.length} shared)`);
      return total;
    }

    return [];
  }

  /**
   * Get stations for a house
   */
  async getStations(houseId) {
    const response = await this._apiCall('103007', {
      houseId: houseId,
      utctimestamp: '0'
    });
    // XSense API returns station list in reData.stations
    const stations = response?.reData?.stations || [];
    this.debug.log('[XSenseAPI] Stations data:', JSON.stringify(stations, null, 2));
    return stations;
  }

  /**
   * Get Thing Shadow (device/station data)
   */
  async getThingShadow(thingName, shadowName = 'baseInfo', mqttRegion = null) {
    // Ensure tokens are valid before request
    await this._ensureAWSTokens();

    // Use the MQTT region from house if provided, otherwise fall back to Cognito region
    const region = mqttRegion || this.region;

    let url = `https://${region}.x-sense-iot.com/things/${thingName}/shadow`;
    if (shadowName) {
      url += `?name=${shadowName}`;
    }

    const failureCount = this.shadowFailureCount.get(`${thingName}:${shadowName || 'default'}`) || 0;
    if (failureCount > 5) {
      return {};
    }

    if (!this.awsAccessKeyId || !this.awsSecretAccessKey || !this.awsSessionToken) {
      this.debug.error('[XSenseAPI] Missing AWS credentials, cannot fetch Thing Shadow');
      return {};
    }

    const headers = this._signAWSRequest({
      method: 'GET',
      url,
      region,
      service: 'iotdata',
      payload: ''
    });
    headers['Content-Type'] = 'application/x-amz-json-1.0';

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: headers
      });

      if (!response.ok) {
        const text = await response.text();
        // Log the detailed error from AWS to help debug (e.g. ResourceNotFoundException)
        // this.debug.log('[WARN]', `[XSenseAPI] Failed to get shadow for ${thingName} (shadow=${shadowName || 'default'}): HTTP ${response.status} ${text}`);

        const key = `${thingName}:${shadowName || 'default'}`;
        this.shadowFailureCount.set(key, failureCount + 1);
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.shadowFailureCount.delete(`${thingName}:${shadowName || 'default'}`);

      // Support FLATTENED shadows (direct JSON) as well as standard AWS IoT shadows
      if (data.state && data.state.reported) {
        return data.state.reported;
      }
      // If it has 'state' but no 'reported', maybe it's desired? or just 'state'?
      // If it's just a flat object (like 2nd_systime seems to be), return it directly.
      return data;
    } catch (error) {
      // already logged specific error above for HTTP errors
      if (!error.message.startsWith('HTTP')) {
        this.debug.error(`[XSenseAPI] Failed to get shadow for ${thingName}:`, error.message);
      }
      return {};
    }
  }

  /**
   * Get all devices from all houses and stations
   */
  async getAllDevices() {
    this.debug.log('[XSenseAPI] Fetching all devices (Optimized v1.1.8 - Parallel Shadow Fetch)...');

    const houses = await this.getHouses();

    // Clear maps but keep existing references if needed?
    // Actually, safer to rebuild to avoid stale devices.
    this.devices.clear();
    this.devicesBySn.clear();
    this.stations.clear();
    this.stationsBySn.clear();
    this.houses.clear();

    const allDevices = [];
    const allStations = [];
    
    // OPTIMIZATION v1.1.8: Collect WiFi stations for parallel shadow fetching
    const wifiStationsToEnrich = [];

    // Phase 1: Populate core structure from API (Houses -> Stations -> Devices)
    // We need to do this FIRST so that we have the devices in the map when we parse shadows.
    for (const house of houses) {
      this.houses.set(house.houseId, house);
      const stations = await this.getStations(house.houseId);

      for (const station of stations) {
        // Enhance station data
        station.houseId = house.houseId;
        station.houseName = house.houseName;
        station.mqttRegion = house.mqttRegion;
        station.stationType = station.stationType || station.category;
        station.sn = station.sn || station.stationSn;
        station.stationSn = station.stationSn || station.sn;

        // Use userId from station to update house (if missing)
        // Use userId from station to update house (CRITICAL for Shared Accounts)
        // If the station has a userId (Owner ID), it overrides the House's userId (Viewer ID)
        // This ensures MQTT subscribes to the OWNER'S shadow, not the VIEWER'S shadow.
        if (station.userId) {
          if (house.userId !== station.userId) {
            this.debug.log(`[XSenseAPI] Updating House ${house.houseId} owner: ${house.userId} -> ${station.userId} (from station ${station.stationName})`);
          }
          house.userId = station.userId;
          this.houses.set(house.houseId, house);
        }

        this.stations.set(station.stationId, station);
        if (station.stationSn) {
          this.stationsBySn.set(station.stationSn, station);
        }
        allStations.push(station);
        this.debug.log(`[XSenseAPI] DEBUG: Station Object for ${station.stationName}:`, JSON.stringify(station, null, 2));

        // Process Devices immediately
        const devices = station.devices || [];

        // SPECIAL HANDLING: WiFi Devices (Smoke Detectors, CO Detectors, Combo Detectors)
        // These appear as STATIONS with no child devices. We must treat the station itself as a device.
        // Known WiFi device types:
        // - SC07-WX: WiFi Smoke Detector
        // - XC01-WX: WiFi CO Detector
        // - XH02-WX: WiFi Heat Detector
        // - XS01-WX: WiFi Smoke Detector (standalone)
        // - XC04-WX: WiFi CO Detector (standalone)
        // - XP0A-iR: WiFi Combo Smoke/CO Detector with IR
        // - XP0A-MR: WiFi Combo Smoke/CO Detector
        // - XS0B-iR: WiFi Smoke Detector with IR (USER REPORTED - Fix v1.1.3)
        const wifiDeviceTypes = [
          'SC07-WX', 'XC01-WX', 'XH02-WX', 'XS01-WX', 'XC04-WX',
          'XP0A-iR', 'XP0A-MR', 'XP0A', 'SC01-WX', 'SC04-WX',
          'XS0B-iR', 'XS0B'  // Fix for missing smoke detector type
        ];
        const isWiFiDevice = wifiDeviceTypes.some(type =>
          station.category === type || station.category?.startsWith(type.split('-')[0])
        );
        
        if (isWiFiDevice) {
          this.debug.log(`[XSenseAPI] Found WiFi Device (as Station): ${station.category} - ${station.stationName}`);

          // OPTIMIZATION v1.1.8: Don't fetch shadow here - collect for parallel fetch later
          // Store reference for later enrichment
          wifiStationsToEnrich.push({ station, house });

          const wifiDevice = {
            id: station.stationId, // Use stationId as deviceId
            stationId: station.stationId,
            houseId: house.houseId,
            houseName: house.houseName,
            stationName: station.stationName,
            mqttRegion: house.mqttRegion,
            devUserId: station.userId,
            deviceName: station.stationName,
            // Ensure both type and deviceType are set for driver compatibility
            type: station.category,
            deviceType: station.category,
            deviceSn: station.stationSn,

            // Map Mapped fields from Shadow (will be enriched later)
            onLine: station.onLine,
            wifiRssi: station.wifiRSSI || station.wifiRssi,
            alarmStatus: station.alarmStatus,
            muteStatus: station.muteStatus,
            coPpm: station.coPpm,
            coLevel: station.coLevel,
            batInfo: station.batInfo,
            temperature: station.temperature,
            humidity: station.humidity,

            ...station
          };

          this.devices.set(wifiDevice.id, wifiDevice);
          if (wifiDevice.deviceSn) {
            this.devicesBySn.set(wifiDevice.deviceSn, wifiDevice.id);
          }
          allDevices.push(wifiDevice);
        }

        for (const device of devices) {
          // SPECIAL HANDLING: Check for generic names or missing names (seen in STH51 logs)
          let finalName = device.deviceName;
          if (!finalName || finalName.startsWith('Station de base') || finalName === 'Sensore') {
            // If we have a generic name from the API, try to construct a better one
            // Format: "Type SN_Suffix" e.g. "STH51 3456"
            const suffix = (device.deviceSn || device.deviceSN || '').slice(-4);
            // Use type from device, fallback to 'Device'
            finalName = `${device.deviceType || 'Device'} ${suffix}`;
          }

          // Normalize device type - API may return 'type' or 'deviceType'
          const normalizedType = device.deviceType || device.type || '';
          
          const deviceData = {
            ...device,
            id: device.deviceId || device.deviceSn,
            stationId: station.stationId,
            houseId: house.houseId,
            houseName: house.houseName,
            stationName: station.stationName,
            mqttRegion: house.mqttRegion,
            devUserId: station.userId,
            deviceSn: device.deviceSn || device.deviceSN || device.sn,
            name: finalName, // Use our improved name
            deviceName: finalName,
            // Ensure both type and deviceType are set for driver compatibility
            type: normalizedType,
            deviceType: normalizedType
          };

          // STH51/STH54/STH0A FIX: Parse status.b and status.c for temperature/humidity
          if (device.status && (device.type === 'STH51' || device.type === 'STH54' || device.type === 'STH0A')) {
            const temp = parseFloat(device.status.b);
            const hum = parseFloat(device.status.c);

            if (!isNaN(temp)) {
              deviceData.temperature = temp;
              this.debug.log(`[XSenseAPI] Parsed temperature for ${device.type} ${device.deviceSn}: ${temp}°C`);
            }

            if (!isNaN(hum)) {
              deviceData.humidity = hum;
              this.debug.log(`[XSenseAPI] Parsed humidity for ${device.type} ${device.deviceSn}: ${hum}%`);
            }

            // Debug log sensor data
            this.debug.logSensorData(device.type, device.deviceSn, {
              temperature: deviceData.temperature,
              humidity: deviceData.humidity,
              batInfo: device.batInfo,
              rfLevel: device.rfLevel,
              online: device.online
            }, 'api-status');
          }

          this.devices.set(deviceData.id, deviceData);
          if (deviceData.deviceSn) {
            this.devicesBySn.set(deviceData.deviceSn, deviceData.id);
          }
          allDevices.push(deviceData);
        }
      }
    }

    // OPTIMIZATION v1.1.8: Parallel WiFi Shadow Fetching
    // Instead of fetching shadows sequentially in the loop above, we now fetch them all in parallel.
    // This reduces the total time from O(n * shadowFetchTime) to O(shadowFetchTime) for n devices.
    if (wifiStationsToEnrich.length > 0) {
      this.debug.log(`[XSenseAPI] Fetching WiFi shadows in parallel for ${wifiStationsToEnrich.length} devices...`);
      const startTime = Date.now();
      
      const wifiShadowPromises = wifiStationsToEnrich.map(async ({ station, house }) => {
        try {
          const wifiShadow = await this.getWiFiDeviceShadowFast(station);
          if (wifiShadow && Object.keys(wifiShadow).length > 0) {
            this.debug.log(`[XSenseAPI] Enriched ${station.stationSn} with WiFi Shadow data (Keys: ${Object.keys(wifiShadow).length})`);
            Object.assign(station, wifiShadow);
            
            // Also update the device in the devices map
            const deviceId = this.devicesBySn.get(station.stationSn);
            if (deviceId) {
              const device = this.devices.get(deviceId);
              if (device) {
                Object.assign(device, wifiShadow);
                // Update specific fields that might have been enriched
                device.onLine = station.onLine;
                device.wifiRssi = station.wifiRSSI || station.wifiRssi;
                device.alarmStatus = station.alarmStatus;
                device.muteStatus = station.muteStatus;
                device.coPpm = station.coPpm;
                device.coLevel = station.coLevel;
                device.batInfo = station.batInfo;
                device.temperature = station.temperature;
                device.humidity = station.humidity;
              }
            }
          }
        } catch (err) {
          this.debug.error(`[XSenseAPI] Failed to enrich WiFi device ${station.stationSn}:`, err.message);
        }
      });
      
      await Promise.all(wifiShadowPromises);
      const elapsed = Date.now() - startTime;
      this.debug.log(`[XSenseAPI] Parallel WiFi shadow fetch completed in ${elapsed}ms for ${wifiStationsToEnrich.length} devices`);
    }

    // Phase 2: Fetch and Process Shadows (Enrichment)
    // Now that all devices are in the maps, we can safely parse the shadows.
    // We process stations in parallel for performance.
    const stationPromises = allStations.map(async (station) => {
      try {
        // VITAL: Fetch station shadow to get status (2nd_systime / 2nd_device_info / 2nd_mainpage)
        const stationShadow = await this._getStationShadowData(station);
        if (stationShadow) {
          // Merge shadow data into the station object
          Object.assign(station, stationShadow);

          // Also update the "Device" representation of the station if it's an SC07-WX
          if (station.category === 'SC07-WX') {
            const deviceId = this.devicesBySn.get(station.stationSn);
            if (deviceId) {
              const device = this.devices.get(deviceId);
              Object.assign(device, stationShadow);
            }
          }
        }
      } catch (err) {
        this.debug.error(`[XSenseAPI] Failed to fetch shadow for station ${station.stationId}:`, err);
      }
    });

    // Also fetch House shadow if needed (optional, effectively handled inside getStationShadowData often)
    // but we might want to do it explicitly if needed.

    await Promise.all(stationPromises);

    this.debug.log(`[XSenseAPI] Found ${allDevices.length} devices in ${allStations.length} stations`);

    return {
      devices: allDevices,
      stations: allStations,
      houses: Array.from(this.houses.values())
    };
  }

  /**
   * Force sync a specific device/station status from Cloud
   * (Blocking call for onInit)
   */
  async syncDevice(deviceId) {
    if (!deviceId) return;
    const device = this.devices.get(deviceId);

    // If we don't know the device yet (fresh start of app and no getAllDevices run yet),
    // we might need to run full discovery. 
    if (!device) {
      this.debug.log('[XSenseAPI] Device not in cache, forcing full discovery...');
      await this.getAllDevices();
      return this.devices.get(deviceId);
    }

    // If we know the station, just refresh that station's shadows
    if (device.stationId) {
      const station = this.stations.get(device.stationId);
      if (station) {
        this.debug.log(`[XSenseAPI] Force syncing station ${station.stationSn} for device ${device.deviceSn}`);

        // 1. Fetch Shadows
        const shadows = await this._getStationShadowData(station);

        // 2. Process Shadows (Update Map)
        if (shadows) {
          // Merge station global data
          Object.assign(station, shadows);

          // If there are device details in shadow (e.g. 2nd_mainpage devs map)
          if (shadows.devs) {
            for (const [key, val] of Object.entries(shadows.devs)) {
              // Find device by SN (key is SN)
              const targetId = this.devicesBySn.get(key);
              if (targetId) {
                const existing = this.devices.get(targetId);
                const merged = { ...existing, ...val };

                // Sanitize critical fields
                merged.alarmStatus = DataSanitizer.toInt(merged.alarmStatus);
                merged.coPpm = DataSanitizer.toInt(merged.coPpm);

                this.devices.set(targetId, merged);
              }
            }
          }
        }
        return this.devices.get(deviceId);
      }
    }
    return device;
  }

  /**
   * Get devices for a specific station
   */
  async getDevices(stationId) {
    const station = this.stations.get(stationId);
    if (!station) {
      this.debug.log('[WARN]', `[XSenseAPI] Station ${stationId} not found`);
      return [];
    }

    const stationType = station.stationType || station.category || '';
    const serial = station.sn || station.stationSn || '';

    if (!stationType || !serial) {
      this.debug.log('[WARN]', `[XSenseAPI] Missing station identifiers for ${stationId}`);
      return [];
    }

    // Fetch shadow data to update cache
    try {
      await this._getStationShadowData(station);
    } catch (err) {
      this.debug.log('[WARN]', `[XSenseAPI] Failed to update shadow for station ${stationId}:`, err);
    }

    // Return devices from our cache (which is updated by _getStationShadowData via getAllDevices or periodic updates)
    const devices = [];
    for (const device of this.devices.values()) {
      if (device.stationId === stationId) {
        devices.push(device);
      }
    }
    return devices;
  }

  /**
   * Get station state
   */
  async getStationState(stationId) {
    const station = this.stations.get(stationId);
    if (!station) {
      return {};
    }

    const stationType = station.stationType || station.category || '';
    const serial = station.sn || station.stationSn || '';
    if (!stationType || !serial) {
      this.debug.log('[WARN]', `[XSenseAPI] Missing station identifiers for ${stationId}`);
      return {};
    }

    return await this._getStationShadowData(station);
  }

  /**
   * Try multiple possible thing names for a house shadow
   */
  async _getHouseShadowData(house) {
    const defaultCandidates = this._getHouseThingNames(house);

    // Attempt 1: Regular candidates with baseInfo/default shadow
    let shadow = await this._getThingShadowFromCandidates(defaultCandidates, ['baseInfo', null], house.mqttRegion);
    if (Object.keys(shadow).length > 0) return shadow;

    // Attempt 2: userId as Thing Name, houseId as Shadow Name
    // We need to find a userId. Houses don't have it directly, but stations do.
    // Try to find ANY station in this house to get the userId
    const stations = await this.getStations(house.houseId);
    const userId = stations[0]?.userId;

    if (userId) {
      this.debug.log(`[XSenseAPI] Trying userId ${userId} as ThingName for House ${house.houseId}`);
      // Try houseId as shadow name on the User Thing
      const userThingCandidates = [userId];
      const shadowNames = [house.houseId, `house_${house.houseId}`, null]; // Try Default Shadow too

      shadow = await this._getThingShadowFromCandidates(userThingCandidates, shadowNames, house.mqttRegion);
      if (Object.keys(shadow).length > 0) return shadow;
    }

    return {};
  }

  /**
   * Try multiple possible thing names for a station shadow
   */
  async _getStationShadowData(station) {
    // SPECIAL HANDLING for SC07-WX: Fetch and merge multiple specific shadows
    // These devices split data across '2nd_systime' (connectivity) and '2nd_info_SN' (battery/status)
    if (station.category === 'SC07-WX') {
      // this.debug.log(`[XSenseAPI] Fetching merged shadows for SC07-WX ${station.stationName}`);
      let mergedShadow = {};

      // 1. Fetch 2nd_systime (Status, RSSI)
      const shadow1 = await this._getThingShadowFromCandidates(
        this._getStationThingNames(station),
        ['2nd_systime'],
        station.mqttRegion
      );
      Object.assign(mergedShadow, shadow1);

      // 2. Fetch 2nd_info (Battery, advanced info)
      const shadow2 = await this._getThingShadowFromCandidates(
        this._getStationThingNames(station),
        [`2nd_info_${station.stationSn || station.sn}`],
        station.mqttRegion
      );
      Object.assign(mergedShadow, shadow2);

      // 3. Fetch Status / Alarm status (Added for CO fix)
      // Must match list in getWiFiDeviceShadow
      const sn = station.stationSn || station.sn;
      const statusShadowCandidates = [
        `2nd_status_${sn}`,
        `status_${sn}`,
        '2nd_status',
        'status',
        '2nd_alarm_status',
        'alarm_status',
        // Also try mainpage/pwordup if they are awake?
        '2nd_mainpage',
        'mainpage'
      ];

      const shadow3 = await this._getThingShadowFromCandidates(
        this._getStationThingNames(station),
        statusShadowCandidates,
        station.mqttRegion
      );
      Object.assign(mergedShadow, shadow3);

      if (Object.keys(mergedShadow).length > 0) {
        this.debug.log(`[XSenseAPI] Merged SC07-WX Shadow for ${station.stationSn}: Keys=${Object.keys(mergedShadow).join(',')}`);
        // this.debug.log(`[XSenseAPI] Merged Content:`, JSON.stringify(mergedShadow));
        return mergedShadow;
      }
    }

    const defaultCandidates = this._getStationThingNames(station);

    // Attempt 1: Prioritize discovered named shadows.
    // Ensure we don't waste time on 'baseInfo' or 'null' if we are looking for specific XSense shadows
    let shadow = await this._getThingShadowFromCandidates(defaultCandidates, [
      '2nd_mainpage',    // FOUND IN HA SCRIPTS: main aggregator for devices
      'mainpage',        // Fallback found in HA scripts
      '2nd_systime',     // Station status (contains RSSI)
      `2nd_info_${station.stationSn || station.sn}`, // FOUND IN PYTHON CODE for SC07-WX
      `info_${station.stationSn || station.sn}`,     // Fallback
      '2nd_device_info', // Worth retrying for SC07-WX
      'device_info',     // Common variation
      '2nd_status',      // Common variation
      '2nd_status',      // Common variation
      'status',          // Common variation
      // SC07-WX specific guesses based on mapping keys
      `2nd_status_${station.stationSn || station.sn}`,
      `status_${station.stationSn || station.sn}`,
      `2nd_alarm_status_${station.stationSn || station.sn}`,
      `alarm_status_${station.stationSn || station.sn}`,
      'alarm_status',    // Specific to alarms?
      '2nd_alarm_status', // Variation

      // CRITICAL: Documentation suggests 'baseInfo' or default (null) shadow might contain the data if 2nd_systime doesn't
      'baseInfo',
      null               // The "Classic" Unnamed Shadow
    ], station.mqttRegion);

    if (Object.keys(shadow).length > 0) {
      // Parse 'devs' map if present (2nd_mainpage standard)
      if (shadow.devs) {
        this.debug.log(`[XSenseAPI] Found 'devs' map in shadow! Parsing ${Object.keys(shadow.devs).length} devices.`);
        for (const [sn, data] of Object.entries(shadow.devs)) {
          // Find device by SN using cache - Case Insensitive Logic
          let deviceId = this.devicesBySn.get(sn) || this.devicesBySn.get(sn.toUpperCase());
          let device = deviceId ? this.devices.get(deviceId) : null;

          // Fallback linear search if strictly necessary, but cache should be good
          if (!device) {
            // Find ignoring case
            device = Array.from(this.devices.values()).find(d =>
              (d.deviceSn && d.deviceSn.toUpperCase()) === sn.toUpperCase()
            );
          }

          if (device) {
            Object.assign(device, data);
            // Map status properties if present
            if (data.status) {
              device.status = data.status; // Keep raw status

              // Standard Mappings
              if (data.status.alarmStatus) device.alarmStatus = data.status.alarmStatus;

              // X-Sense Minified Keys Mapping (Found in logs for STH51/SBS50 FW 1.6.9)
              // "a": "0" (Alarm?), "b": "21.0" (Temp), "c": "29.6" (Hum), "d": "1"
              if (data.status.b !== undefined) {
                device.temperature = parseFloat(data.status.b);
                // Ensure we set 'measure_temperature' capability-like property if needed by driver directly, 
                // though driver usually looks for .temperature or .temp
                this.debug.log(`[XSenseAPI] Found minified Temp (b): ${device.temperature} for ${sn}`);
              }
              if (data.status.c !== undefined) {
                device.humidity = parseFloat(data.status.c);
                this.debug.log(`[XSenseAPI] Found minified Hum (c): ${device.humidity} for ${sn}`);
              }
              if (data.status.a !== undefined) device.alarmStatus = data.status.a;
            }  // Map alarmStatus if present
            if (data.alarmStatus) device.alarmStatus = data.alarmStatus;
            // this.debug.log(`[XSenseAPI] Updated device ${sn} from shadow data`);
          } else {
            this.debug.log('[WARN]', `[XSenseAPI] Shadow data found for unknown device SN: ${sn}`);
          }
        }
      }

      // Debug: Log the ENTIRE shadow object to see structure
      this.debug.log(`[XSenseAPI] DEBUG: FULL SHADOW CONTENT for station ${station.stationId}:`, JSON.stringify(shadow, null, 2));
      return shadow;
    }

    // Fallback: Only check legacy/default shadows if the above failed
    shadow = await this._getThingShadowFromCandidates(defaultCandidates, ['baseInfo', null], station.mqttRegion);
    if (Object.keys(shadow).length > 0) return shadow;

    // Attempt 2: userId as Thing Name, stationId/stationSn as Shadow Name
    if (station.userId) {
      this.debug.log(`[XSenseAPI] Trying userId ${station.userId} as ThingName for Station ${station.stationId}`);
      const userThingCandidates = [station.userId];
      const shadowNames = [
        station.stationId,
        station.stationSn,
        `station_${station.stationId}`,
        `station_${station.stationSn}`,
        '2nd_systime', // Discovered via Spy Mode
        '2nd_device_info', // Potential other shadow
        null
      ];

      shadow = await this._getThingShadowFromCandidates(userThingCandidates, shadowNames, station.mqttRegion);
      if (Object.keys(shadow).length > 0) return shadow;
    }

    return {};
  }

  /**
   * Get WiFi device shadow (SC07-WX, XC01-WX, etc.)
   * WiFi devices use different shadow names than RF devices
   */
  async getWiFiDeviceShadow(station) {
    const thingName = this._buildStationShadowName(station);
    const region = station.mqttRegion || this.region;

    this.debug.log(`[XSenseAPI] Fetching WiFi device shadow: ${thingName}`);

    // Try primary shadows in order of importance
    // SC07-WX might use '2nd_mainpage' or 'status' for sensor data
    // CRITICAL: SC07-WX often appends the SN to the shadow name (e.g. 2nd_info_SN, 2nd_status_SN)
    const sn = station.stationSn || station.sn;
    // Optimized list: Only fetch what we know works or is essential
    let shadowNames = [
      // Metadata & Info (existing)
      '2nd_systime',        // Metadata (IP, RSSI, FW) - WORKS
      `2nd_info_${sn}`,     // Static info (MAC, etc) - WORKS
      `info_${sn}`,         // WiFi device info (XS01-WX, XP0A-iR) - BATTERY DATA!

      // WiFi Device Mode & Config (NEW - from Android APK analysis)
      `mode_${sn}`,         // WiFi device mode settings
      'mode',               // Fallback without SN

      // CO & Alarm Status (NEW - based on HA Integration & Python XSense)
      '2nd_alarm_status',           // Primary CO data source
      `2nd_alarm_status_${sn}`,     // Device-specific alarm status
      'alarm_status',                // Fallback without prefix
      `alarm_status_${sn}`,          // Legacy naming

      // Sensor Data (NEW - for temp/hum/CO readings)
      '2nd_sensor_data',             // Consolidated sensor readings
      `2nd_sensor_data_${sn}`,       // Device-specific sensors
      'sensor_data',                 // Fallback
      `sensor_${sn}`,                // Alternative naming

      // Status Shadows (existing)
      `2nd_status_${sn}`,
      '2nd_status',
      'status',                      // Fallback without prefix

      // These usually 404 on sleeping devices but are the source of truth for sensors.
      // We keep them in case the device IS awake, but we expect them to fail often.
      'mainpage',
      'pwordup'
    ];

    // Also try without prefix if needed
    const altThingName = station.stationSn;

    // EXTENDED GUESSING LIST REMOVED - Caused too many 404s

    let aggregatedData = {};

    for (const shadowName of shadowNames) {
      try {
        let shadow = await this.getThingShadow(thingName, shadowName, region);

        // DEBUG: Explicitly log result for mainpage/pwordup/status to see WHY they fail
        // if (['mainpage', 'pwordup'].includes(shadowName)) {
        //      const keyCount = shadow ? Object.keys(shadow).length : 0;
        //      this.debug.log(`[XSenseAPI] DEBUG: Fetch ${shadowName} for ${thingName} result: Keys=${keyCount}`, shadow ? JSON.stringify(shadow) : 'NULL');
        // }

        // Fallback: Try alternative Thing Name (SN only) if primary failed
        if (!shadow || Object.keys(shadow).length === 0) {
          try {
            const altShadow = await this.getThingShadow(altThingName, shadowName, region);
            if (altShadow && Object.keys(altShadow).length > 0) {
              // this.debug.log(`[XSenseAPI] Found data in ${shadowName} using Alt-ThingName ${altThingName}`);
              shadow = altShadow;
            }
          } catch (ignore) { }
        }


        if (shadow && Object.keys(shadow).length > 0) {
          this.debug.log(`[XSenseAPI] Found '${shadowName}' shadow for ${thingName} (${Object.keys(shadow).length} keys)`);

          // DEBUG: Dump shadow to file for analysis
          this.debug.dumpShadow(thingName, shadowName, shadow, {
            deviceType: station.category,
            stationSn: station.stationSn,
            region
          });

          Object.assign(aggregatedData, shadow);


          // SC07-WX Special: Status might be nested in "status" property or just flat
          // If we found a status shadow, ensuring we map the internal status if needed
          if (shadow.status) {
            this.debug.log(`[XSenseAPI] Found 'status' object in ${shadowName}`);
            Object.assign(aggregatedData, shadow.status);
          }

          // SC07-WX CO Data Parsing (NEW)
          if (shadow.coPpm !== undefined || shadow.coLevel !== undefined || shadow.co !== undefined) {
            this.debug.log(`[XSenseAPI] Found CO data in ${shadowName}: coPpm=${shadow.coPpm}, coLevel=${shadow.coLevel}, co=${shadow.co}`);
            aggregatedData.coPpm = shadow.coPpm || shadow.co;
            aggregatedData.coLevel = shadow.coLevel;
          }

          // Temperature & Humidity (might be in alarm_status shadow too)
          if (shadow.temperature !== undefined || shadow.temp !== undefined) {
            this.debug.log(`[XSenseAPI] Found temperature in ${shadowName}: ${shadow.temperature || shadow.temp}`);
            aggregatedData.temperature = shadow.temperature || shadow.temp;
          }
          if (shadow.humidity !== undefined || shadow.humi !== undefined) {
            this.debug.log(`[XSenseAPI] Found humidity in ${shadowName}: ${shadow.humidity || shadow.humi}`);
            aggregatedData.humidity = shadow.humidity || shadow.humi;
          }

          // Battery Info
          if (shadow.batInfo !== undefined || shadow.battery !== undefined) {
            aggregatedData.batInfo = shadow.batInfo || shadow.battery;
          }
        } else {
          // this.debug.log(`[XSenseAPI] Shadow ${shadowName} is empty for ${thingName}`);
        }
      } catch (error) {
        this.debug.log('[WARN]', `[XSenseAPI] Failed to get ${shadowName} shadow for ${thingName}:`, error.message);
      }
    }

    return aggregatedData;
  }

  /**
   * OPTIMIZATION v1.1.8: Fast WiFi Device Shadow fetch for pairing
   * Only fetches the essential shadows needed for device listing.
   * This reduces the number of API calls from 17+ to just 3-4 per device.
   * Full shadow data is fetched later during device initialization.
   */
  async getWiFiDeviceShadowFast(station) {
    const thingName = this._buildStationShadowName(station);
    const region = station.mqttRegion || this.region;
    const sn = station.stationSn || station.sn;

    // MINIMAL shadow list for fast pairing - only what's needed to identify and list devices
    // Full data will be fetched when device is actually added
    const essentialShadows = [
      `info_${sn}`,           // Device info (battery, firmware) - most important
      `2nd_info_${sn}`,       // Alternative info format
      'mainpage'              // Basic status
    ];

    let aggregatedData = {};

    // Fetch all essential shadows in parallel for maximum speed
    const shadowPromises = essentialShadows.map(async (shadowName) => {
      try {
        const shadow = await this.getThingShadow(thingName, shadowName, region);
        if (shadow && Object.keys(shadow).length > 0) {
          this.debug.log(`[XSenseAPI] SUCCESS: Found shadow! Thing=${thingName}, Shadow=${shadowName}`);
          return { shadowName, shadow };
        }
      } catch (error) {
        // Silently ignore - many shadows don't exist
      }
      return null;
    });

    const results = await Promise.all(shadowPromises);
    
    // Merge all successful results
    for (const result of results) {
      if (result && result.shadow) {
        Object.assign(aggregatedData, result.shadow);
        
        // Extract nested status if present
        if (result.shadow.status) {
          Object.assign(aggregatedData, result.shadow.status);
        }
        
        // Battery Info
        if (result.shadow.batInfo !== undefined || result.shadow.battery !== undefined) {
          aggregatedData.batInfo = result.shadow.batInfo || result.shadow.battery;
        }
      }
    }

    return aggregatedData;
  }

  /**
   * Helper to list named shadows using REST API (standard AWS IoT endpoint /api/things/...)
   */
  async _listNamedShadowsForThing(thingName, mqttRegion = null) {
    const region = mqttRegion || this.region;
    // Per AWS IoT docs: GET /api/things/{thingName}/shadow
    const url = `https://${region}.x-sense-iot.com/api/things/${thingName}/shadow`;

    const idx = `${thingName}:list_shadows`;
    const failureCount = this.shadowFailureCount?.get(idx) || 0;
    if (failureCount > 3) return null;

    if (!this.awsAccessKeyId || !this.awsSecretAccessKey || !this.awsSessionToken) {
      return null;
    }

    const headers = this._signAWSRequest({
      method: 'GET',
      url,
      region,
      service: 'iotdata',
      payload: ''
    });
    // headers['Content-Type'] = 'application/json'; // Not strictly needed for GET but safe?

    try {
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        this.debug.log('[WARN]', `[XSenseAPI] List shadows failed: ${response.status} ${response.statusText} for ${url}`);
        // this.shadowFailureCount?.set(idx, failureCount + 1); // Don't block retries during debug
        return null;
      }
      const data = await response.json();
      // timestamp, results, nextToken
      return data;
    } catch (err) {
      this.debug.log('[WARN]', `[XSenseAPI] List shadows error:`, err);
      return null;
    }
  }

  /**
   * Request temperature/humidity data sync for STH51 devices
   * Sends a shadow update to trigger server-side data push
   */
  async requestTempDataSync(stationId, deviceIds) {
    // this.debug.log(`[XSenseAPI] Requesting temp data sync for station ${stationId}, devices:`, deviceIds);

    // Ensure tokens are valid
    await this._ensureAWSTokens();

    const station = this.stations.get(stationId);
    if (!station) {
      this.debug.log('[WARN]', `[XSenseAPI] Station ${stationId} not found`);
      return;
    }

    const thingName = this._buildStationShadowName(station);
    const shadowName = '2nd_apptempdata';

    // Build SyncTempDataBean payload
    const payload = {
      state: {
        desired: {
          shadow: "appTempData",
          stationSN: station.stationSn,
          deviceSN: deviceIds,           // Array of device SNs
          source: "1",                   // App source
          report: "1",                   // Enable reporting
          reportDst: "",                 // Empty or specific destination
          timeoutM: "5"                  // 5 minute timeout
        }
      }
    };

    // Use Thing Shadow API to update
    const region = station.mqttRegion || this.region;
    const url = `https://${region}.x-sense-iot.com/things/${thingName}/shadow?name=${shadowName}`;

    const headers = this._signAWSRequest({
      method: 'POST',
      url,
      region,
      service: 'iotdata',
      payload: JSON.stringify(payload)
    });
    headers['Content-Type'] = 'application/json';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        // const text = await response.text();
        // this.debug.error(`[XSenseAPI] Shadow update failed: ${response.status} ${text}`);
        return false;
      }

      this.debug.log(`[XSenseAPI] Temp data sync requested successfully for ${station.stationName}`);
      return true;
    } catch (error) {
      this.debug.error(`[XSenseAPI] Failed to request temp data sync:`, error.message);
      return false;
    }
  }

  _buildStationShadowName(station) {
    let type = station.stationType || station.category || '';

    // SC07-WX uses "-" as separator (e.g. SC07-WX-12345678)
    if (type === 'SC07-WX' || type === 'XC01-WX' || type === 'XH02-WX' || type === 'XS01-WX') {
      const serial = station.stationSn || station.sn || '';
      return `${type}-${serial}`;
    }

    // SBS10 has no Type-Prefix? (Legacy logic, keeping safe)
    if (type === 'SBS10') {
      type = '';
    }

    const serial = station.stationSn || station.sn || '';
    return `${type}${serial}`;
  }

  _getStationThingNames(station) {
    const names = [];

    // Primary Candidate: The correctly built Thing Name
    const builtName = this._buildStationShadowName(station);
    if (builtName) names.push(builtName);

    // Fallbacks
    const add = (value) => {
      if (value) {
        const trimmed = value.trim();
        if (trimmed && !names.includes(trimmed)) {
          names.push(trimmed);
        }
      }
    };

    const addVariants = (value) => {
      if (!value) return;
      add(value);
      add(value.toLowerCase());
      add(value.toUpperCase());
    };

    const stationType = station.stationType || station.category || '';
    const stationTypeLower = stationType.toLowerCase();
    const serial = station.sn || station.stationSn || '';
    const stationSn = station.stationSn || '';
    const stationId = station.stationId || station.id || '';
    const houseId = station.houseId || station.house_id || '';

    const typeVariants = [stationType, stationTypeLower];
    const serialVariants = [serial, stationSn];

    for (const type of typeVariants) {
      for (const ser of serialVariants) {
        if (!type || !ser) continue;
        addVariants(`${type}${ser}`);
        addVariants(`${type}_${ser}`);
        addVariants(`${type}-${ser}`);
        addVariants(`${type}SN${ser}`);
        addVariants(`${type}_SN${ser}`);
        addVariants(`${type}-SN-${ser}`);
      }
    }

    addVariants(serial);
    addVariants(stationSn);
    addVariants(stationId);

    if (stationId) {
      addVariants(`station_${stationId}`);
      addVariants(`station-${stationId}`);
      addVariants(`station${stationId}`);
    }

    if (serial) {
      addVariants(`station_${serial}`);
      addVariants(`station-${serial}`);
      addVariants(`station${serial}`);
    }

    if (houseId && stationId) {
      addVariants(`${houseId}_${stationId}`);
      addVariants(`${houseId}-${stationId}`);
      addVariants(`${houseId}${stationId}`);
    }

    if (houseId && serial) {
      addVariants(`${houseId}_${serial}`);
      addVariants(`${houseId}-${serial}`);
      addVariants(`${houseId}${serial}`);
    }

    return names;
  }

  _getHouseThingNames(house) {
    const names = [];
    const add = (value) => {
      if (value) {
        const trimmed = value.trim();
        if (trimmed && !names.includes(trimmed)) {
          names.push(trimmed);
        }
      }
    };

    const addVariants = (value) => {
      if (!value) return;
      add(value);
      add(value.toLowerCase());
      add(value.toUpperCase());
    };

    const houseId = house.houseId || house.id || '';
    const houseName = (house.houseName || '').replace(/\s+/g, '_');

    addVariants(`house_${houseId}`);
    addVariants(`house-${houseId}`);
    addVariants(`house${houseId}`);
    addVariants(houseId);
    addVariants(houseName ? `house_${houseName}` : '');
    addVariants(houseName);

    return names;
  }

  async _getThingShadowFromCandidates(thingCandidates, shadowCandidates = ['baseInfo', null], region) {
    const fetchRegion = region || this.region;

    // Normalize shadow candidates (convert null to null, strings to string)
    const normalizedShadows = shadowCandidates.map(s => s === 'null' ? null : s);

    let aggregatedShadow = {};
    let foundAny = false;

    for (const thingName of thingCandidates) {
      if (!thingName) continue;

      let foundForThisThing = false;

      for (const shadowName of normalizedShadows) {
        // Skip if we've failed this specific combination too many times
        const shadowKey = `${thingName}:${shadowName || 'default'}`;
        if ((this.shadowFailureCount.get(shadowKey) || 0) > 5) {
          continue;
        }

        const shadow = await this.getThingShadow(
          thingName,
          shadowName,
          fetchRegion
        );

        if (shadow && Object.keys(shadow).length > 0) {
          this.debug.log(`[XSenseAPI] SUCCESS: Found shadow! Thing=${thingName}, Shadow=${shadowName || 'default'}`);

          Object.assign(aggregatedShadow, shadow);
          if (shadow.state && shadow.state.reported) {
            if (!aggregatedShadow.state) aggregatedShadow.state = { reported: {} };
            if (!aggregatedShadow.state.reported) aggregatedShadow.state.reported = {};
            Object.assign(aggregatedShadow.state.reported, shadow.state.reported);
          }

          foundAny = true;
          foundForThisThing = true;
        }
      }

      if (foundForThisThing) {
        return aggregatedShadow;
      }
    }

    return {};
  }

  /**
   * Sign AWS Thing Shadow requests using SigV4
   */
  _signAWSRequest({ method, url, region, service, payload = '' }) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.substring(0, 8);

    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const canonicalUri = parsedUrl.pathname || '/';

    const queryEntries = Array.from(parsedUrl.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    const canonicalQuerystring = queryEntries.join('&');

    const canonicalHeadersList = [
      ['host', host],
      ['x-amz-date', amzDate]
    ];

    if (this.awsSessionToken) {
      canonicalHeadersList.push(['x-amz-security-token', this.awsSessionToken]);
    }

    canonicalHeadersList.sort(([a], [b]) => a.localeCompare(b));

    const canonicalHeaders = canonicalHeadersList
      .map(([key, value]) => `${key}:${value}`)
      .join('\n') + '\n';

    const signedHeaders = canonicalHeadersList
      .map(([key]) => key)
      .join(';');

    const payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    const signingKey = this._getSignatureKey(this.awsSecretAccessKey, dateStamp, region, service);
    const signature = crypto.createHmac('sha256', signingKey)
      .update(stringToSign, 'utf8')
      .digest('hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${this.awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const signedHeadersObject = {
      Host: host,
      'X-Amz-Date': amzDate,
      Authorization: authorizationHeader
    };

    if (this.awsSessionToken) {
      signedHeadersObject['X-Amz-Security-Token'] = this.awsSessionToken;
    }

    return signedHeadersObject;
  }

  _getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    return kSigning;
  }

  /**
   * Test device alarm
   */
  /**
   * Helper to get active MQTT client for a device
   * @private
   */
  _getMqttClientForDevice(device) {
    if (!device) return null;

    // Check by houseId (standard)
    const houseClient = this.mqttClients.get(device.houseId);
    if (houseClient && houseClient.client && houseClient.client.connected) {
      return houseClient.client;
    }

    // Check by legacy station key
    const legacyKey = `legacy:${device.stationId}`;
    const legacyClient = this.mqttClients.get(legacyKey);
    if (legacyClient && legacyClient.client && legacyClient.client.connected) {
      return legacyClient.client;
    }

    // Fallback: use first connected client (best effort)
    for (const info of this.mqttClients.values()) {
      if (info.client && info.client.connected) {
        return info.client;
      }
    }

    return null;
  }

  /**
   * Test device alarm
   * Uses MQTT Shadow update to trigger a test beep
   */
  async testAlarm(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('Device not found');

    const type = (device.deviceType || device.type || '').toUpperCase();
    const sn = device.deviceSn || device.sn;
    const client = this._getMqttClientForDevice(device);

    if (!client) {
      throw new Error('MQTT Client not connected. Alarm test requires real-time connection.');
    }

    this.debug.log(`[XSenseAPI] Triggering Test Alarm for ${type} (${sn})`);

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const isWiFiDevice = ['SC07-WX', 'XC01-WX', 'XH02-WX', 'XS01-WX', 'XC04-WX', 'XP0A-iR', 'XP0A-MR', 'XP0A'].some(t => type.includes(t));

    // Shadow name based on Home Assistant integration
    const shadowName = isWiFiDevice ? `appselftest_${sn}` : `2nd_selftest_${sn}`;
    const thingName = this._buildStationShadowName(device);
    const topic = `$aws/things/${device.userId || thingName}/shadow/name/${shadowName}/update`;

    const payload = {
      state: {
        desired: {
          deviceSN: sn,
          shadow: shadowName,
          stationSN: device.stationSn || sn,
          time: timestamp,
          userId: device.devUserId || device.userId,
          // Extra field for trigger
          test: "1"
        }
      }
    };

    return new Promise((resolve, reject) => {
      this.debug.log(`[XSenseAPI] Publishing Test to ${topic}`);
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          this.debug.error(`[XSenseAPI] Failed to publish Test: ${err.message}`);
          return reject(err);
        }
        this.debug.log(`[XSenseAPI] Test command sent to ${sn}`);
        resolve(true);
      });
    });
  }

  /**
   * Mute device alarm
   * Uses MQTT Shadow update to silence the alarm
   */
  async muteAlarm(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('Device not found');

    const stationSn = device.stationSn || device.deviceSn;
    const type = device.deviceType || device.type;
    const client = this._getMqttClientForDevice(device);

    if (!client) {
      throw new Error('MQTT Client not connected');
    }

    this.debug.log(`[XSenseAPI] Muting alarm for ${type} (${device.deviceSn}) on Station ${stationSn}`);

    // Construct Payload
    // Based on docs: 2nd_muteup or mutekey
    let topic, payload;

    if (type === 'SC07-WX' || type === 'XC01-WX') {
      topic = `$aws/things/${device.userId}/shadow/name/mutekey/update`;
      payload = { state: { desired: { mute: "1" } } };
    } else {
      topic = `$aws/things/${device.userId}/shadow/name/2nd_muteup/update`;
      payload = {
        state: {
          desired: {
            muteStatus: "1",
            deviceSN: device.deviceSn
          }
        }
      };
    }

    return new Promise((resolve, reject) => {
      this.debug.log(`[XSenseAPI] Publishing Mute to ${topic}`);
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  /**
   * Connect to MQTT for real-time updates (Mutex Protected)
   */
  async connectMQTT(houseId, stationId) {
    return this.mqttMutex.runExclusive(async () => {
      return this._connectMQTTInternal(houseId, stationId);
    });
  }

  /**
   * Connect to MQTT for real-time updates (Internal)
   */
  async _connectMQTTInternal(houseId, stationId) {
    await this._ensureAWSTokens();

    const legacyConfig = await this.getLegacyMqttConfig(stationId);
    if (legacyConfig) {
      const broker = legacyConfig.broker || legacyConfig.url || legacyConfig.host;
      const username = legacyConfig.username || legacyConfig.user;
      const password = legacyConfig.password || legacyConfig.pass;
      const clientId = legacyConfig.clientId || `homey_${stationId}_${Date.now()}`;

      if (broker && username && password) {
        const mqttKey = `legacy:${stationId}`;
        if (this.mqttClients.has(mqttKey)) {
          return this.mqttClients.get(mqttKey).client;
        }

        this.debug.log(`[XSenseAPI] Using legacy MQTT config for station ${stationId}`);
        const client = mqtt.connect(broker, {
          clientId,
          username,
          password,
          clean: true,
          reconnectPeriod: 5000,
          rejectUnauthorized: false
        });

        const info = {
          client,
          house: { houseId },
          subscriptions: new Set(),
          wsPath: null
        };

        this.mqttClients.set(mqttKey, info);
        client.on('connect', () => {
          this.debug.log(`[XSenseAPI] Legacy MQTT connected for station ${stationId}`);
          this._subscribeLegacyTopics(info, houseId, stationId);
        });

        client.on('message', (topic, payload) => {
          this._handleMQTTMessage(topic, payload);
        });

        client.on('error', (error) => {
          this.debug.error('[XSenseAPI] Legacy MQTT error:', error && error.message ? error.message : error);
        });

        return client;
      }
    }

    const house = this._resolveHouse(houseId, stationId);
    if (!house) {
      this.debug.log('[WARN]', '[XSenseAPI] Cannot resolve house for MQTT connection');
      return null;
    }

    const mqttKey = house.houseId;
    if (this.mqttClients.has(mqttKey)) {
      const info = this.mqttClients.get(mqttKey);
      this._subscribeStationTopics(info, stationId);
      return info.client;
    }

    if (!this.awsSigner) {
      this.awsSigner = new AwsSigner(
        this.awsAccessKeyId,
        this.awsSecretAccessKey,
        this.awsSessionToken
      );
    }

    const baseUrl = `wss://${house.mqttServer}`;
    const presignBaseUrl = `wss://${house.mqttServer}/mqtt`;

    const debugConfig = this._getSignerDebugConfig();
    const signerDebugEnabled = process.env.XSENSE_SIGNER_DEBUG === '1' || (debugConfig && debugConfig.enabled);
    const signerDebugFixedDate = process.env.XSENSE_SIGNER_DEBUG_TIME || (debugConfig && debugConfig.fixedDate) || null;

    if (signerDebugEnabled && this.awsSigner && this.awsSigner.useAws4) {
      this.debug.log('[XSenseAPI] SIGNER DEBUG forcing custom signer (useAws4=false)');
      this.awsSigner.useAws4 = false;
    }

    const logSignerDebug = (debug) => {
      if (this._signerDebugLogged) {
        return;
      }
      this._signerDebugLogged = true;
      this.debug.log('[XSenseAPI] SIGNER DEBUG BEGIN');
      const lines = [
        `amzDate=${debug.amzDate || ''}`,
        `dateStamp=${debug.dateStamp || ''}`,
        `credentialScope=${debug.credentialScope || ''}`,
        `credential=${debug.credential || ''}`,
        `canonicalQuerystring=${debug.canonicalQuerystring || ''}`,
        `canonicalHeaders=${JSON.stringify(debug.canonicalHeaders || '')}`,
        `payloadHash=${debug.payloadHash || ''}`,
        `canonicalRequest=${JSON.stringify(debug.canonicalRequest || '')}`,
        `stringToSign=${JSON.stringify(debug.stringToSign || '')}`,
        `signature=${debug.signature || ''}`,
        `requestQuery=${debug.requestQuery || ''}`,
        `host=${debug.host || ''}`,
        `path=${debug.path || ''}`,
        `fixedDate=${debug.fixedDate || ''}`
      ];
      for (const line of lines) {
        this.debug.log(`[XSenseAPI] SIGNER DEBUG ${line}`);
      }
      this.debug.log('[XSenseAPI] SIGNER DEBUG END');
    };

    const presignPath = (reason) => {
      let signedUrl;
      if (signerDebugEnabled) {
        const result = this.awsSigner.presignWebsocketUrlWithDebug(
          presignBaseUrl,
          house.mqttRegion,
          signerDebugFixedDate ? { fixedDate: signerDebugFixedDate } : {}
        );
        signedUrl = result.url;
        if (result.debug) {
          logSignerDebug(result.debug);
        }
      } else {
        signedUrl = this.awsSigner.presignWebsocketUrl(presignBaseUrl, house.mqttRegion);
      }
      let rawPath = '/mqtt';
      const schemeIndex = signedUrl.indexOf('://');
      if (schemeIndex !== -1) {
        const pathIndex = signedUrl.indexOf('/', schemeIndex + 3);
        if (pathIndex !== -1) {
          rawPath = signedUrl.substring(pathIndex);
        }
      }
      try {
        const parsed = new URL(signedUrl);
        const queryPreview = parsed.search ? parsed.search.substring(0, 80) : '';
        if (this.awsSigner.lastAmzDate) {
          this.debug.log(`[XSenseAPI] MQTT presign time local=${this.awsSigner.lastLocalIso} amz=${this.awsSigner.lastAmzDate}`);
        }
        this.debug.log(`[XSenseAPI] MQTT presign (${reason || 'initial'}) host=${parsed.host} path=${parsed.pathname} query=${queryPreview}...`);
        return rawPath;
      } catch (error) {
        this.debug.error('[XSenseAPI] Failed to inspect presigned MQTT URL:', error.message);
        return rawPath;
      }
    };

    let currentPath = presignPath('connect');

    const origin = `https://${house.mqttServer}`;
    const client = mqtt.connect(baseUrl, {
      protocolVersion: 5, // Updated from 4 to 5 (MQTT v5.14.1)
      clean: true,
      reconnectPeriod: 30000,
      username: '?SDK=iOS&Version=2.26.5',
      password: '',
      rejectUnauthorized: false,
      clientId: `homey_${house.houseId}_${Date.now()}`,
      path: currentPath,
      transformWsUrl: (url) => {
        this.debug.log(`[XSenseAPI] MQTT ws url: ${url}`);
        return url;
      },
      wsOptions: {
        headers: {
          Host: house.mqttServer,
          Origin: origin
        },
        perMessageDeflate: false,
        servername: house.mqttServer
      }
    });

    const info = {
      client,
      house,
      subscriptions: new Set(),
      wsPath: currentPath
    };

    this.mqttClients.set(mqttKey, info);

    const logWsHeaders = (reason) => {
      const ws = client.stream && client.stream.ws ? client.stream.ws : null;
      const req = ws && ws._req ? ws._req : null;
      if (!req) {
        return;
      }
      const headerLines = [];
      if (typeof req.getHeader === 'function') {
        const keys = ['host', 'origin', 'sec-websocket-protocol', 'sec-websocket-extensions', 'user-agent', 'connection', 'upgrade'];
        for (const key of keys) {
          const value = req.getHeader(key);
          if (value !== undefined) {
            headerLines.push(`${key}: ${value}`);
          }
        }
      }
      if (req._header) {
        headerLines.push('raw: ' + req._header.replace(/\r?\n/g, ' | '));
      }
      if (headerLines.length) {
        this.debug.log(`[XSenseAPI] MQTT ws request headers (${reason}): ${headerLines.join(' ; ')}`);
      }

      if (ws && typeof ws.on === 'function' && !ws.__xsenseUnexpectedHandler) {
        ws.__xsenseUnexpectedHandler = true;
        ws.on('unexpected-response', (request, response) => {
          const status = response && response.statusCode ? response.statusCode : 'unknown';
          const statusMessage = response && response.statusMessage ? response.statusMessage : '';
          this.debug.error(`[XSenseAPI] MQTT unexpected response: ${status} ${statusMessage}`);
          if (response && response.headers) {
            this.debug.error(`[XSenseAPI] MQTT unexpected headers: ${JSON.stringify(response.headers)}`);
          }
          let body = '';
          if (response) {
            response.on('data', (chunk) => {
              body += chunk.toString();
            });
            response.on('end', () => {
              if (body) {
                this.debug.error(`[XSenseAPI] MQTT unexpected body: ${body}`);
              }
            });
          }
        });
      }
    };

    setTimeout(() => logWsHeaders('initial'), 0);

    const refreshPath = (reason) => {
      const newPath = presignPath(reason);
      if (newPath && newPath !== info.wsPath) {
        client.options.path = newPath;
        info.wsPath = newPath;
      }
    };

    client.on('connect', () => {
      logWsHeaders('connect');
      refreshPath('on-connect');
      this.debug.log(`[XSenseAPI] MQTT connected for house ${house.houseId}`);

      // Notify Homey about MQTT health (NEW)
      this._notifyMQTTHealth(house.houseId, true);

      this._subscribeHouseTopics(info);
      for (const station of this._getStationsByHouse(house.houseId)) {
        this._subscribeStationTopics(info, station.stationId);
      }
      if (stationId) {
        this._subscribeStationTopics(info, stationId);
      }
    });

    // MQTT Signature Auto-Refresh (NEW)
    // AWS IoT WebSocket signatures expire after 15 minutes
    // Refresh every 10 minutes to prevent disconnects
    const signatureRefreshInterval = setInterval(() => {
      if (client.connected) {
        this.debug.log('[XSenseAPI] MQTT signature refresh triggered (10min timer)');
        const newPath = presignPath('signature-refresh');
        if (newPath) {
          client.options.path = newPath;
          info.wsPath = newPath;

          // Graceful reconnect with new signature
          client.end(false, () => {
            this.debug.log('[XSenseAPI] MQTT reconnecting with fresh signature...');
            client.reconnect();
          });
        }
      }
    }, 600000); // 10 minutes (600000ms)

    // Store interval ID for cleanup
    info.signatureRefreshInterval = signatureRefreshInterval;

    client.on('reconnect', () => {
      refreshPath('reconnect');
    });

    client.on('message', (topic, payload) => {
      this._handleMQTTMessage(topic, payload);
    });

    client.on('error', (error) => {
      const wsUrl = client.stream && client.stream.url ? client.stream.url : 'unknown';
      this.debug.error('[XSenseAPI] MQTT error:', error && error.message ? error.message : error);
      this.debug.error(`[XSenseAPI] MQTT ws url (error): ${wsUrl}`);

      // Notify Homey about MQTT health (NEW)
      this._notifyMQTTHealth(house.houseId, false);
    });

    client.stream.on('close', (code, reason) => {
      const wsUrl = client.stream && client.stream.url ? client.stream.url : 'unknown';
      this.debug.log('[WARN]', `[XSenseAPI] MQTT stream closed: code=${code}, reason=${reason}`);
      this.debug.log('[WARN]', `[XSenseAPI] MQTT ws url (close): ${wsUrl}`);

      // Notify Homey about MQTT health (NEW)
      this._notifyMQTTHealth(house.houseId, false);
    });

    client.stream.on('error', (error) => {
      const wsUrl = client.stream && client.stream.url ? client.stream.url : 'unknown';
      this.debug.error('[XSenseAPI] MQTT stream error:', error && error.message ? error.message : error);
      this.debug.error(`[XSenseAPI] MQTT ws url (stream error): ${wsUrl}`);
    });

    return client;
  }

  _subscribeLegacyTopics(info, houseId, stationId) {
    const topics = [
      `house/${houseId}/event`,
      `house/${houseId}/shadow/+/update`,
      `house/${houseId}/presence/station/${stationId}`
    ];

    this._subscribeTopic(info, topics);
  }

  _subscribeHouseTopics(info) {
    const topics = [
      `@xsense/events/+/${info.house.houseId}`,
      `$aws/things/${info.house.houseId}/shadow/name/+/update`
    ];

    // Add subscription for userId-based shadow updates if userId is known for this house
    if (info.house.userId) {
      // Try both house ID and 'house_ID' as shadow names
      topics.push(`$aws/things/${info.house.userId}/shadow/name/${info.house.houseId}/update`);
      topics.push(`$aws/things/${info.house.userId}/shadow/name/house_${info.house.houseId}/update`);
      // Wildcard for named shadows (DISCOVERY)
      topics.push(`$aws/things/${info.house.userId}/shadow/name/+/update`);
      // Classic Shadow (Default)
      topics.push(`$aws/things/${info.house.userId}/shadow/update`);
    }

    // SPY MODE: Try to catch anything (Unconditional)
    this.debug.log('[XSenseAPI] Enabling Spy Mode for House', info.house.houseId);
    topics.push('xsense/#');
    topics.push('events/#');
    topics.push('device/#');
    topics.push('station/#');
    topics.push('+');
    topics.push('+/+');
    topics.push('+/+/+');

    this._subscribeTopic(info, topics);
  }

  _subscribeStationTopics(info, stationId) {
    if (!stationId) {
      return;
    }
    const station = this.stations.get(stationId);
    if (!station) {
      return;
    }

    const allTopics = new Set();

    // Determine if this is a WiFi-Direct Device
    // Extended list to include all known WiFi device types
    const wifiDeviceCategories = [
      'SC07-WX', 'XC01-WX', 'XH02-WX', 'XS01-WX', 'XC04-WX',
      'XP0A-iR', 'XP0A-MR', 'XP0A', 'SC01-WX', 'SC04-WX'
    ];
    const isWiFiDevice = wifiDeviceCategories.some(type =>
      station.category === type || station.category?.startsWith(type.split('-')[0])
    );
    const typeSnThing = this._buildStationShadowName(station);

    if (isWiFiDevice && typeSnThing) {
      this.debug.log(`[XSenseAPI] Subscribing to WiFi Device topics for ${station.stationName} (${typeSnThing})`);

      [
        // Primary Status Shadow
        `$aws/things/${typeSnThing}/shadow/name/mainpage/update`,
        `$aws/things/${typeSnThing}/shadow/name/mainpage/update/accepted`,
        `$aws/things/${typeSnThing}/shadow/name/mainpage/update/delta`,

        // Power Up & Config Shadow
        `$aws/things/${typeSnThing}/shadow/name/pwordup/update`,

        // Mute Status Shadow
        `$aws/things/${typeSnThing}/shadow/name/muteup/update`,

        // System Time/Status Shadow
        `$aws/things/${typeSnThing}/shadow/name/2nd_systime/update`,

        // Default Shadow (Fallback)
        `$aws/things/${typeSnThing}/shadow/update`,

        // Discovery Wildcard
        `$aws/things/${typeSnThing}/shadow/name/+/update`
      ].forEach(t => allTopics.add(t));

      // WiFi Devices (SC07-WX, etc)
      if (['SC07-WX', 'XC01-WX', 'XH02-WX'].includes(station.category) || station.category.endsWith('-WX')) {
        const thingName = this._buildStationShadowName(station);

        // CORRECTION: use $aws/things/... format (standard AWS IoT), NOT sns/iot/...
        [
          `$aws/things/${thingName}/shadow/name/mainpage/update`,
          `$aws/things/${thingName}/shadow/name/mainpage/update/accepted`,
          `$aws/things/${thingName}/shadow/name/mainpage/update/delta`,

          `$aws/things/${thingName}/shadow/name/pwordup/update`,
          `$aws/things/${thingName}/shadow/name/pwordup/update/accepted`,

          `$aws/things/${thingName}/shadow/name/muteup/update`,
          `$aws/things/${thingName}/shadow/name/muteup/update/accepted`,

          `$aws/things/${thingName}/shadow/name/2nd_systime/update`,

          // SC07-WX CO & Alarm Status Topics (NEW)
          `$aws/things/${thingName}/shadow/name/2nd_alarm_status/update`,
          `$aws/things/${thingName}/shadow/name/2nd_alarm_status/update/accepted`,
          `$aws/things/${thingName}/shadow/name/alarm_status/update`,
          `$aws/things/${thingName}/shadow/name/alarm_status/update/accepted`,

          // SC07-WX Sensor Data Topics (NEW)
          `$aws/things/${thingName}/shadow/name/2nd_sensor_data/update`,
          `$aws/things/${thingName}/shadow/name/2nd_sensor_data/update/accepted`,
          `$aws/things/${thingName}/shadow/name/sensor_data/update`,

          // Fallback / Discovery
          `$aws/things/${thingName}/shadow/update`,
          `$aws/things/${thingName}/shadow/name/+/update`
        ].forEach(t => allTopics.add(t));
      }
    } else {
      // --- Standard RF Station Logic (SBS50 etc) ---

      // Original shadowName logic (might be wrong, but keep it)
      if (station.shadowName) {
        allTopics.add(`$aws/things/${station.shadowName}/shadow/name/+/update`);
        allTopics.add(`$aws/events/presence/+/${station.shadowName}`);
      }

      // New userId-based logic (likely correct)
      if (station.userId) {
        allTopics.add(`$aws/things/${station.userId}/shadow/name/${station.stationId}/update`);
        allTopics.add(`$aws/things/${station.userId}/shadow/name/${station.stationSn}/update`);

        // SPY result: Thing Name is Type+SN (e.g. SBS5014998680)
        if (typeSnThing) {
          [
            `$aws/things/${typeSnThing}/shadow/name/2nd_systime/update`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_systime/update/accepted`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_systime/update/delta`,

            // Low Power / RF Station topics
            `$aws/things/${typeSnThing}/shadow/name/2nd_mainpage/update`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_mainpage/update/accepted`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_mainpage/update/delta`,

            // STH51 Specific Topics (from refresh.md)
            `$aws/things/${typeSnThing}/shadow/name/2nd_tempdatalog/update`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_apptempdata/update`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_extendmuteup/update`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_extendalarm/update`,

            // Try 2nd_device_info as well (likely contains device list)
            `$aws/things/${typeSnThing}/shadow/name/2nd_device_info/update`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_device_info/update/accepted`,
            `$aws/things/${typeSnThing}/shadow/name/2nd_device_info/update/delta`,

            `$aws/things/${typeSnThing}/shadow/name/+/update` // Discovery for other shadows
          ].forEach(t => allTopics.add(t));
        }

        // Also try 'station_' prefixed versions just in case
        allTopics.add(`$aws/things/${station.userId}/shadow/name/station_${station.stationId}/update`);
        // Wildcard for named shadows (DISCOVERY)
        allTopics.add(`$aws/things/${station.userId}/shadow/name/+/update`);
        // Classic Shadow (Default)
        allTopics.add(`$aws/things/${station.userId}/shadow/update`);

        // *** EVENT TOPICS (Critical for Alarms) ***
        // Maximum Integration Strategy: Subscribe to everything known
        if (station.houseId) {
          [
            `@xsense/events/house/${station.houseId}`,       // Alarme (Rauch, CO, Wasser)
            `@xsense/events/safealarm/${station.houseId}`,   // Security Alarme
            `@xsense/events/shareadd/${station.houseId}`,    // Sharing
            `@xsense/events/shareupt/${station.houseId}`,    // Sharing Update
            `@xsense/events/lampgroup/${station.houseId}`,   // Lichtgruppen
            `@xsense/events/lampsched/${station.houseId}`,   // Lichtpläne
            `@xsense/events/securityplan/${station.houseId}` // Security Pläne
          ].forEach(t => allTopics.add(t));
        }

        // Station/Device based events
        if (typeSnThing) {
          // Extrahiere SN aus TypeName (z.B. SC07-WX-1234 -> 1234) oder nutze stationSN
          const sn = station.stationSn || station.deviceSn;
          if (sn) {
            [
              `@xsense/events/tempcleanlog/${sn}`, // Log Clear
              `@xsense/events/master/${sn}`,       // Master Register
              `@claybox/events/sospush/${sn}`,     // SOS Button (!)
              `@claybox/events/keyboard/${sn}`     // Keypad Events
            ].forEach(t => allTopics.add(t));
          }
        }
      }
    }

    this._subscribeTopic(info, Array.from(allTopics));
  }
  }

  _subscribeTopic(info, topic) {
    if (!topic) {
      return;
    }

    const topics = Array.isArray(topic) ? topic : [topic];
    const newTopics = topics.filter((t) => t && !info.subscriptions.has(t));

    if (newTopics.length === 0) {
      return;
    }

    // Mark as subscribed immediately to prevent race conditions during bulk calls
    newTopics.forEach((t) => info.subscriptions.add(t));

    this.debug.log(`[XSenseAPI] Subscribing to ${newTopics.length} topics...`);

    // Use batch subscription to respect AWS IoT limits (50 topics per connection)
    // and reduce network overhead.
    info.client.subscribe(newTopics, { qos: 0 }, (err) => {
      if (err) {
        this.debug.error('[XSenseAPI] MQTT batch subscribe error:', err.message);
        // Remove from set on failure so we can try again later
        newTopics.forEach((t) => info.subscriptions.delete(t));
      } else {
        newTopics.forEach((t) => this.debug.logMQTTSubscription(t, 0));
      }
    });
  }

  _handleMQTTMessage(topic, payload) {
    const msgString = payload.toString('utf8');

    // DEBUG: Log MQTT message
    this.debug.logMQTTMessage('incoming', topic, msgString, {
      payloadSize: payload.length,
      timestamp: new Date().toISOString()
    });

    // FORCE LOG: Log absolutely everything to find where the data is hidden
    this.debug.log(`[XSenseAPI] SPY: Message on ${topic}: ${msgString}`);

    let data;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch (error) {
      this.debug.error('[XSenseAPI] Failed to parse MQTT payload:', error.message);
      return;
    }

    // *** NEW: WiFi-Device Shadow Handler ***
    // Topics: $aws/things/SC07-WX-SN/shadow/name/mainpage/update...
    if (topic.includes('/shadow/name/mainpage') ||
      topic.includes('/shadow/name/pwordup') ||
      topic.includes('/shadow/name/2nd_systime')) {
      this._handleWiFiDeviceShadow(topic, data);
      return;
    }

    // Mute status
    if (topic.includes('/shadow/name/muteup')) {
      this.debug.log('[XSenseAPI] WiFi device mute status update:', JSON.stringify(data));
      this._handleWiFiDeviceShadow(topic, data); // Reuse handler for mute too
      return;
    }

    // STH51/STH54 Temperature Data Log Handler
    if (topic.includes('/shadow/name/2nd_tempdatalog') || topic.includes('/shadow/name/2nd_apptempdata')) {
      this._handleTempDataLog(topic, data);
      return;
    }

    // ** EVENT TOPICS HANDLER **
    if (topic.startsWith('@xsense/events/') || topic.startsWith('@claybox/events/')) {
      this._handleEventMessage(topic, data);
      return;
    }

    const reported = data?.state?.reported;
    if (!reported) {
      return;
    }

    const stationSn = reported.stationSN || reported.stationSn;
    const station = stationSn ? this.stationsBySn.get(stationSn) : null;

    if (reported.devs && station) {
      for (const [deviceSn, devData] of Object.entries(reported.devs)) {
        const deviceId = this.devicesBySn.get(deviceSn);
        if (!deviceId) {
          continue;
        }
        const normalizedData = this._normalizeDeviceData(devData);
        const existing = this.devices.get(deviceId) || { id: deviceId };
        const merged = {
          ...existing,
          ...normalizedData,
          id: deviceId,
          stationId: station.stationId,
          stationSn: station.stationSn,
          houseId: station.houseId
        };
        this.devices.set(deviceId, merged);
        this._emitUpdate('device', merged);
      }
    }
  }

  _normalizeDeviceData(data) {
    if (!data || typeof data !== 'object') {
      return {};
    }
    const normalized = { ...data };
    if (normalized.status && typeof normalized.status === 'object') {
      Object.assign(normalized, normalized.status);
      delete normalized.status;
    }
    return normalized;
  }



  /**
   * Handle WiFi device shadow updates (mainpage, pwordup)
   */
  _handleWiFiDeviceShadow(topic, data) {
    const reported = data?.state?.reported;
    if (!reported) return;

    // CRITICAL FIX: SC07-WX sends battery data in 'devs' structure within mainpage shadow
    // Format: reported.devs.{deviceSn}.batInfo
    // Example: {"stationSN":"12345","devs":{"67890":{"batInfo":"3","type":"SC07-WX"}}}
    if (reported.devs) {
      // Process each device in the devs map (Home Assistant pattern)
      for (const [deviceSn, deviceData] of Object.entries(reported.devs)) {
        const deviceId = this.devicesBySn.get(deviceSn);
        if (!deviceId) {
          // this.debug.log('[WARN]', `[XSenseAPI] Device ${deviceSn} in devs map not found in cache`);
          continue;
        }

        const existing = this.devices.get(deviceId) || { id: deviceId };

        // Merge device data from devs map
        const merged = {
          ...existing,
          ...deviceData,
          id: deviceId,
          deviceSn: deviceSn,

          // Map critical fields from devs structure
          batInfo: deviceData.batInfo !== undefined ? deviceData.batInfo : existing.batInfo,
          type: deviceData.type !== undefined ? deviceData.type : existing.type,
          alarmStatus: deviceData.alarmStatus !== undefined ? deviceData.alarmStatus : existing.alarmStatus,
          coPpm: deviceData.coPpm !== undefined ? deviceData.coPpm : existing.coPpm,
          rfLevel: deviceData.rfLevel !== undefined ? deviceData.rfLevel : existing.rfLevel,
          online: deviceData.online !== undefined ? deviceData.online : existing.online,

          // Parse status substructure if present (STH51 pattern)
          ...(deviceData.status && {
            temperature: deviceData.status.b !== undefined ? parseFloat(deviceData.status.b) : existing.temperature,
            humidity: deviceData.status.c !== undefined ? parseFloat(deviceData.status.c) : existing.humidity
          }),

          // Door/Window Sensor (SDS0A, SES01) - isOpen status
          isOpen: deviceData.isOpen !== undefined ? deviceData.isOpen :
                  (deviceData.status && deviceData.status.isOpen !== undefined ? deviceData.status.isOpen : existing.isOpen),

          // Motion Sensor (SMS0A, SMS01) - isMoved status
          isMoved: deviceData.isMoved !== undefined ? deviceData.isMoved :
                   (deviceData.status && deviceData.status.isMoved !== undefined ? deviceData.status.isMoved : existing.isMoved)
        };

        this.devices.set(deviceId, merged);
        this._emitUpdate('device', merged);

        this.debug.log(`[XSenseAPI] Updated device ${deviceSn} from mainpage devs map (batInfo: ${merged.batInfo})`);
      }

      // Also update station-level data if present
      const stationSn = reported.stationSN || reported.stationSn;
      if (stationSn && reported.wifiRSSI !== undefined) {
        // Update station RSSI if we have it cached
        for (const station of this.stations.values()) {
          if (station.stationSn === stationSn || station.sn === stationSn) {
            station.wifiRssi = reported.wifiRSSI;
            break;
          }
        }
      }
      return;
    }

    // NEW: Handle WiFi devices where data is nested under deviceSN key (XS01-WX, SC07-WX pattern)
    // Format: reported.{deviceSN}.{batInfo, type, wifiRssi, ...}
    // Example: {"0054253D": {"type": "XS01-WX", "stationSN": "0054253D", "batInfo": "3", ...}}
    // This is different from 'devs' structure - here the deviceSN is a direct key in reported
    for (const [key, value] of Object.entries(reported)) {
      // Skip known non-device keys
      if (['stationSN', 'stationSn', 'deviceSN', 'devs', 'wifiRSSI', 'wifiRssi', 'type', 'sw', 'deleted'].includes(key)) {
        continue;
      }
      
      // Check if this looks like a device entry (has type or batInfo)
      if (value && typeof value === 'object' && (value.type || value.batInfo !== undefined)) {
        const deviceSn = key;
        const deviceData = value;
        
        // Try to find device by SN
        let deviceId = this.devicesBySn.get(deviceSn);
        
        // If not found, try with stationSN from the nested data
        if (!deviceId && deviceData.stationSN) {
          deviceId = this.devicesBySn.get(deviceData.stationSN);
        }
        
        if (!deviceId) {
          this.debug.log(`[XSenseAPI] WiFi device ${deviceSn} not found in cache (nested structure)`);
          continue;
        }

        const existing = this.devices.get(deviceId) || { id: deviceId };

        // Merge device data
        const merged = {
          ...existing,
          ...deviceData,
          id: deviceId,
          deviceSn: deviceSn,

          // Map critical fields
          batInfo: deviceData.batInfo !== undefined ? deviceData.batInfo : existing.batInfo,
          type: deviceData.type !== undefined ? deviceData.type : existing.type,
          wifiRssi: deviceData.wifiRssi || deviceData.wifiRSSI || existing.wifiRssi,
          alarmStatus: deviceData.alarmStatus !== undefined ? deviceData.alarmStatus :
                       (deviceData.status?.alarmStatus !== undefined ? deviceData.status.alarmStatus : existing.alarmStatus),
          coPpm: deviceData.coPpm !== undefined ? deviceData.coPpm : existing.coPpm,
          coLevel: deviceData.coLevel !== undefined ? deviceData.coLevel : existing.coLevel,
          standard: deviceData.standard !== undefined ? deviceData.standard : existing.standard,
          isLifeEnd: deviceData.isLifeEnd !== undefined ? deviceData.isLifeEnd : existing.isLifeEnd
        };

        this.devices.set(deviceId, merged);
        this._emitUpdate('device', merged);

        this.debug.log(`[XSenseAPI] Updated WiFi device ${deviceSn} from nested structure (batInfo: ${merged.batInfo})`);
        return; // Found and processed device, exit
      }
    }

    // Fallback: Direct device update (for WiFi devices that don't use devs structure)
    const stationSn = reported.stationSN || reported.stationSn;
    const deviceSn = reported.deviceSN || stationSn;

    // this.debug.log(`[XSenseAPI] WiFi device shadow update for ${deviceSn}:`, JSON.stringify(reported).substring(0, 100));

    // Find device by SN (SC07-WX uses stationSn as deviceSn)
    const deviceId = this.devicesBySn.get(deviceSn);
    if (!deviceId) {
      // this.debug.log('[WARN]', `[XSenseAPI] WiFi device ${deviceSn} not found in cache during update`);
      return;
    }

    const existing = this.devices.get(deviceId) || { id: deviceId };

    // Merge shadow data with existing device
    const merged = {
      ...existing,
      ...reported,
      id: deviceId,
      deviceSn: deviceSn,

      // Map common fields - PRIORITIZE Reported values
      temperature: reported.temperature !== undefined ? reported.temperature : existing.temperature,
      humidity: reported.humidity !== undefined ? reported.humidity : existing.humidity,
      wifiRssi: reported.wifiRSSI || reported.wifiRssi || existing.wifiRssi,
      onLine: reported.onLine !== undefined ? reported.onLine : existing.onLine,
      alarmStatus: reported.alarmStatus !== undefined ? reported.alarmStatus : existing.alarmStatus,
      coPpm: reported.coPpm !== undefined ? reported.coPpm : existing.coPpm,
      batInfo: reported.batInfo !== undefined ? reported.batInfo : existing.batInfo
    };

    this.devices.set(deviceId, merged);
    this._emitUpdate('device', merged);

    this.debug.log(`[XSenseAPI] Updated WiFi device ${deviceSn} via properties`);
  }

  /**
   * Handle STH51/STH54 Temperature Data Log
   * Topics: 2nd_tempdatalog/update, 2nd_apptempdata/update
   *
   * Data format:
   * {
   *   "state": {
   *     "reported": {
   *       "stationSN": "14998680",
   *       "data": [{
   *         "deviceSN": "00000003",
   *         "type": "STH51",
   *         "20260115": ["030500,18.4,51.2", "030600,18.4,51.2", ...]
   *       }]
   *     }
   *   }
   * }
   */
  _handleTempDataLog(topic, data) {
    const reported = data?.state?.reported;
    if (!reported || !reported.data) {
      return;
    }

    const stationSN = reported.stationSN || reported.stationSn;

    // Debug log raw data
    this.debug.logSensorData('STH51-TempDataLog', stationSN, reported, 'mqtt');

    for (const deviceData of reported.data) {
      const deviceSn = deviceData.deviceSN || deviceData.deviceSn;
      const type = deviceData.type;

      if (!deviceSn) continue;

      // Get today's data (date key like "20260115")
      const dateKeys = Object.keys(deviceData).filter(k => k.match(/^\d{8}$/));
      if (dateKeys.length === 0) continue;

      const today = dateKeys[0]; // Usually only one date
      const entries = deviceData[today];
      if (!entries || !Array.isArray(entries) || entries.length === 0) continue;

      // Get latest entry (last element in array)
      const latest = entries[entries.length - 1];
      const parts = latest.split(',');
      if (parts.length !== 3) {
        this.debug.log('[WARN]', `[XSenseAPI] Invalid temp data format for ${deviceSn}: ${latest}`);
        continue;
      }

      const [time, tempStr, humStr] = parts;
      const temp = parseFloat(tempStr);
      const hum = parseFloat(humStr);

      if (isNaN(temp) || isNaN(hum)) {
        this.debug.log('[WARN]', `[XSenseAPI] Invalid temp/hum values for ${deviceSn}: temp=${tempStr}, hum=${humStr}`);
        continue;
      }

      // Find device and update
      const deviceId = this.devicesBySn.get(deviceSn);
      if (deviceId) {
        const existing = this.devices.get(deviceId) || { id: deviceId };
        const merged = {
          ...existing,
          temperature: temp,
          humidity: hum,
          lastTempUpdate: new Date().toISOString(),
          id: deviceId
        };

        this.devices.set(deviceId, merged);
        this._emitUpdate('device', merged);

        this.debug.log(`[XSenseAPI] 🌡️ Updated ${type} ${deviceSn} via MQTT: ${temp}°C, ${hum}%`);

        // Debug log the update
        this.debug.logSensorData(type, deviceSn, {
          temperature: temp,
          humidity: hum,
          time: time,
          date: today,
          totalEntries: entries.length
        }, 'mqtt-tempdatalog');
      } else {
        this.debug.log('[WARN]', `[XSenseAPI] Temperature data received for unknown device ${deviceSn}`);
      }
    }
  }

  /**
   * Handle @xsense/events/ messages (Real-time Alarms)
   */
  _handleEventMessage(topic, data) {
    // Payload: AlarmTopicResult
    // { "type": "SC07-WX", "deviceSN": "...", "alarmStatus": 1, "coPpm": 0, "temperature": 22.5, "event": "alarm_triggered" ... }

    // Sometimes payload is directly the object, sometimes it might be wrapped. Docs say it's AlarmTopicResult directly.
    if (!data || !data.deviceSN) return;

    const deviceSn = data.deviceSN;
    const deviceId = this.devicesBySn.get(deviceSn);

    if (!deviceId) {
      // this.debug.log(`[XSenseAPI] Received event for unknown device ${deviceSn}:`, JSON.stringify(data));
      return;
    }

    this.debug.log(`[XSenseAPI] 🚨 EVENT RECEIVED for ${deviceSn}: ${data.event || 'update'} (Alarm: ${data.alarmStatus})`);

    const existing = this.devices.get(deviceId) || { id: deviceId };

    // Merge event data - these are high priority updates
    const merged = {
      ...existing,
      ...data, // Merge everything (flat structure from event)
      id: deviceId,

      // Explicit mappings to ensure our standard properties are updated
      // Use DataSanitizer to prevent crashes from bad API types
      alarmStatus: data.alarmStatus !== undefined ? DataSanitizer.toInt(data.alarmStatus) : existing.alarmStatus,
      coPpm: data.coPpm !== undefined ? DataSanitizer.toInt(data.coPpm) : existing.coPpm,
      temperature: data.temperature !== undefined ? DataSanitizer.toFloat(data.temperature) : existing.temperature,
      humidity: data.humidity !== undefined ? DataSanitizer.toFloat(data.humidity) : existing.humidity,

      // Ensure we don't lose battery from shadow if it's missing here
      batInfo: data.batInfo !== undefined ? DataSanitizer.toInt(data.batInfo) : existing.batInfo,

      // Door/Window Sensor (SDS0A, SES01) - isOpen status
      isOpen: data.isOpen !== undefined ? data.isOpen : existing.isOpen,

      // Motion Sensor (SMS0A, SMS01) - isMoved status
      isMoved: data.isMoved !== undefined ? data.isMoved : existing.isMoved,

      // Preserve original event triggers if needed
      event: data.event,
      type: data.type
    };

    this.devices.set(deviceId, merged);
    this._emitUpdate('device', merged);
  }

  /**
   * Handle 2nd_tempdatalog MQTT messages
   * This is a NOTIFICATION that new temp/hum data is available
   */
  async _handleTempDataLog(data) {
    const reported = data?.state?.reported;
    if (!reported) return;

    const stationSn = reported.stationSN || reported.stationSn;
    const deviceSnList = reported.deviceSnList || [];

    // this.debug.log(`[XSenseAPI] Temp data log notification for station ${stationSn}, devices:`, deviceSnList);

    // Find station
    const station = stationSn ? this.stationsBySn.get(stationSn) : null;
    if (!station) {
      return;
    }

    // Debounce: Only refresh if last update was > 180 seconds ago
    const now = Date.now();
    const lastUpdate = this._lastTempDataUpdate || 0;
    const debounceMs = 180000; // 3 minutes

    if (now - lastUpdate < debounceMs) {
      // this.debug.log(`[XSenseAPI] Debouncing temp data refresh`);
      return;
    }

    this._lastTempDataUpdate = now;

    // Trigger shadow refresh to get actual temperature/humidity values
    try {
      this.debug.log(`[XSenseAPI] Refreshing station shadow for new temp/hum data...`);
      const shadowData = await this._getStationShadowData(station);

      if (shadowData && shadowData.devs) {
        // Process updated device data
        for (const [deviceSn, devData] of Object.entries(shadowData.devs)) {
          if (deviceSnList.includes(deviceSn)) {
            const deviceId = this.devicesBySn.get(deviceSn);
            if (!deviceId) continue;

            const existing = this.devices.get(deviceId) || { id: deviceId };
            const merged = {
              ...existing,
              ...devData,
              id: deviceId,
              stationId: station.stationId,
              stationSn: station.stationSn,
              houseId: station.houseId
            };

            this.devices.set(deviceId, merged);
            this._emitUpdate('device', merged);
            this.debug.log(`[XSenseAPI] Updated device ${deviceSn} temp/hum via 2nd_tempdatalog`);
          }
        }
      }
    } catch (error) {
      this.debug.error('[XSenseAPI] Failed to refresh shadow after temp data log:', error.message);
    }
  }

  _emitUpdate(type, data) {
    for (const callback of this.updateCallbacks) {
      try {
        callback(type, data);
      } catch (error) {
        this.debug.error('[XSenseAPI] Update callback error:', error.message);
      }
    }
  }

  _resolveHouse(houseId, stationId) {
    if (houseId && this.houses.has(houseId)) {
      return this.houses.get(houseId);
    }
    if (stationId && this.stations.has(stationId)) {
      const station = this.stations.get(stationId);
      if (station && station.houseId) {
        return this.houses.get(station.houseId);
      }
    }
    return null;
  }

  _getStationsByHouse(houseId) {
    const stations = [];
    for (const station of this.stations.values()) {
      if (station.houseId === houseId) {
        stations.push(station);
      }
    }
    return stations;
  }

  _buildStationShadowName(station) {
    let type = station.stationType || station.category || '';
    if (type === 'SBS10') {
      type = '';
    }
    if (type === 'XC04-WX' || type === 'SC07-WX') {
      type = `${type}-`;
    }
    const serial = station.stationSn || station.sn || '';
    return `${type}${serial}`;
  }

  /**
   * Notify Homey app about MQTT health status (NEW)
   * @param {string} houseId - House ID
   * @param {boolean} isHealthy - true if MQTT connected, false if disconnected
   */
  _notifyMQTTHealth(houseId, isHealthy) {
    if (this.homey && this.homey.app && typeof this.homey.app.setMQTTHealth === 'function') {
      this.homey.app.setMQTTHealth(houseId, isHealthy);
    }
  }

  /**
   * Register callback for device updates
   */
  onUpdate(callback) {
    this.updateCallbacks.push(callback);
  }

  /**
   * Remove update callback (for cleanup/memory leak prevention)
   * @param {Function} callback - Callback to remove
   */
  removeUpdateCallback(callback) {
    const index = this.updateCallbacks.indexOf(callback);
    if (index > -1) {
      this.updateCallbacks.splice(index, 1);
    }
  }

  /**
   * Disconnect all MQTT clients
   */
  disconnectMQTT() {
    this.debug.log('[XSenseAPI] Disconnecting all MQTT clients...');
    this.mqttClients.forEach(info => {
      // Clear signature refresh interval (NEW)
      if (info.signatureRefreshInterval) {
        clearInterval(info.signatureRefreshInterval);
      }

      // Disconnect client
      if (info.client && info.client.end) {
        info.client.end();
      }
    });
    this.mqttClients.clear();
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.debug.log('[XSenseAPI] Destroying API client...');
    this.disconnectMQTT();
    this.houses.clear();
    this.stations.clear();
    this.devices.clear();
    this.updateCallbacks = [];
  }
  /**
   * Set configuration for a station (or SC07-WX device) via Shadow
   * @param {string} stationId - The station ID (or device ID for SC07-WX)
   * @param {object} config - Key-value pairs of settings to update
   */
  async setStationConfig(stationId, config) {
    // Find station/device info
    // Note: For SC07-WX, stationId IS the deviceId in our map
    let station = this.stations.get(stationId);

    // If not found in stations, check if it's a device that acts as a station (SC07-WX)
    if (!station) {
      // Try to find device
      const devices = Array.from(this.devices.values());
      const device = devices.find(d => d.id === stationId);
      if (device && (device.deviceType === 'SC07-WX' || device.category === 'SC07-WX')) {
        // Construct a minimal station object for it
        station = {
          userId: device.userId,
          stationSn: device.stationSn || device.deviceSn,
          mqttRegion: device.mqttRegion || this.region // Fallback
        };
      }
    }

    if (!station) {
      throw new Error(`Station not found for ID ${stationId}`);
    }

    const userId = station.userId || this.userId; // Fallback
    const thingName = `SC07-WX-${station.stationSn}`; // Default to SC07 style for now, or need logic
    // Ideally we should store the correctly formatted ThingName in the device/station object
    // But let's try constructing it.
    // SBS50: SBS50{sn}
    // SC07: SC07-WX-{sn}

    let realThingName = thingName;
    if (station.category === 'SBS50' || station.stationType === 'SBS50') {
      realThingName = `SBS50${station.stationSn}`;
    } else if (station.category === 'SC07-WX' || station.deviceType === 'SC07-WX') {
      realThingName = `SC07-WX-${station.stationSn}`;
    }

    // We update the '2nd_info_{sn}' shadow usually for settings? Or '2nd_systime'?
    // Logs showed '2nd_info_{sn}' having 11 keys (probably settings).
    // Let's try updating '2nd_info_{sn}' first.
    const shadowName = `2nd_info_${station.stationSn}`;
    const topic = `$aws/things/${userId}/shadow/name/${shadowName}/update`;

    const payload = {
      state: {
        desired: config
      }
    };

    this.debug.log(`[XSenseAPI] Updating config for ${realThingName} on topic ${topic}:`, JSON.stringify(payload));

    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        return reject(new Error('MQTT Client not connected'));
      }

      this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

module.exports = XSenseAPI;
