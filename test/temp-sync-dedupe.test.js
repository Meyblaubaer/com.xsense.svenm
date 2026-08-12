'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XSenseAPI = require('../lib/XSenseAPI');

test('batches temperature devices into one station sync request', async () => {
  const api = new XSenseAPI('test@example.test', 'secret', {
    app: { log() {}, error() {}, setMQTTHealth() {} },
  });
  api.stations.set('station-1', {
    stationId: 'station-1',
    stationSn: 'BASE1234',
    stationType: 'SBS50',
    stationName: 'Base Station',
    mqttRegion: 'eu-test-1',
  });
  for (let index = 1; index <= 3; index += 1) {
    api.devices.set(`device-${index}`, {
      id: `device-${index}`,
      stationId: 'station-1',
      deviceSn: `TEMP${index}`,
      deviceType: 'STH51',
    });
  }
  api.awsTokenExpiration = Date.now() + 3600000;
  api._signAWSRequest = () => ({});
  const requestBodies = [];
  api.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true };
  };

  const results = await Promise.all([
    api.requestTempDataSync('station-1', ['TEMP1']),
    api.requestTempDataSync('station-1', ['TEMP2']),
    api.requestTempDataSync('station-1', ['TEMP3']),
  ]);

  assert.deepEqual(results, [true, true, true]);
  assert.equal(requestBodies.length, 1);
  assert.deepEqual(
    requestBodies[0].state.desired.deviceSN.sort(),
    ['TEMP1', 'TEMP2', 'TEMP3']
  );
  api.destroy();
});
