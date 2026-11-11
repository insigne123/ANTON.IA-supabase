import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTodayPlan, commitmentDueToday, conversationHref, repliesWaiting, replyNeedsAnswer, type TodayInput } from '@/lib/home/today';

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
  assert.equal(buildTodayPlan(base({ counts: { saved: 4, withEmail: 0, readyToWrite: 0, sent: 0 } })).primary.href, '/saved/leads/enriched');
  const ready = buildTodayPlan(base({ counts: { saved: 0, withEmail: 94, readyToWrite: 94, sent: 0 } }));
  assert.equal(ready.primary.href, '/saved/leads/enriched');
  assert.match(ready.primary.title, /94 contactos con correo/);
  // The step is the ready item: it is not said again in the list (APP-01).
  assert.equal(ready.primary.queueId, 'ready');
  assert.equal(ready.queue.some((item) => item.kind === 'ready'), false);
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
  // The meeting request is the step above; the list keeps the rest (APP-01).
  assert.deepEqual(plan.queue.map((item) => item.id), ['reply:c1']);
  assert.equal(plan.queue[0]?.href, '/contacted?c=c1');
});

test('overdue commitments are urgent; the ready item needs a mailbox; the queue is short', () => {
  const plan = buildTodayPlan(base({
    commitments: [{ id: 'c3', name: 'Ana', company: 'X', kind: 'call', title: 'Llamar', dueAt: '2026-10-01T09:00:00-03:00' }],
    counts: { saved: 0, withEmail: 10, readyToWrite: 10, sent: 2 },
  }));
  assert.equal(plan.primary.href, '/contacted?c=c3');
  assert.equal(plan.primary.queueId, 'commitment:c3');
  assert.equal(plan.queue.some((item) => item.kind === 'commitment'), false, 'the overdue commitment is the step, not a row too');
  assert.equal(plan.queue[0]?.kind, 'ready');
  assert.equal(buildTodayPlan(base({ mailProviders: [], counts: { saved: 0, withEmail: 10, readyToWrite: 10, sent: 0 } }))
    .queue.some((item) => item.kind === 'ready'), false);
  const many = buildTodayPlan(base({ replies: Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, name: `P${index}`, company: '', intent: 'positive', repliedAt: '2026-10-01T10:00:00Z' })) }));
  assert.equal(many.queue.length, 6);
  assert.equal(many.queue.some((item) => item.id === many.primary.queueId), false);
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
  assert.match(plan.primary.description,/^Pendiente desde 1 mar 2026\./);assert.equal(plan.queue.length,0,'the only reply is the step above');
  assert.equal(commitmentDueToday({dueAt:'2026-10-02T03:00:00Z'},NOW),null,'next Chile midnight is tomorrow, even if UTC changed first');
});

test('the number beside «Conversaciones» counts each person who waits once, by the rule of «Por responder» (APP-23)', () => {
  assert.equal(repliesWaiting([
    { id: '1', email: 'ana@cliente.cl', replied_at: '2026-10-01T10:00:00Z', reply_intent: 'positive' },
    { id: '2', email: 'ANA@cliente.cl', replied_at: '2026-10-02T10:00:00Z', reply_intent: 'meeting_request' },
    { id: '3', email: 'bruno@cliente.cl', replied_at: '2026-10-01T10:00:00Z', reply_intent: 'auto_reply' },
    { id: '4', email: 'carla@cliente.cl', replied_at: '2026-10-01T10:00:00Z', conversation_outbound_at: '2026-10-01T12:00:00Z' },
    { id: '5', email: null, replied_at: '2026-10-03T10:00:00Z' },
  ]), 2, 'Ana once, and the reply without an e-mail; not the auto-reply nor the one already answered');
  assert.equal(repliesWaiting([]), 0);
});

test('a first call with its result is a first contact too, for whoever works by phone (plan de uso U5)', () => {
  const step = (counts: TodayInput['counts']) => buildTodayPlan(base({ counts })).setup.find(item => item.id === 'first_send')!;
  assert.equal(step({ saved: 3, withEmail: 0, readyToWrite: 0, sent: 0 }).done, false);
  assert.equal(step({ saved: 3, withEmail: 0, readyToWrite: 0, sent: 0, calls: 1 }).done, true);
  assert.equal(step({ saved: 3, withEmail: 2, readyToWrite: 2, sent: 1 }).done, true);
  assert.equal(step({ saved: 0, withEmail: 0, readyToWrite: 0, sent: 0 }).title, 'Haz tu primer contacto');
});

test('whoever already keeps contacts connects the mailbox before the profile, right from «Hoy» (review of 10 Nov 2026, E2)', () => {
  // Nothing saved yet: the offer first, as before.
  const fresh = buildTodayPlan(base({ profile: { companyName: '', hasOffer: false }, mailProviders: [] }));
  assert.equal(fresh.primary.href, '/profile');
  assert.equal(fresh.primary.choices, undefined);
  // Contacts saved, no mailbox and no profile: the mailbox is what stops the work.
  const searching = buildTodayPlan(base({ profile: { companyName: '', hasOffer: false }, mailProviders: [], counts: { saved: 9, withEmail: 3, readyToWrite: 3, sent: 0 } }));
  assert.equal(searching.primary.title, 'Conecta tu correo');
  assert.deepEqual(searching.primary.choices, [
    { label: 'Conectar Outlook', href: '/api/auth/connect/azure' },
    { label: 'Conectar Gmail', href: '/api/auth/connect/google' },
  ], 'the buttons start the connection: no detour through «Conexiones»');
  // With the mailbox connected the profile is next, with its one button.
  const connected = buildTodayPlan(base({ profile: { companyName: '', hasOffer: false }, counts: { saved: 9, withEmail: 3, readyToWrite: 3, sent: 0 } }));
  assert.equal(connected.primary.href, '/profile');
  assert.equal(connected.primary.choices, undefined);
  // Someone waiting for an answer still goes first.
  const waiting = buildTodayPlan(base({ mailProviders: [], counts: { saved: 9, withEmail: 3, readyToWrite: 3, sent: 0 }, replies: [{ id: 'c-1', name: 'Ana Pérez', company: 'Ripley', intent: null, repliedAt: NOW.toISOString() }] }));
  assert.equal(waiting.primary.cta, 'Abrir conversación');
});
