'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inferOnlineFromReportTime } = require('../lib/OnlineStatus');

test('a recent direct WiFi report overrides a stale offline flag', () => {
  const online = inferOnlineFromReportTime({
    deviceType: 'XS01-WX',
    online: 0,
    onlineTime: '20260807134000',
    utcTime: '20260807134200',
  });

  assert.equal(online, true);
});

test('water sensors use the extended report window', () => {
  const online = inferOnlineFromReportTime({
    deviceType: 'SWS0B',
    onlineTime: '20260806000000',
    utcTime: '20260808000000',
  });

  assert.equal(online, true);
});

test('stale reports are not treated as online', () => {
  const online = inferOnlineFromReportTime({
    deviceType: 'XS01-WX',
    onlineTime: '20260801000000',
    utcTime: '20260808000000',
  });

  assert.equal(online, false);
});

test('sleeping RF models do not derive connectivity from report time', () => {
  const online = inferOnlineFromReportTime({
    deviceType: 'SC07-iA',
    onlineTime: '20260807134000',
    utcTime: '20260807134200',
  });

  assert.equal(online, undefined);
});
