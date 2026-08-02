'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventNormalizer = require('../lib/EventNormalizer');

function cache(device) {
  return {
    devices: new Map([[device.id, device]]),
    devicesBySn: new Map([[device.deviceSn, device.id]]),
  };
}

test('maps a numeric SBS50 child key to a water alarm only', () => {
  const state = cache({ id: 'water-1', deviceSn: '00000007', type: 'SWS0A' });
  const updates = EventNormalizer.normalize({
    state: { reported: { notices: { '00000007': { alarmStatus: '1' } } } },
  }, state);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].normalizedEvent, 'water_alarm');
});

test('finds nested RF smoke alarms and their clear event', () => {
  const state = cache({ id: 'smoke-1', deviceSn: 'ABC12345', type: 'SC07-MR' });
  const alarm = EventNormalizer.normalize({
    state: { reported: { devs: { ABC12345: { status: { alarmStatus: 1 } } } } },
  }, state);
  const clear = EventNormalizer.normalize({ deviceSN: 'ABC12345', alarmStatus: 0 }, state);

  assert.equal(alarm.length, 1);
  assert.equal(alarm[0].normalizedEvent, 'smoke_alarm');
  assert.equal(clear[0].normalizedEvent, 'alarm_clear');
});

test('does not turn a CO measurement into a CO alarm', () => {
  const state = cache({ id: 'combo-1', deviceSn: 'COMBO123', type: 'SC07-WX' });
  const measurement = EventNormalizer.normalize({
    deviceSN: 'COMBO123', status: { coPpm: 12 },
  }, state);
  const alarm = EventNormalizer.normalize({
    deviceSN: 'COMBO123', alarmStatus: 1, coAlarm: true, coPpm: 12,
  }, state);

  assert.equal(measurement.length, 1);
  assert.equal(measurement[0].normalizedEvent, null);
  assert.equal(alarm[0].normalizedEvent, 'co_alarm');
});

test('normalizes physical self-test reports', () => {
  const state = cache({ id: 'smoke-1', deviceSn: 'TEST1234', type: 'XS01-WX' });
  const updates = EventNormalizer.normalize({
    deviceSn: 'TEST1234', event: 'self_test_triggered',
  }, state);
  assert.equal(updates[0].normalizedEvent, 'self_test');
});
