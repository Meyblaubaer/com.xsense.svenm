'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DebugLogger = require('../lib/DebugLogger');

test('redacts identifiers and network data before diagnostics are stored', () => {
  const logger = new DebugLogger(null, 'test');
  const sanitized = logger._sanitizeData({
    email: 'person@example.test',
    stationSN: '12345678',
    status: { ip: '192.168.1.4', mac: 'aa:bb:cc:dd:ee:ff', alarmStatus: 1 },
    devs: { '00000007': { alarmStatus: 1 } },
  });

  assert.equal(sanitized.email, '[REDACTED]');
  assert.equal(sanitized.stationSN, '[REDACTED]');
  assert.equal(sanitized.status.ip, '[REDACTED]');
  assert.equal(sanitized.status.mac, '[REDACTED]');
  assert.equal(sanitized.status.alarmStatus, 1);
  assert.ok(Object.keys(sanitized.devs)[0].startsWith('[REDACTED_KEY_'));
  assert.equal(
    logger._sanitizeTopic('$aws/things/SC07-WX-12345678/shadow/name/mainpage/update'),
    '$aws/things/[REDACTED]/shadow/name/mainpage/update'
  );
});

test('summarizes API responses without exposing credential values', () => {
  const XSenseAPI = require('../lib/XSenseAPI');
  const api = new XSenseAPI('user@example.test', 'secret', {
    app: { log() {}, error() {}, setMQTTHealth() {} },
  });

  const summary = api._summarizeAPIResponse({
    reCode: 200,
    reMsg: 'success',
    reData: {
      accessKeyId: 'AKIA-SECRET',
      secretAccessKey: 'secret-key',
      sessionToken: 'session-token',
    },
  });

  assert.deepEqual(summary, {
    reCode: 200,
    errCode: undefined,
    reMsg: 'success',
    reData: 'object(accessKeyId,secretAccessKey,sessionToken)',
  });
  assert.equal(JSON.stringify(summary).includes('AKIA-SECRET'), false);
  api.destroy();
});
