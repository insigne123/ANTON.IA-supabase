import test from 'node:test';
import assert from 'node:assert/strict';

import { extractGmailContactedContacts } from './gmail-mailbox';

test('extractGmailContactedContacts dedupes recipients and keeps latest evidence', () => {
  const contacts = extractGmailContactedContacts([
    {
      id: 'm1',
      threadId: 't1',
      subject: 'Axis intro',
      from: 'Me <me@example.com>',
      to: 'Ana <ana@axis.com>, Bob <bob@axis.com>',
      internalDate: '2026-01-01T10:00:00.000Z',
      snippet: 'First Axis email',
    },
    {
      id: 'm2',
      threadId: 't2',
      subject: 'Axis follow-up',
      from: 'Me <me@example.com>',
      to: 'Ana <ana@axis.com>',
      internalDate: '2026-01-03T10:00:00.000Z',
      snippet: 'Follow up Axis email',
    },
  ], 'me@example.com');

  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].email, 'ana@axis.com');
  assert.equal(contacts[0].lastSubject, 'Axis follow-up');
  assert.deepEqual(contacts[0].messageIds, ['m1', 'm2']);
  assert.equal(contacts[1].email, 'bob@axis.com');
});
