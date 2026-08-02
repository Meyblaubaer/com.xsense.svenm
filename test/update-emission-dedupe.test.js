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

test('suppresses immediate duplicate device updates but preserves changes', () => {
  const api = new XSenseAPI('test@example.test', 'secret', quietHomey);
  const updates = [];
  api.onUpdate((type, data) => updates.push({ type, data }));

  assert.equal(api._emitUpdate('device', { id: 'sensor-1', temperature: 20, lastTempUpdate: '2026-08-02T07:00:00.100Z' }), true);
  assert.equal(api._emitUpdate('device', { id: 'sensor-1', temperature: 20, lastTempUpdate: '2026-08-02T07:00:00.900Z' }), false);
  assert.equal(api._emitUpdate('device', { id: 'sensor-1', temperature: 21, lastTempUpdate: '2026-08-02T07:00:01.000Z' }), true);
  assert.equal(updates.length, 2);

  api.destroy();
});

test('allows the same report again after the duplicate window', () => {
  const api = new XSenseAPI('test@example.test', 'secret', quietHomey);
  let updateCount = 0;
  api.onUpdate(() => { updateCount += 1; });

  api._emitUpdate('device', { id: 'sensor-1', humidity: 50 });
  api.recentUpdateEmissions.get('sensor-1').timestamp -= 2000;
  api._emitUpdate('device', { id: 'sensor-1', humidity: 50 });
  assert.equal(updateCount, 2);

  api.destroy();
});
