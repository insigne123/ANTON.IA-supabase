import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGmailMailboxQuery,
  decodeGmailBase64Url,
  extractEmailAddresses,
  extractGmailMailboxTopic,
  parseGmailMailboxMessage,
  truncateMailboxText,
} from './gmail-mailbox-helpers';

test('buildGmailMailboxQuery creates a limited sent search', () => {
  assert.equal(buildGmailMailboxQuery({ topic: 'Axis', sentOnly: true, newerThan: '12m' }), 'in:sent -in:spam -in:trash newer_than:12m Axis');
  assert.equal(buildGmailMailboxQuery({ topic: 'Axis software', sentOnly: true, newerThan: '12m' }), 'in:sent -in:spam -in:trash newer_than:12m "Axis software"');
  assert.equal(buildGmailMailboxQuery({ topic: 'Axis', sentOnly: true, after: '2026-01-01', before: '2026/06/01' }), 'in:sent -in:spam -in:trash after:2026/01/01 before:2026/06/01 Axis');
});

test('buildGmailMailboxQuery sanitizes raw query spam and trash scopes', () => {
  assert.equal(buildGmailMailboxQuery({ query: 'in:sent in:spam in:trash Axis' }), 'in:sent Axis');
});

test('extractGmailMailboxTopic detects common Spanish wording', () => {
  assert.equal(extractGmailMailboxTopic('Dime todos los leads a los que contacte con mi mail por el tema de Axis.'), 'Axis');
  assert.equal(extractGmailMailboxTopic('Busca correos enviados sobre Axis software'), 'Axis software');
});

test('extractEmailAddresses handles display names and dedupes', () => {
  assert.deepEqual(extractEmailAddresses('Nico <nico@example.com>, "Ana Maria" <ana@example.com>, nico@example.com'), ['nico@example.com', 'ana@example.com']);
});

test('parseGmailMailboxMessage keeps metadata by default', () => {
  const message = {
    id: 'm1',
    threadId: 't1',
    internalDate: String(Date.UTC(2026, 0, 1)),
    snippet: 'Snippet largo con Axis',
    payload: {
      headers: [
        { name: 'Subject', value: 'Axis follow-up' },
        { name: 'From', value: 'Me <me@example.com>' },
        { name: 'To', value: 'Lead <lead@example.com>' },
        { name: 'Date', value: 'Thu, 01 Jan 2026 10:00:00 +0000' },
      ],
      body: { data: Buffer.from('private body').toString('base64url') },
      mimeType: 'text/plain',
    },
  };

  const parsed = parseGmailMailboxMessage(message);
  assert.equal(parsed.id, 'm1');
  assert.equal(parsed.subject, 'Axis follow-up');
  assert.equal(parsed.bodyText, undefined);
});

test('parseGmailMailboxMessage includes truncated body only when requested', () => {
  const body = 'hello '.repeat(500);
  const parsed = parseGmailMailboxMessage({
    id: 'm1',
    payload: { mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') }, headers: [] },
  }, { includeBody: true, bodyLimit: 30 });

  assert.equal(parsed.bodyText?.endsWith('...'), true);
  assert.ok((parsed.bodyText || '').length <= 30);
});

test('decodeGmailBase64Url and truncateMailboxText are safe', () => {
  assert.equal(decodeGmailBase64Url(Buffer.from('hola').toString('base64url')), 'hola');
  assert.equal(truncateMailboxText('a '.repeat(20), 10), 'a a a a...');
});
