import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkMailboxIdentity } from './sender-identity';

test('mailbox identity is provider-verified, stable and contains no token', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
      assert.match(String(url), /^https:\/\/gmail.googleapis.com\//);
      assert.equal(options?.redirect, 'error');
      return new Response(JSON.stringify({ emailAddress: 'Seller@Example.com' }));
    }) as typeof fetch;
    const first = await coworkMailboxIdentity('google', 'private-token');
    assert.equal(first.email, 'seller@example.com');
    assert.equal(JSON.stringify(first).includes('private-token'), false);
    assert.deepEqual(await coworkMailboxIdentity('google', 'new-token'), first);
    globalThis.fetch = (async () => new Response(JSON.stringify({ emailAddress: 'other@example.com' }))) as typeof fetch;
    assert.notEqual((await coworkMailboxIdentity('google', 'private-token')).identityHash, first.identityHash);
    globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;
    await assert.rejects(coworkMailboxIdentity('google', 'private-token'), /comprobar/);
  } finally { globalThis.fetch = original; }
});
