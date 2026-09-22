import test from 'node:test';
import assert from 'node:assert/strict';
import { readGmailContactMessages } from './gmail-contact-reader';

test('Gmail metadata identifies direction, excludes drafts and exposes partial coverage without tokens', async () => {
  const paths: string[] = [];
  const fake: typeof fetch = async (input, options) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    assert.equal(options?.redirect, 'error');
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'owner@example.com' });
    if (url.pathname.endsWith('/messages')) {
      assert.equal(url.searchParams.get('q'), '{from:lead@example.com to:lead@example.com}');
      return Response.json({ messages: [{ id: 'one' }, { id: 'two' }, { id: 'draft' }], nextPageToken: 'private-cursor' });
    }
    const id = url.pathname.split('/').at(-1)!;
    assert.equal(url.searchParams.get('format'), 'metadata');
    return Response.json({ id, threadId: 'thread', internalDate: '1750000000000',
      labelIds: id === 'draft' ? ['DRAFT'] : id === 'one' ? ['SENT'] : ['INBOX'],
      payload: { headers: [{ name: 'From', value: id === 'two' ? 'lead@example.com' : 'owner@example.com' },
        { name: 'To', value: id === 'two' ? 'owner@example.com' : 'lead@example.com' },
        ...(id === 'two' ? [{ name: 'Auto-Submitted', value: 'auto-replied' }] : [])] } });
  };
  const result = await readGmailContactMessages('secret-token', 'lead@example.com', fake);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].direction, 'outbound');
  assert.equal(result.messages[1].responseKind, 'automated');
  assert.equal(result.hasMore, true);
  assert.equal(result.currentTurn, 'needs_review');
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
  assert.equal(JSON.stringify(result).includes('private-cursor'), false);
  assert.equal(paths.length, 5);
});
test('Gmail refuses query injection and hides provider failure content', async () => {
  let calls = 0;
  const fake: typeof fetch = async () => { calls++; return new Response('private error body', { status: 403 }); };
  await assert.rejects(readGmailContactMessages('token', 'a@example.com} OR in:anywhere', fake));
  assert.equal(calls, 0);
  await assert.rejects(readGmailContactMessages('token', 'a@example.com', fake), /acceso de lectura/);
});
