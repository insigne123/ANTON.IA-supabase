import assert from 'node:assert/strict';
import test from 'node:test';

import { dropThread } from './lead-drop-thread';

const DROP = '11111111-1111-4111-8111-111111111111';

test('every email of a drop names the same conversation: one root for Gmail, one conversation id for Outlook, and «Re:» on the answers', () => {
  const first = dropThread({ dropId: DROP, date: '2026-11-17', subject: '6 contactos nuevos para ti' });
  const answer = dropThread({ dropId: DROP, date: '2026-11-17', subject: '6 contactos nuevos para ti', reply: true, now: new Date('2026-11-17T14:30:00Z') });
  const later = dropThread({ dropId: DROP, date: '2026-11-17', subject: '6 contactos nuevos para ti', reply: true, now: new Date('2026-11-17T15:10:00Z') });
  assert.equal(first.subject, '6 contactos nuevos para ti');
  assert.equal(answer.subject, 'Re: 6 contactos nuevos para ti');
  // The sender writes each email's own Message-ID, so none can name another: all name the drop's root.
  assert.equal(first.headers.References, `<contactos.${DROP}@contactos.anton-ia.yago.cl>`);
  for (const thread of [first, answer, later]) {
    assert.equal(thread.headers.References, first.headers.References);
    assert.equal(thread.headers['In-Reply-To'], first.headers.References);
    assert.equal(thread.headers['Thread-Topic'], '6 contactos nuevos para ti');
  }
  // Outlook's index: 22 bytes that open the conversation (a file time and the drop's own id), and 5 more on each answer.
  const head = Buffer.from(first.headers['Thread-Index'], 'base64');
  assert.equal(head.length, 22);
  assert.equal(head[0], 0x01);
  assert.equal(head.subarray(6).toString('hex'), DROP.replace(/-/g, ''));
  const child = Buffer.from(answer.headers['Thread-Index'], 'base64');
  assert.equal(child.length, 27);
  assert.deepEqual(child.subarray(0, 22), head, 'the same conversation');
  assert.notEqual(answer.headers['Thread-Index'], later.headers['Thread-Index'], 'each answer has its own place in it');
  // Another day's drop is another conversation, even with the same subject.
  const other = dropThread({ dropId: '22222222-2222-4222-8222-222222222222', date: '2026-11-18', subject: '6 contactos nuevos para ti' });
  assert.notEqual(other.headers.References, first.headers.References);
  assert.notEqual(other.headers['Thread-Index'], first.headers['Thread-Index']);
});

test('an id that is not a drop\'s gives the subject alone, and a subject cannot break a header', () => {
  assert.deepEqual(dropThread({ dropId: 'drop-1', date: '2026-11-17', subject: 'Tu contacto de hoy', reply: true }), { subject: 'Re: Tu contacto de hoy', headers: {} });
  const thread = dropThread({ dropId: DROP, date: 'no-date', subject: 'Uno\r\nBcc: otro@example.com' });
  assert.equal(thread.headers['Thread-Topic'], 'Uno Bcc: otro@example.com');
  assert.equal(Buffer.from(thread.headers['Thread-Index'], 'base64').length, 22);
});
