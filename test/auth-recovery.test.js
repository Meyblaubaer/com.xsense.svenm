'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XSenseAPI = require('../lib/XSenseAPI');

function apiForTest() {
  const api = new XSenseAPI('test@example.test', 'secret', {
    app: { log() {}, error() {}, setMQTTHealth() {} },
  });
  api._calculateMac = () => 'mac';
  api.accessToken = 'old-token';
  api.refreshToken = 'refresh-token';
  api.accessTokenExpiration = Date.now() + 3600000;
  return api;
}

function jsonResponse(data, status = 200) {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    ok: status >= 200 && status < 300,
    async json() { return data; },
    async text() { return JSON.stringify(data); },
  };
}

test('concurrent NotAuthorized responses share one session refresh and retry once', async () => {
  const api = apiForTest();
  let refreshes = 0;
  const bodies = [];
  api._refreshCognitoSession = async () => {
    refreshes += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    api.accessToken = 'new-token';
    api.accessTokenExpiration = Date.now() + 3600000;
  };
  api.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (options.headers.Authorization === 'old-token') {
      return jsonResponse({ reCode: 500, reMsg: 'NotAuthorizedException' });
    }
    return jsonResponse({ reCode: 200, reData: { ok: true } });
  };

  const results = await Promise.all(
    Array.from({ length: 5 }, () => api._apiCall('102007', { utctimestamp: '0' }))
  );

  assert.equal(refreshes, 1);
  assert.equal(bodies.length, 10);
  assert.ok(bodies.every((body) => !Object.hasOwn(body, '_isRetry')));
  assert.ok(results.every((result) => result.reData.ok));
  api.destroy();
});

test('persistent NotAuthorized response stops after one retry', async () => {
  const api = apiForTest();
  let requests = 0;
  let refreshes = 0;
  api._refreshCognitoSession = async () => {
    refreshes += 1;
    api.accessToken = 'new-token';
    api.accessTokenExpiration = Date.now() + 3600000;
  };
  api.fetch = async () => {
    requests += 1;
    return jsonResponse({ reCode: 500, reMsg: 'NotAuthorizedException' });
  };

  await assert.rejects(
    () => api._apiCall('102007', { utctimestamp: '0' }),
    /SessionExpired: NotAuthorizedException/
  );
  assert.equal(refreshes, 1);
  assert.equal(requests, 2);
  assert.equal(api.accessToken, null);
  api.destroy();
});

test('an expiring access token is refreshed before the API request', async () => {
  const api = apiForTest();
  api.accessTokenExpiration = Date.now() + 60000;
  let refreshes = 0;
  api._refreshCognitoSession = async () => {
    refreshes += 1;
    api.accessToken = 'new-token';
    api.accessTokenExpiration = Date.now() + 3600000;
  };
  api.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'new-token');
    return jsonResponse({ reCode: 200, reData: {} });
  };

  await api._apiCall('102007', { utctimestamp: '0' });
  assert.equal(refreshes, 1);
  api.destroy();
});

test('an unauthorized shadow request refreshes AWS credentials once', async () => {
  const api = apiForTest();
  api.awsAccessKeyId = 'old-key';
  api.awsSecretAccessKey = 'old-secret';
  api.awsSessionToken = 'old-session';
  api.awsTokenExpiration = Date.now() + 3600000;
  api._signAWSRequest = () => ({});
  let awsRefreshes = 0;
  let requests = 0;
  api.getAWSTokens = async () => {
    awsRefreshes += 1;
    api.awsTokenExpiration = Date.now() + 3600000;
  };
  api.fetch = async () => {
    requests += 1;
    if (requests === 1) return jsonResponse({}, 403);
    return jsonResponse({ state: { reported: { online: 1 } } });
  };

  const shadow = await api.getThingShadow('SC07-WX-ABC12345', 'mainpage', 'eu-test-1');

  assert.deepEqual(shadow, { online: 1 });
  assert.equal(awsRefreshes, 1);
  assert.equal(requests, 2);
  api.destroy();
});
