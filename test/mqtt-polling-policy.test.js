'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldPollForMQTT } = require('../lib/MQTTPollingPolicy');

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
