import assert from 'node:assert/strict';
import test from 'node:test';
import { NextResponse } from 'next/server.js';
import { forwardSessionCookies } from './forward-session-cookies';

test('a session refreshed in the middleware reaches the render of the same request, and the browser gets it once', () => {
  const res = NextResponse.next();
  res.headers.append('set-cookie', 'sb-abc-auth-token=%5B%22nuevo%22%5D; Path=/; Max-Age=31536000; SameSite=Lax');
  forwardSessionCookies(res);
  assert.match(res.headers.get('x-middleware-set-cookie') || '', /sb-abc-auth-token=%5B%22nuevo%22%5D/);
  assert.equal(res.headers.getSetCookie().length, 1);
  assert.match(res.headers.getSetCookie()[0], /Max-Age=31536000/);
});

test('without a refresh nothing is added', () => {
  const res = forwardSessionCookies(NextResponse.next());
  assert.equal(res.headers.get('x-middleware-set-cookie'), null);
  assert.equal(res.headers.getSetCookie().length, 0);
});
