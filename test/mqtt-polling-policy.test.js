'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isFallbackPollDue,
  shouldPollForMQTT,
} = require('../lib/MQTTPollingPolicy');

test('ignores unused account houses when active MQTT houses are healthy', () => {
  const client = {
    houses: new Map([
      ['used', { houseId: 'used' }],
      ['unused', { houseId: 'unused' }],
    ]),
    getActiveMQTTHouseIds: () => ['used'],
  };
  const health = new Map([['used', true]]);

  assert.equal(shouldPollForMQTT(client, health), false);
});

test('polls when an active MQTT house is unhealthy or no MQTT client exists', () => {
  const health = new Map([['used', false]]);

  assert.equal(shouldPollForMQTT({ getActiveMQTTHouseIds: () => ['used'] }, health), true);
  assert.equal(shouldPollForMQTT({ getActiveMQTTHouseIds: () => [] }, health), true);
});

test('throttles fallback polling while MQTT remains unhealthy', () => {
  const client = { getActiveMQTTHouseIds: () => ['used'] };
  const health = new Map([['used', false]]);
  const now = 1_000_000;

  assert.equal(isFallbackPollDue(client, health, now - 299999, now), false);
  assert.equal(isFallbackPollDue(client, health, now - 300000, now), true);
  health.set('used', true);
  assert.equal(isFallbackPollDue(client, health, 0, now), false);
});
