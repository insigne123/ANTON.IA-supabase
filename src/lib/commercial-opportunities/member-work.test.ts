import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_STAGES, DECISION_LABELS, MEMBER_FILTERS, adminMoves, canSetPrices, decisionBody, decisionReplySchema, decisionSchema, fitProposalSchema, fitResolveSchema, isFinished, memberFilter, memberMayMove, memberSteps, memberView, openDecision, pendingFitProposals, stateNoteSchema, type ActivityLike } from './member-work';

test('each stage offers the person one way forward first and the exits after it', () => {
  assert.deepEqual(memberSteps('assigned').map(step => [step.to, Boolean(step.primary), Boolean(step.needsNote)]), [['working', true, false], ['blocked', false, true]]);
  assert.deepEqual(memberSteps(null).map(step => step.to), ['working', 'blocked'], 'no record yet reads as just assigned');
  assert.deepEqual(memberSteps('working').map(step => step.to), ['submitted', 'blocked']);
  assert.deepEqual(memberSteps('blocked').map(step => [step.to, step.label]), [['working', 'Retomarla']]);
  assert.deepEqual(memberSteps('submitted').map(step => step.to), ['working'], 'a presented one taken by mistake can go back');
  for (const closed of ['won', 'lost', 'archived', 'unassigned'] as const) assert.deepEqual(memberSteps(closed), []);
  for (const state of ['assigned', 'working', 'blocked', 'submitted'] as const) for (const step of memberSteps(state)) assert.equal(memberMayMove(state, step.to), true, `${state} → ${step.to}`);
});

test('an opportunity that was handed in or closed is finished: the page stops pushing «Cómo postular» from then on', () => {
  for (const state of ['submitted', 'won', 'lost', 'archived'] as const) assert.equal(isFinished(state), true, state);
  for (const state of ['unassigned', 'assigned', 'working', 'blocked', null, undefined] as const) assert.equal(isFinished(state), false, String(state));
});

test('a member never sets a stage that belongs to the administrators, nor reopens one they closed', () => {
  for (const to of ['assigned', 'unassigned', 'won', 'lost', 'archived'] as const) assert.equal(memberMayMove('working', to), false, to);
  for (const from of ['won', 'lost', 'archived', 'unassigned'] as const) assert.equal(memberMayMove(from, 'working'), false, from);
  assert.equal(memberMayMove(undefined, 'working'), true);
});

test('a decision is a request or a proposal not to bid, with its reason and an optional date', () => {
  assert.equal(decisionBody('no_go', '  El plazo no\nalcanza  '), 'Propone no postular: El plazo no alcanza');
  assert.equal(decisionBody('ask', 'Quién firma la garantía'), 'Pide una decisión: Quién firma la garantía');
  assert.equal(DECISION_LABELS.ask, 'Pide una decisión');
  assert.equal(decisionSchema.parse({ type: 'ask', text: 'Necesito saber quién firma' }).dueAt, null);
  assert.equal(decisionSchema.safeParse({ type: 'ask', text: 'ok' }).success, false, 'a reason of two letters says nothing');
  assert.equal(decisionSchema.safeParse({ type: 'reply', text: 'Sí, postulemos' }).success, false);
  assert.equal(decisionSchema.safeParse({ type: 'ask', text: 'Con fecha', dueAt: '2026-10-25T12:00:00-03:00' }).success, true);
  assert.equal(decisionSchema.safeParse({ type: 'ask', text: 'Con fecha', dueAt: 'mañana' }).success, false);
  assert.equal(decisionReplySchema.safeParse({ text: 'Sí' }).success, true);
  assert.equal(stateNoteSchema.safeParse('  ').success, false);
});

const line = (id: string, kind: string, type?: string, extra: Partial<ActivityLike> = {}): ActivityLike =>
  ({ id, kind, body: `${kind}:${id}`, actor_id: 'u1', created_at: `2026-10-2${id}T10:00:00Z`, data: type ? { type } : {}, ...extra });

test('the decision waiting for an answer is the newest one, until a later line answers it', () => {
  assert.equal(openDecision([]), null);
  assert.equal(openDecision([line('3', 'note'), line('2', 'task')]), null);
  const open = openDecision([line('3', 'note'), line('2', 'decision', 'no_go', { data: { type: 'no_go', dueAt: '2026-10-25T12:00:00-03:00' } }), line('1', 'decision', 'ask')]);
  assert.deepEqual(open && [open.id, open.type, open.dueAt, open.actorId], ['2', 'no_go', '2026-10-25T12:00:00-03:00', 'u1']);
  assert.equal(openDecision([line('3', 'decision', 'reply'), line('2', 'decision', 'ask')]), null, 'answered');
  assert.equal(openDecision([line('4', 'decision', 'ask'), line('3', 'decision', 'reply'), line('2', 'decision', 'ask')])?.id, '4', 'a new request after an answer is open again');
  assert.equal(openDecision([{ ...line('1', 'decision'), data: null }]), null, 'a decision line without its type is not a request');
});

