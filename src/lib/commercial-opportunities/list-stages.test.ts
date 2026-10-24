import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_LIST_VIEWS, LIST_VIEWS, adminViewCounts, discardBody, discardSchema, inListView, listStageOf, listViewQuery, memberViewCounts } from './list-stages';
import { PIPELINE_STAGES, pipelineStage } from './pipeline';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const item = (evaluation: string | null, deadline: string | null = '2026-11-01T18:00:00Z', kind = 'tender') => ({ kind, deadline_at: deadline, data: evaluation ? { evaluation } : {} });

test('«Por revisar», «Recomendadas» and «No recomendadas» of the list are what nobody works yet and can still be bid, as in the pipeline', () => {
  assert.deepEqual(listViewQuery('review', true), { stages: ['open'], evaluations: ['review', 'pending'], biddable: true });
  assert.deepEqual(listViewQuery('recommended', true), { stages: ['open'], evaluations: ['recommended'], biddable: true });
  assert.deepEqual(listViewQuery('excluded', true), { stages: ['open'], evaluations: ['excluded'], biddable: true });
  // The same opportunity is in the same place on both: the list's view and the pipeline's stage.
  const cases: Array<[ReturnType<typeof item>, string | null]> = [[item('review'), null], [item('pending'), 'unassigned'], [item('recommended'), null], [item('excluded'), null],
    [item('review'), 'assigned'], [item('recommended'), 'working'], [item('review'), 'blocked'], [item('review'), 'submitted'], [item('recommended'), 'won']];
  const pipelineToList: Record<string, string> = { found: 'review', recommended: 'recommended', excluded: 'excluded', assigned: 'assigned', working: 'working', submitted: 'submitted', won: 'closed' };
  for (const [opportunity, state] of cases) {
    const stage = pipelineStage(opportunity as any, state ? { state: state as any } : null);
    const views = ADMIN_LIST_VIEWS.filter(view => view.id !== 'all' && inListView(view.id, true, opportunity, state as any, NOW)).map(view => view.id);
    assert.deepEqual(views, [pipelineToList[stage]], `${opportunity.data.evaluation} ${state}: ${stage}`);
  }
  assert.ok(PIPELINE_STAGES.every(stage => pipelineToList[stage.id]), 'every stage of the pipeline has its filter');
});

test('an opportunity leaves «Por revisar» when it gets a team or is put aside, and when it can no longer be bid', () => {
  assert.equal(inListView('review', true, item('review'), null, NOW), true);
  assert.equal(inListView('review', true, item('review'), 'assigned', NOW), false);
  assert.equal(inListView('review', true, item('review'), 'archived', NOW), false);
  assert.equal(inListView('closed', true, item('review'), 'archived', NOW), true, 'what was put aside is in «Cerradas»');
  assert.equal(inListView('review', true, item('review', '2026-10-20T18:00:00Z'), null, NOW), false, 'closed already');
  assert.equal(inListView('review', true, item('review', null), null, NOW), true, 'no deadline can still be bid');
  assert.equal(inListView('assigned', true, item('review', '2026-10-20T18:00:00Z'), 'assigned', NOW), true, 'a team\'s work stays whatever its deadline');
  assert.equal(inListView('all', true, item('review', '2026-10-20T18:00:00Z'), null, NOW), true, '«Todas» keeps everything');
  assert.equal(inListView('review', true, item(null, null, 'private'), null, NOW), true, 'a received one without an evaluation is to review');
  assert.equal(inListView('review', true, item(null), null, NOW), false, 'an old one without an evaluation is only in «Todas»');
  assert.equal(listStageOf('unassigned'), 'open');
});

test('a member filters by their own stages; «Mi trabajo» is everything of theirs', () => {
  assert.deepEqual(listViewQuery('all', false), { stages: [], evaluations: [], biddable: false });
  assert.deepEqual(listViewQuery('recommended', false), { stages: [], evaluations: [], biddable: false });
  assert.deepEqual(listViewQuery('working', false), { stages: ['working'], evaluations: [], biddable: false }, 'the blocked ones have their own filter');
  assert.deepEqual(listViewQuery('blocked', false).stages, ['blocked']);
  assert.deepEqual(listViewQuery('working', true).stages, ['working', 'blocked'], 'for the administrator «En preparación» holds the blocked ones too');
  assert.deepEqual(listViewQuery('nonsense', true), { stages: [], evaluations: [], biddable: false });
  assert.ok(ADMIN_LIST_VIEWS.every(view => (LIST_VIEWS as readonly string[]).includes(view.id)), 'the server answers every filter of the page');
});

test('the numbers of the filters add the stages and evaluations of the database', () => {
  const groups = [{ stage: 'open', evaluation: 'review', total: 1200 }, { stage: 'open', evaluation: 'pending', total: 30 }, { stage: 'open', evaluation: 'recommended', total: 55 },
    { stage: 'open', evaluation: 'excluded', total: 3700 }, { stage: 'assigned', evaluation: 'review', total: 2 }, { stage: 'working', evaluation: 'recommended', total: 1 },
    { stage: 'blocked', evaluation: 'review', total: 1 }, { stage: 'won', evaluation: 'recommended', total: 1 }, { stage: 'archived', evaluation: 'review', total: 14 }];
  assert.deepEqual(adminViewCounts(groups), { recommended: 55, review: 1230, excluded: 3700, assigned: 2, working: 2, submitted: 0, closed: 15 });
  assert.deepEqual(memberViewCounts([{ stage: 'assigned', total: 2 }, { stage: 'blocked', total: 1 }, { stage: 'submitted', total: 1 }]), { all: 3, assigned: 2, working: 0, blocked: 1, done: 1 });
});

test('«No es para nosotros» takes a reason in a word and, for «Otro motivo», the line that says which', () => {
  assert.deepEqual(discardSchema.parse({ reason: 'zona' }), { reason: 'zona', note: '' });
  assert.equal(discardBody('zona', '  Solo trabajamos en la RM. '), 'No es para nosotros: fuera de nuestra zona. Solo trabajamos en la RM.');
  assert.equal(discardBody('monto'), 'No es para nosotros: el monto no conviene');
  assert.equal(discardBody('otro', 'El comprador nos debe dos facturas'), 'No es para nosotros: El comprador nos debe dos facturas');
  assert.throws(() => discardSchema.parse({ reason: 'otro', note: '' }), /Cuenta en una línea/);
  assert.throws(() => discardSchema.parse({ reason: 'porque si' }));
  assert.throws(() => discardSchema.parse({ reason: 'zona', note: 'x'.repeat(301) }));
});
