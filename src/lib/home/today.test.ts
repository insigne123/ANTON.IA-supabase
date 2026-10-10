import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTodayPlan, commitmentDueToday, conversationHref, replyNeedsAnswer, type TodayInput } from '@/lib/home/today';

const NOW = new Date('2026-10-01T15:00:00-03:00');
const base = (overrides: Partial<TodayInput> = {}): TodayInput => ({
  now: NOW,
  profile: { companyName: 'GrupoExpro', hasOffer: true },
  mailProviders: ['google'],
  counts: { saved: 0, withEmail: 0, readyToWrite: 0, sent: 0 },
  replies: [],
  commitments: [],
  ...overrides,
});

test('a brand-new account sees what blocks sending first: its offer, then its mailbox', () => {
  const fresh = buildTodayPlan(base({ profile: { companyName: '', hasOffer: false }, mailProviders: [] }));
  assert.equal(fresh.setupDone, 0);
  assert.equal(fresh.primary.href, '/profile');
  const noMail = buildTodayPlan(base({ mailProviders: [] }));
  assert.equal(noMail.primary.href, '/connections');
  assert.equal(noMail.setup.find((step) => step.id === 'mail')?.done, false);
});

test('with everything set up, the primary step moves from finding to completing emails to writing', () => {
  assert.equal(buildTodayPlan(base()).primary.href, '/search');
  assert.equal(buildTodayPlan(base({ counts: { saved: 4, withEmail: 0, readyToWrite: 0, sent: 0 } })).primary.href, '/saved/leads');
  const ready = buildTodayPlan(base({ counts: { saved: 0, withEmail: 94, readyToWrite: 94, sent: 0 } }));
  assert.equal(ready.primary.href, '/saved/leads/enriched');
  assert.match(ready.primary.title, /94 contactos con correo/);
  assert.equal(ready.queue.at(-1)?.kind, 'ready');
  // The first send step points to the contacts that can be written to.
  assert.equal(ready.setup.find((step) => step.id === 'first_send')?.href, '/saved/leads/enriched');
});

test('people waiting for an answer beat setup, and a meeting request goes first', () => {
  const plan = buildTodayPlan(base({
    mailProviders: [],
    replies: [
      { id: 'c1', name: 'Ana Soto', company: 'Retail Sur', intent: 'positive', repliedAt: '2026-10-01T12:00:00Z' },
      { id: 'c2', name: 'Luis Rojas', company: '', intent: 'meeting_request', repliedAt: '2026-09-30T12:00:00Z' },
    ],
  }));
  assert.equal(plan.primary.href, conversationHref('c2'));
  assert.match(plan.primary.title, /Luis Rojas pidió una reunión/);
  assert.deepEqual(plan.queue.map((item) => item.id), ['reply:c2', 'reply:c1']);
  assert.equal(plan.queue[1]?.href, '/contacted?c=c1');
});

test('overdue commitments are urgent; the ready item needs a mailbox; the queue is short', () => {
  const plan = buildTodayPlan(base({
    commitments: [{ id: 'c3', name: 'Ana', company: 'X', kind: 'call', title: 'Llamar', dueAt: '2026-10-01T09:00:00-03:00' }],
    counts: { saved: 0, withEmail: 10, readyToWrite: 10, sent: 2 },
  }));
  assert.equal(plan.queue[0]?.kind, 'commitment');
  assert.equal(plan.queue[0]?.urgent, true);
  assert.equal(plan.primary.href, '/contacted?c=c3');
  assert.equal(buildTodayPlan(base({ mailProviders: [], counts: { saved: 0, withEmail: 10, readyToWrite: 10, sent: 0 } }))
    .queue.some((item) => item.kind === 'ready'), false);
  const many = buildTodayPlan(base({ replies: Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, name: `P${index}`, company: '', intent: 'positive', repliedAt: '2026-10-01T10:00:00Z' })) }));
  assert.equal(many.queue.length, 6);
});

test('«por responder» follows the conversations rule; commitments count until the end of the day', () => {
  assert.equal(replyNeedsAnswer({ replied_at: '2026-10-01T10:00:00Z', reply_intent: 'positive' }), true);
  assert.equal(replyNeedsAnswer({ replied_at: '2026-10-01T10:00:00Z', reply_intent: 'auto_reply' }), false);
  assert.equal(replyNeedsAnswer({ replied_at: '2026-10-01T10:00:00Z', conversation_outbound_at: '2026-10-01T11:00:00Z' }), false);
  assert.equal(replyNeedsAnswer({ replied_at: null }), false);

  assert.deepEqual(commitmentDueToday({ kind: 'call', title: 'Llamar', dueAt: '2026-10-01T09:00:00-03:00' }, NOW),
    { kind: 'call', title: 'Llamar', dueAt: '2026-10-01T09:00:00-03:00' });
  assert.equal(commitmentDueToday({ kind: 'call', title: 'Llamar', dueAt: '2026-10-05T09:00:00-03:00' }, NOW), null);
  assert.equal(commitmentDueToday({ kind: 'call', title: 'Llamar', dueAt: '2026-09-30T09:00:00Z', completedAt: '2026-09-30T10:00:00Z' }, NOW), null);
  assert.equal(commitmentDueToday(null, NOW), null);
});

test('a historical pending reply keeps its date and uses an initial instead of pretending to know a masked surname',()=>{
  const reply={id:'old',name:'Daniela Ma***o',company:'Demo',intent:'positive',repliedAt:'2026-03-01T10:00:00Z'};
  const plan=buildTodayPlan(base({replies:[reply]}));assert.match(plan.primary.title,/Daniela M\./);assert.doesNotMatch(plan.primary.title,/\*\*/);
  assert.equal(plan.queue[0].occurredAt,reply.repliedAt);
  assert.equal(commitmentDueToday({dueAt:'2026-10-02T03:00:00Z'},NOW),null,'next Chile midnight is tomorrow, even if UTC changed first');
});
