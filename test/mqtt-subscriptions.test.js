'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XSenseAPI = require('../lib/XSenseAPI');

test('marks subscriptions active only after broker acknowledgement', () => {
  const health = [];
  const api = new XSenseAPI('test@example.test', 'secret', {
    app: {
      log() {},
      error() {},
      setMQTTHealth: (_houseId, value) => health.push(value),
    },
  });
  let acknowledge;
  const info = {
    house: { houseId: 'house-1' },
    subscriptions: new Set(),
    desiredSubscriptions: new Set(),
    pendingSubscriptions: new Set(),
    client: { subscribe: (_topics, _options, callback) => { acknowledge = callback; } },
  };
  const topics = [
    '@xsense/events/safealarm/house-1',
    '$aws/things/base/shadow/name/2nd_safenotice/update',
  ];

  api._subscribeTopic(info, topics);
  assert.equal(info.subscriptions.size, 0);
  assert.equal(info.pendingSubscriptions.size, 2);

  acknowledge(null);
  assert.equal(info.subscriptions.size, 2);
  assert.equal(info.pendingSubscriptions.size, 0);
  assert.equal(health.at(-1), true);
  api.destroy();
});
