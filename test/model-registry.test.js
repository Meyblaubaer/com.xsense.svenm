'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DeviceModelRegistry = require('../lib/DeviceModelRegistry');

test('classifies reported and newly supported models', () => {
  assert.equal(DeviceModelRegistry.driverId('SWS0B'), 'water-sensor');
  assert.equal(DeviceModelRegistry.driverId('SWS0A'), 'water-sensor');
  assert.equal(DeviceModelRegistry.driverId('XS0F-PMA'), 'smoke-detector');
  assert.equal(DeviceModelRegistry.driverId('SD19-MN'), 'smoke-detector');
  assert.equal(DeviceModelRegistry.driverId('SAL51'), 'smoke-detector');
  assert.equal(DeviceModelRegistry.driverId('SBS50'), null);
});

test('uses model-specific pairing capabilities', () => {
  const smoke = DeviceModelRegistry.capabilities('SD19-MN');
  assert.ok(smoke.includes('alarm_smoke'));
  assert.ok(!smoke.includes('measure_temperature'));
  assert.ok(!smoke.includes('measure_humidity'));
  assert.ok(!smoke.includes('alarm_co'));

  const xs0f = DeviceModelRegistry.capabilities('XS0F-PMA');
  assert.ok(xs0f.includes('alarm_ac_break'));
  assert.ok(xs0f.includes('alarm_base_removed'));
});

test('blocks remote tests on devices that only report physical tests', () => {
  assert.equal(DeviceModelRegistry.supportsRemoteTest('XS01-WX'), false);
  assert.equal(DeviceModelRegistry.supportsRemoteTest('XS0B-iR'), false);
  assert.equal(DeviceModelRegistry.supportsRemoteTest('SD19-MN'), true);
  assert.equal(DeviceModelRegistry.supportsRemoteTest('XS0F-PMA'), true);
});
