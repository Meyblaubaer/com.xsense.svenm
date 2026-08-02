'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XSenseAPI = require('../lib/XSenseAPI');

function apiForTest() {
  return new XSenseAPI('test@example.test', 'secret', {
    app: { log() {}, error() {}, setMQTTHealth() {} },
  });
}

test('discovers a standalone SWS0B station as a water device', async () => {
  const api = apiForTest();
  api.getHouses = async () => [{ houseId: 'house-1', houseName: 'Home', mqttRegion: 'eu-test-1' }];
  api.getStations = async () => [{
    stationId: 'station-1', stationSn: 'WATER123', stationName: 'Leak detector',
    category: 'SWS0B', devices: [], onLine: 1,
  }];
  api.getWiFiDeviceShadowFast = async () => ({});
  api._getStationShadowData = async () => ({});

  const result = await api.getAllDevices();
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].deviceType, 'SWS0B');
  assert.equal(result.devices[0].deviceSn, 'WATER123');
  assert.equal(result.devices[0].online, 1);
  assert.equal(api.devicesBySn.get('WATER123'), 'station-1');
  api.destroy();
});

test('restores the last successful cache after a discovery error', async () => {
  const api = apiForTest();
  api.devices.set('existing-1', { id: 'existing-1', deviceSn: 'OLD12345', type: 'XS01-M' });
  api.devicesBySn.set('OLD12345', 'existing-1');
  api.getHouses = async () => { throw new Error('temporary cloud error'); };

  await assert.rejects(() => api.getAllDevices(), /temporary cloud error/);
  assert.equal(api.devices.get('existing-1').deviceSn, 'OLD12345');
  assert.equal(api.devicesBySn.get('OLD12345'), 'existing-1');
  api.destroy();
});
