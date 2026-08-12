'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('drivers expose exactly one battery status capability', () => {
  const driversDir = path.join(__dirname, '..', 'drivers');
  for (const driverId of fs.readdirSync(driversDir)) {
    const composePath = path.join(driversDir, driverId, 'driver.compose.json');
    if (!fs.existsSync(composePath)) continue;

    const driver = JSON.parse(fs.readFileSync(composePath, 'utf8'));
    const batteryCapabilities = (driver.capabilities || [])
      .filter(capability => capability === 'measure_battery' || capability === 'alarm_battery');

    assert.deepEqual(batteryCapabilities, ['measure_battery'], driverId);
    assert.ok(Array.isArray(driver.energy?.batteries) && driver.energy.batteries.length > 0, driverId);
  }
});
