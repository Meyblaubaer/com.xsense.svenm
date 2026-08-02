'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XSenseAPI = require('../lib/XSenseAPI');

const quietHomey = {
  app: {
    log() {},
    error() {},
  },
};

test('shares one station cloud request between concurrent device syncs', async () => {
  const api = new XSenseAPI('test@example.test', 'secret', quietHomey);
  const station = { stationId: 'station-1', stationSn: 'base-1' };
  api.stations.set(station.stationId, station);
  api.devices.set('device-1', { id: 'device-1', deviceSn: 'sensor-1', stationId: station.stationId });
  api.devices.set('device-2', { id: 'device-2', deviceSn: 'sensor-2', stationId: station.stationId });
  api.devicesBySn.set('sensor-1', 'device-1');
  api.devicesBySn.set('sensor-2', 'device-2');

  let requestCount = 0;
  let releaseRequest;
  api._getStationShadowData = async () => {
    requestCount += 1;
    await new Promise(resolve => { releaseRequest = resolve; });
    return {
      devs: {
        'sensor-1': { temperature: 20 },
        'sensor-2': { temperature: 21 },
      },
    };
  };

  const first = api.syncDevice('device-1');
  const second = api.syncDevice('device-2');
  assert.equal(requestCount, 1);

  releaseRequest();
  const [firstDevice, secondDevice] = await Promise.all([first, second]);
  assert.equal(firstDevice.temperature, 20);
  assert.equal(secondDevice.temperature, 21);

  api.destroy();
});

test('shares one station cloud request between concurrent device polls', async () => {
  const api = new XSenseAPI('test@example.test', 'secret', quietHomey);
  const station = {
    stationId: 'station-1',
    stationSn: 'base-1',
    category: 'SBS50',
  };
  api.stations.set(station.stationId, station);
  api.devices.set('device-1', { id: 'device-1', stationId: station.stationId });

  let requestCount = 0;
  let releaseRequest;
  api._getStationShadowData = async () => {
    requestCount += 1;
    await new Promise(resolve => { releaseRequest = resolve; });
    return {};
  };

  const first = api.getDevices(station.stationId);
  const second = api.getDevices(station.stationId);
  assert.equal(requestCount, 1);

  releaseRequest();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.length, 1);
  assert.equal(secondResult.length, 1);

  api.destroy();
});
