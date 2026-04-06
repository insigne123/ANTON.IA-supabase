import test from 'node:test';
import assert from 'node:assert/strict';

import { findPriorReplyMatch, hasLeadReplied } from '@/lib/contact-history-guard';

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
