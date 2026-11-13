import assert from 'node:assert/strict';
import test from 'node:test';

import { DROP_LINK_DAYS, dropLinkHref, dropLinkUrl, readDropLink, signDropLink } from './lead-drop-link';

const DROP = '11111111-1111-4111-8111-111111111111';
const env = { INTERNAL_API_SECRET: 'a-secret-for-tests' };
const NOW = new Date('2026-11-13T11:00:00.000Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

test('a link names one drop, is short enough for an email, and reads back until it expires', () => {
  const token = signDropLink(DROP, { now: NOW, env })!;
  assert.match(token, /^[A-Za-z0-9_-]{48}$/);
  assert.deepEqual(readDropLink(token, { now: NOW, env }), { dropId: DROP, expiresAt: later(DROP_LINK_DAYS) });
  assert.deepEqual(readDropLink(token, { now: later(DROP_LINK_DAYS - 1), env }), { dropId: DROP, expiresAt: later(DROP_LINK_DAYS) });
  assert.equal(readDropLink(token, { now: later(DROP_LINK_DAYS), env }), 'expired');
  assert.equal(dropLinkUrl('https://app.example.test/', DROP, { now: NOW, env }), `https://app.example.test${dropLinkHref(token)}`);
  assert.equal(dropLinkHref(token), `/contactos/${token}`);
});

test('nothing but a link this server signed opens a drop', () => {
  const token = signDropLink(DROP, { now: NOW, env })!;
  // One character changed anywhere: the drop it names, when it expires, or the seal.
  for (const at of [0, 10, 24, 30, 47]) {
    const forged = `${token.slice(0, at)}${token[at] === 'A' ? 'B' : 'A'}${token.slice(at + 1)}`;
    assert.equal(readDropLink(forged, { now: NOW, env }), null, `changed at ${at}`);
  }
  assert.equal(readDropLink(token, { now: NOW, env: { INTERNAL_API_SECRET: 'another-secret' } }), null, 'signed with another secret');
  for (const value of ['', 'x', token.slice(1), `${token}A`, `${token.slice(0, 47)}.`, null, undefined, 42, { token }]) assert.equal(readDropLink(value, { now: NOW, env }), null);
  // An expired link someone stretched is not «expired»: it is not ours.
  const old = signDropLink(DROP, { now: later(-30), env })!;
  assert.equal(readDropLink(old, { now: NOW, env }), 'expired');
  assert.equal(readDropLink(`${old.slice(0, 26)}${old[26] === 'A' ? 'B' : 'A'}${old.slice(27)}`, { now: NOW, env }), null);
});

test('without a secret there is no link, and only a drop\'s id is signed', () => {
  assert.equal(signDropLink(DROP, { now: NOW, env: {} }), null);
  assert.equal(dropLinkUrl('https://app.example.test', DROP, { now: NOW, env: {} }), null);
  assert.equal(readDropLink(signDropLink(DROP, { now: NOW, env })!, { now: NOW, env: {} }), null);
  assert.equal(signDropLink('nuevo', { now: NOW, env }), null);
  assert.equal(signDropLink(`${DROP}x`, { now: NOW, env }), null);
});

test('the link has a key of its own: the server\'s secret alone, or its other signatures, do not make one', () => {
  const first = signDropLink(DROP, { now: NOW, env })!;
  // Its own secret wins over the shared ones, and each secret gives a different link.
  const own = signDropLink(DROP, { now: NOW, env: { ...env, LEAD_DROPS_LINK_SECRET: 'only-for-links' } })!;
  assert.notEqual(own, first);
  assert.equal(readDropLink(own, { now: NOW, env }), null);
  assert.deepEqual(readDropLink(first, { now: NOW, env: { SUPABASE_SERVICE_ROLE_KEY: 'x', ...env } }), { dropId: DROP, expiresAt: later(DROP_LINK_DAYS) }, 'the internal secret comes before the service key');
});
