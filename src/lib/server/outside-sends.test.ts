import assert from 'node:assert/strict';
import test from 'node:test';
import { matchOutsideSends, type KnownLead, type SentMessage } from './outside-sends';

const lead = (email: string): KnownLead => ({ id: `lead-${email}`, email, name: 'Paula Ríos', company: 'Retail Andino', title: 'Gerente de Personas' });
const sent = (id: string, sentAt: string, recipients: string[], internetMessageId: string | null = null): SentMessage =>
  ({ id, threadId: `t-${id}`, internetMessageId, subject: 'Reunión', sentAt, recipients });

test('a message from the person\'s own mailbox to a known lead with no contact yet is a first contact (audit T1)', () => {
  const leads = new Map([['paula@retailandino.cl', lead('paula@retailandino.cl')], ['ana@acme.cl', lead('ana@acme.cl')]]);
  const matches = matchOutsideSends([
    sent('m2', '2026-10-20T12:00:00Z', ['Paula@RetailAndino.cl']),
    sent('m1', '2026-10-18T12:00:00Z', ['Paula Ríos <paula@retailandino.cl>', 'otro@externo.cl']),
    sent('m3', '2026-10-21T12:00:00Z', ['ana@acme.cl']),
    sent('m4', '2026-10-22T12:00:00Z', ['quien@noesla.cl']),
  ], leads, new Set(['ana@acme.cl']), new Set());
  assert.deepEqual(matches.map(match => [match.message.id, match.lead.email]), [['m1', 'paula@retailandino.cl']],
    'once per lead, by its earliest message; a lead already contacted and an address that is no lead are left alone');
});

test('a message already recorded (sent from the app) is never recorded again, by its id or its Message-ID', () => {
  const leads = new Map([['paula@retailandino.cl', lead('paula@retailandino.cl')]]);
  assert.equal(matchOutsideSends([sent('m1', '2026-10-18T12:00:00Z', ['paula@retailandino.cl'])], leads, new Set(), new Set(['m1'])).length, 0);
  assert.equal(matchOutsideSends([sent('m9', '2026-10-18T12:00:00Z', ['paula@retailandino.cl'], '<abc@mail>')], leads, new Set(), new Set(['<abc@mail>'])).length, 0);
});
