'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LatestValueQueue = require('../lib/LatestValueQueue');

test('coalesces an immediate burst and handles only its latest value', async () => {
  const handled = [];
  const queue = new LatestValueQueue(value => handled.push(value), 10);

  queue.push('first');
  queue.push('second');
  await new Promise(resolve => setTimeout(resolve, 25));

  assert.deepEqual(handled, ['second']);
  queue.cancel();
});

test('cancels a pending value', async () => {
  const handled = [];
  const queue = new LatestValueQueue(value => handled.push(value), 10);

  queue.push('pending');
  queue.cancel();
  await new Promise(resolve => setTimeout(resolve, 25));

  assert.deepEqual(handled, []);
});
