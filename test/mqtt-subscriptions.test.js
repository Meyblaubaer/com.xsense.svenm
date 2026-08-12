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

test('uses wildcard shadow subscriptions for accounts with many WiFi devices', () => {
  const api = new XSenseAPI('test@example.test', 'secret', {
    app: { log() {}, error() {}, setMQTTHealth() {} },
  });
  api.stations.set('station-1', {
    stationId: 'station-1',
    stationSn: 'ABC12345',
    stationType: 'SC07-WX',
  });
  const subscribed = [];
  const info = {
    house: { houseId: 'house-1' },
    subscriptions: new Set(),
    desiredSubscriptions: new Set(),
    pendingSubscriptions: new Set(),
    client: {
      subscribe(topics, _options, callback) {
        subscribed.push(...topics);
        callback(null);
      },
    },
  };

  api._subscribeStationTopics(info, 'station-1');

  assert.deepEqual(subscribed.sort(), [
    '$aws/events/presence/+/SC07-WX-ABC12345',
    '$aws/things/SC07-WX-ABC12345/shadow/name/+/update',
  ]);
  api.destroy();
});

test('presence events update direct station devices', () => {
  const api = new XSenseAPI('test@example.test', 'secret', {
    app: { log() {}, error() {}, setMQTTHealth() {} },
  });
  const station = {
    stationId: 'station-1',
    stationSn: 'ABC12345',
    stationType: 'SC07-WX',
    online: 0,
  };
  api.stations.set('station-1', station);
  api.devicesBySn.set('ABC12345', 'device-1');
  api.devices.set('device-1', {
    id: 'device-1',
    deviceSn: 'ABC12345',
    deviceType: 'SC07-WX',
    online: 0,
  });
  let update;
  api.onUpdate((type, data) => {
    if (type === 'device') update = data;
  });

  api._handlePresenceMessage(
    '$aws/events/presence/connected/SC07-WX-ABC12345',
    { eventType: 'connected' }
  );

  assert.equal(station.online, 1);
  assert.equal(update.online, 1);
  assert.equal(api.devices.get('device-1').onLine, 1);
  api.destroy();
});
