import assert from 'node:assert/strict';
import test from 'node:test';

import { appLinkBase, plainOrigin, publicAppOrigin, requestAppOrigin } from './app-origins';
import { authCallbackOrigin } from './auth-callback-origin';

const APP = 'https://app.example.test';
const OPEN = 'https://open.example.test';
const headers = (values: Record<string, string>) => new Headers(values);

test('the public address is a plain https origin, or there is none', () => {
  assert.equal(publicAppOrigin({}), null);
  assert.equal(publicAppOrigin({ APP_PUBLIC_URL: `${OPEN}/` }), OPEN);
  assert.equal(plainOrigin('http://localhost:3000'), 'http://localhost:3000');
  for (const bad of ['http://open.example.test', 'open.example.test', 'https://user:pass@open.example.test', 'https://open.example.test/ruta', 'https://open.example.test/?a=1', 'https://open.example.test/#x', 'javascript:alert(1)', '   ', null, undefined])
    assert.equal(plainOrigin(bad), null, String(bad));
});

test('the links of the app\'s own emails open at the public address, and at the app\'s own without one', () => {
  assert.equal(appLinkBase(`${APP}/`, {}), APP);
  assert.equal(appLinkBase(APP, { APP_PUBLIC_URL: OPEN }), OPEN);
  assert.equal(appLinkBase(APP, { APP_PUBLIC_URL: 'http://open.example.test' }), APP, 'an address that is not plain https is not used');
});

test('a request only picks between the configured addresses', () => {
  const env = { APP_PUBLIC_URL: OPEN };
  assert.equal(requestAppOrigin(headers({ host: 'open.example.test' }), APP, env), OPEN);
  assert.equal(requestAppOrigin(headers({ 'x-forwarded-host': 'Open.Example.Test, proxy.internal' }), APP, env), OPEN);
  assert.equal(requestAppOrigin(headers({ host: 'app.example.test' }), APP, env), APP);
  assert.equal(requestAppOrigin(headers({ host: 'evil.example', 'x-forwarded-host': 'evil.example' }), APP, env), APP, 'never a host the server was not configured with');
  assert.equal(requestAppOrigin(headers({}), APP, env), APP);
  assert.equal(requestAppOrigin(headers({ host: 'open.example.test' }), APP, {}), APP, 'without a public address there is one address');
});

test('signing in at the public address ends at the public address; anywhere else, at the app\'s own', () => {
  const internal = new URL('https://0.0.0.0:8080/api/auth/callback?code=x');
  const env = { CANONICAL_APP_URL: APP, APP_PUBLIC_URL: OPEN };
  assert.equal(authCallbackOrigin(internal, env, headers({ 'x-forwarded-host': 'open.example.test' })), OPEN);
  assert.equal(authCallbackOrigin(internal, env, headers({ host: 'app.example.test' })), APP);
  assert.equal(authCallbackOrigin(internal, env, headers({ 'x-forwarded-host': 'evil.example' })), APP);
  assert.equal(authCallbackOrigin(internal, env), APP, 'without the request\'s headers, as before');
  assert.throws(() => authCallbackOrigin(internal, { NODE_ENV: 'production', APP_PUBLIC_URL: OPEN }, headers({ host: 'open.example.test' })), /AUTH_PUBLIC_ORIGIN_MISSING/);
});
