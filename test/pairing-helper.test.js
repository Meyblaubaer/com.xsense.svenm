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
