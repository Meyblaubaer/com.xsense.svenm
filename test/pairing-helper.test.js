'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PairingHelper = require('../lib/PairingHelper');

test('pairs direct devices with a deterministic fallback ID', async () => {
  const api = {
    async getAllDevices() {
      return { devices: [{
        stationId: 'station-1', stationSn: 'WATER123', category: 'SWS0B',
        stationName: 'Kitchen leak detector', houseId: 'house-1',
      }] };
    },
  };
  const driver = {
    id: 'water-sensor',
    homey: {
      __: (key) => key,
      app: { getAPIClient: async () => api },
    },
    log() {},
    error() {},
  };
  const session = { credentials: { username: 'homey@example.test', password: 'secret' } };
  const entries = await PairingHelper.listDevicesForPairing({
    driver,
    session,
    matchLabel: 'water devices',
    matchDevice: (_device, type) => type === 'SWS0B',
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.id, 'station-1');
  assert.equal(entries[0].data.deviceSn, 'WATER123');
  assert.equal(entries[0].data.deviceType, 'SWS0B');
  assert.ok(entries[0].capabilities.includes('alarm_water'));
});

test('rejects empty login fields before calling Cognito', async () => {
  let loginHandler;
  let apiCalls = 0;
  const driver = {
    homey: {
      __: (key) => key,
      app: {
        currentPairSession: null,
        getStoredCredentials: async () => ({}),
        getAPIClient: async () => { apiCalls += 1; },
        setStoredCredentials: async () => {},
      },
    },
    log() {},
    error() {},
  };
  const session = {
    setHandler(name, handler) {
      if (name === 'login') loginHandler = handler;
    },
  };

  await PairingHelper.registerPairHandlers({ driver, session, listDevicesHandler: async () => [] });
  await assert.rejects(
    () => loginHandler({ username: '  ', password: '' }),
    /pair\.error\.login_failed/
  );
  assert.equal(apiCalls, 0);
});
