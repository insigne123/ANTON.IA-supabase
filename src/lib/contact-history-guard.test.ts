import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  findPriorReplyMatch,
  hasLeadReplied,
  shouldPermanentlySuppressContact,
} from '@/lib/contact-history-guard';
import { detectDeliveryFailure } from '@/lib/delivery-failure-detector';

const repairMigration = await readFile(
  new URL('../../supabase/migrations/20260813110000_remove_legacy_negative_reply_suppressions.sql', import.meta.url),
  'utf8',
);

test('hasLeadReplied detects historical replies robustly', () => {
  assert.equal(hasLeadReplied({ repliedAt: '2026-01-01T10:00:00Z' } as any), true);
  assert.equal(hasLeadReplied({ status: 'replied' } as any), true);
  assert.equal(hasLeadReplied({ replyIntent: 'positive' } as any), true);
  assert.equal(hasLeadReplied({ lastReplyText: 'Gracias, me interesa.' } as any), true);
  assert.equal(hasLeadReplied({ status: 'sent' } as any), false);
});

test('findPriorReplyMatch matches by email and lead id', () => {
  const history = [
    { leadId: 'lead-1', email: 'persona@empresa.com', status: 'replied' },
    { leadId: 'lead-2', email: 'otra@empresa.com', status: 'sent' },
  ] as any[];

  assert.ok(findPriorReplyMatch({ id: 'lead-1', email: 'persona@empresa.com' }, history));
  assert.ok(findPriorReplyMatch({ id: 'otro-id', email: 'persona@empresa.com' }, history));
  assert.equal(findPriorReplyMatch({ id: 'lead-2', email: 'otra@empresa.com' }, history), null);
});

test('unsubscribe permanently suppresses future contact', () => {
  assert.equal(shouldPermanentlySuppressContact({ replyIntent: 'unsubscribe' } as any), true);
  assert.equal(shouldPermanentlySuppressContact({
    replyIntent: 'negative',
    lastReplyText: 'Please do not contact me again.',
  } as any), true);
});

test('legacy repair deletes only the exact negative-reply suppression reason', () => {
  const deleteStatements = repairMigration.match(/delete\s+from\s+public\.unsubscribed_emails[\s\S]*?;/gi) || [];

  assert.deepEqual(deleteStatements.map((statement) => statement.replace(/\s+/g, ' ').trim()), [
    "delete from public.unsubscribed_emails where reason = 'reply:negative';",
  ]);
});

test('mailbox full and temporary delivery failures skip automation without permanent suppression', () => {
  const mailboxFull = detectDeliveryFailure({
    subject: 'Undeliverable',
    from: 'mailer-daemon@example.com',
    text: 'The recipient mailbox is full and quota exceeded.',
  });
  const temporaryFailure = detectDeliveryFailure({
    subject: 'Delivery delayed',
    from: 'mailer-daemon@example.com',
    text: 'Delivery temporarily failed. Please try again later.',
  });

  assert.ok(mailboxFull);
  assert.ok(temporaryFailure);
  assert.equal(shouldPermanentlySuppressContact(mailboxFull as any), false);
  assert.equal(shouldPermanentlySuppressContact(temporaryFailure as any), false);
  assert.equal(hasLeadReplied(mailboxFull as any), true);
});

test('auto replies and neutral replies are not permanent suppression', () => {
  assert.equal(shouldPermanentlySuppressContact({ replyIntent: 'auto_reply' } as any), false);
  assert.equal(shouldPermanentlySuppressContact({ replyIntent: 'neutral' } as any), false);
  assert.equal(shouldPermanentlySuppressContact({ replyIntent: 'negative', lastReplyText: 'No me interesa.' } as any), false);
});

test('permanent delivery-failure metadata remains suppressive', () => {
  const hardFailure = detectDeliveryFailure({
    subject: 'Undeliverable',
    from: 'mailer-daemon@example.com',
    text: '550 5.1.1 User unknown. The mailbox does not exist.',
  });

  assert.ok(hardFailure);
  assert.equal(shouldPermanentlySuppressContact(hardFailure as any), true);
  assert.equal(shouldPermanentlySuppressContact({
    deliveryStatus: hardFailure.deliveryStatus,
    bounceCategory: hardFailure.bounceCategory,
    evaluationStatus: hardFailure.evaluationStatus,
  } as any), true);
});
