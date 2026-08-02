'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLatestSourceTimestamp,
  normalizeSourceTimestamp,
} = require('../lib/SourceTimestamp');

test('parses X-Sense compact timestamps instead of treating them as Unix milliseconds', () => {
  assert.equal(
    normalizeSourceTimestamp(20260717011325),
    '2026-07-17T01:13:25.000Z'
  );
  assert.equal(
    normalizeSourceTimestamp('20260717011325325'),
    '2026-07-17T01:13:25.325Z'
  );
});

test('continues to parse Unix and ISO timestamps', () => {
  assert.equal(normalizeSourceTimestamp(1768438611), '2026-01-15T00:56:51.000Z');
  assert.equal(normalizeSourceTimestamp(1768438611325), '2026-01-15T00:56:51.325Z');
  assert.equal(normalizeSourceTimestamp('2026-01-15T00:56:51Z'), '2026-01-15T00:56:51.000Z');
});

test('rejects invalid compact timestamps', () => {
  assert.equal(normalizeSourceTimestamp('20260230010101'), null);
});

test('uses the newest device report timestamp across X-Sense fields', () => {
  assert.equal(
    normalizeLatestSourceTimestamp([
      '20260717011325',
      '20260802062713',
      null,
    ]),
    '2026-08-02T06:27:13.000Z'
  );
});