test('«Mi trabajo» is what is still open; what was presented or closed is one filter away', () => {
  assert.deepEqual(MEMBER_FILTERS.map(([key]) => key), ['all', 'assigned', 'working', 'blocked', 'done']);
  for (const open of ['assigned', 'working', 'blocked', null, undefined] as const) {
    assert.equal(memberFilter('all', open), true, String(open));
    assert.equal(memberFilter('recommended', open), true, 'the page opens on a filter no member sees: it reads as «Mi trabajo»');
    assert.equal(memberFilter('done', open), false, String(open));
  }
  for (const done of ['submitted', 'won', 'lost', 'archived'] as const) { assert.equal(memberFilter('all', done), false, done); assert.equal(memberFilter('done', done), true, done); }
  assert.equal(memberFilter('assigned', 'assigned'), true); assert.equal(memberFilter('assigned', null), true, 'no record yet reads as just assigned');
  assert.equal(memberFilter('working', 'blocked'), false); assert.equal(memberFilter('blocked', 'blocked'), true);
  assert.equal(memberView('done'), 'all', 'the server does not know that filter'); assert.equal(memberView('working'), 'working'); assert.equal(memberView('all'), 'all');
});

test('the prices are set by an administrator or whoever is in charge; with nobody in charge, anyone on the team can', () => {
  assert.equal(canSetPrices('admin', 'u1', 'u2'), true);
  assert.equal(canSetPrices('owner', 'u1', 'u2'), true);
  assert.equal(canSetPrices('member', 'u2', 'u2'), true, 'left in charge');
  assert.equal(canSetPrices('member', 'u1', 'u2'), false, 'somebody else is in charge');
  assert.equal(canSetPrices('member', 'u1', null), true, 'nobody in charge: someone has to be able to');
  assert.equal(canSetPrices(undefined, 'u1', undefined), true);
  assert.equal(canSetPrices(undefined, 'u1', 'u2'), false);
});

test('only the answers still waiting for an administrator are listed, the oldest first', () => {
  const proposal = (id: string, status: string, at: string, extra: Record<string, unknown> = {}): ActivityLike =>
    ({ id, kind: 'fit_proposal', body: id, actor_id: 'u1', created_at: at, data: { question: `¿Pregunta ${id}?`, answer: `Respuesta ${id}`, status, ...extra } });
  const list = pendingFitProposals([proposal('c', 'pending', '2026-10-22T12:00:00Z'), proposal('b', 'accepted', '2026-10-22T11:00:00Z'), proposal('a', 'pending', '2026-10-22T10:00:00Z'),
    proposal('d', 'rejected', '2026-10-22T09:00:00Z'), { id: 'x', kind: 'note', body: 'n', actor_id: null, created_at: '2026-10-22T08:00:00Z', data: { status: 'pending', question: 'q', answer: 'a' } },
    { ...proposal('e', 'pending', '2026-10-22T07:00:00Z'), data: { status: 'pending', question: 7 } }]);
  assert.deepEqual(list.map(item => [item.id, item.question, item.answer]), [['a', '¿Pregunta a?', 'Respuesta a'], ['c', '¿Pregunta c?', 'Respuesta c']]);
  assert.deepEqual(pendingFitProposals([]), []);
  assert.equal(fitProposalSchema.safeParse({ question: 'q', answer: 'a' }).success, false, 'a one-letter question says nothing');
  assert.equal(fitProposalSchema.safeParse({ question: '¿Tienen ISO 9001?', answer: 'Sí, vigente hasta 2027' }).success, true);
  assert.equal(fitResolveSchema.safeParse({ activityId: '00000000-0000-4000-8000-0000000000aa', accept: true }).success, true);
  assert.equal(fitResolveSchema.safeParse({ activityId: 'a1', accept: true }).success, false);
});

test('an administrator can move an opportunity to any stage but the one it is in, and never back to «sin asignar» that way', () => {
  assert.deepEqual(adminMoves('working'), ['assigned', 'blocked', 'submitted', 'won', 'lost', 'archived']);
  assert.deepEqual(adminMoves('won'), ['assigned', 'working', 'blocked', 'submitted', 'lost', 'archived']);
  assert.equal(adminMoves('assigned').includes('assigned'), false);
  assert.equal(ADMIN_STAGES.includes('unassigned' as never), false);
  assert.deepEqual(adminMoves(null), [...ADMIN_STAGES]);
});
