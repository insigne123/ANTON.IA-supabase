import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeFitAnswer, resolveFitProposal } from './workspace-proposals';
import { saveOpportunityOfferPrices } from './workspace-offer';

const ORG = '00000000-0000-4000-8000-000000000001';
const OPP = '00000000-0000-4000-8000-0000000000aa';
const ADMIN = '00000000-0000-4000-8000-000000000010';
const ANA = '00000000-0000-4000-8000-000000000011';
const LUIS = '00000000-0000-4000-8000-000000000012';
const PROPOSAL = '00000000-0000-4000-8000-0000000000b1';

type Row = Record<string, any>;
/** A service client over mutable tables: filters (also `column->>key`), update, upsert, select-after-update; it counts every write. */
function fakeClient(tables: Record<string, Row[]>, canRead = true) {
  const writes: Array<{ table: string; kind: 'update' | 'upsert'; value: any }> = [];
  let next = 1;
  return { writes, tables, rpc: async () => ({ data: canRead, error: null }), from(table: string) {
    tables[table] ||= [];
    const filters: Array<(row: Row) => boolean> = []; let patch: Row | null = null;
    const read = (row: Row, column: string) => { const [name, key] = column.split('->>'); return key ? row[name]?.[key] : row[name]; };
    const run = () => {
      const matched = tables[table].filter(row => filters.every(test => test(row)));
      if (patch) { for (const row of matched) Object.assign(row, patch); writes.push({ table, kind: 'update', value: patch }); }
      return matched;
    };
    const chain: any = {
      select() { return chain; }, limit() { return chain; }, order() { return chain; },
      eq(column: string, value: unknown) { filters.push(row => read(row, column) === undefined || read(row, column) === value); return chain; },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(read(row, column))); return chain; },
      update(value: Row) { patch = value; return chain; },
      upsert(value: Row | Row[]) { for (const row of Array.isArray(value) ? value : [value]) tables[table].push({ id: `row-${next++}`, created_at: '2026-10-22T10:00:00Z', ...row }); writes.push({ table, kind: 'upsert', value }); return Promise.resolve({ data: null, error: null }); },
      async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: run(), error: null }).then(resolve); },
    };
    return chain;
  } };
}
const scopeOf = (userId: string, role: string) => ({ organizationId: ORG, userId, role });
const world = (extra: Record<string, Row[]> = {}) => ({
  commercial_opportunities: [{ organization_id: ORG, id: OPP, title: 'Guardias Municipalidad' }],
  opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, responsible_id: ANA }],
  organization_members: [{ organization_id: ORG, user_id: ADMIN, role: 'admin' }, { organization_id: ORG, user_id: ANA, role: 'member' }, { organization_id: ORG, user_id: LUIS, role: 'member' }],
  opportunity_tender_profile: [{ organization_id: ORG, answers: {}, revision: 3 }],
  opportunity_activity: [] as Row[],
  ...extra,
});
const pending = (extra: Row = {}) => ({ id: PROPOSAL, organization_id: ORG, opportunity_id: OPP, kind: 'fit_proposal', actor_id: LUIS, created_at: '2026-10-22T09:00:00Z', body: 'Propone…',
  data: { question: '¿Tienen certificación ISO 9001?', answer: 'Sí, vigente hasta 2027', status: 'pending' }, ...extra });

test('what a member answers for the company waits in the activity, and the administrators are told; the ficha is not touched', async () => {
  const client = fakeClient(world());
  await proposeFitAnswer(client as never, scopeOf(LUIS, 'member'), OPP, { question: '¿Tienen certificación ISO 9001?', answer: 'Sí, vigente hasta 2027' });
  const line = client.tables.opportunity_activity[0];
  assert.deepEqual([line.kind, line.actor_id, line.data], ['fit_proposal', LUIS, { question: '¿Tienen certificación ISO 9001?', answer: 'Sí, vigente hasta 2027', status: 'pending' }]);
  assert.match(line.body, /^Propone para la ficha: «¿Tienen certificación ISO 9001\?» → Sí, vigente hasta 2027$/);
  const notices = client.tables.opportunity_notifications;
  assert.deepEqual(notices.map(row => row.user_id).sort(), [ADMIN, ANA].sort());
  assert.equal(client.writes.some(write => write.table === 'opportunity_tender_profile'), false, 'nothing reaches the ficha');
  assert.deepEqual(client.tables.opportunity_tender_profile[0].answers, {});
});

test('the same person answering the same question again replaces their answer instead of piling up', async () => {
  const client = fakeClient(world({ opportunity_activity: [pending()] }));
  await proposeFitAnswer(client as never, scopeOf(LUIS, 'member'), OPP, { question: '¿Tienen certificación ISO 9001?', answer: 'No, está en trámite' });
  assert.equal(client.tables.opportunity_activity.length, 1);
  assert.equal(client.tables.opportunity_activity[0].data.answer, 'No, está en trámite');
  assert.match(client.tables.opportunity_activity[0].body, /No, está en trámite/);
  assert.equal(client.tables.opportunity_notifications?.length ?? 0, 0, 'no second notice for the same question');
  await proposeFitAnswer(client as never, scopeOf(ANA, 'member'), OPP, { question: '¿Tienen certificación ISO 9001?', answer: 'Sí' });
  assert.equal(client.tables.opportunity_activity.length, 2, 'another person is another proposal');
});

test('confirming an answer writes it into the ficha once, marks it, and tells whoever gave it', async () => {
  const client = fakeClient(world({ opportunity_activity: [pending()] }));
  const accepted = await resolveFitProposal(client as never, scopeOf(ADMIN, 'admin'), OPP, { activityId: PROPOSAL, accept: true });
  assert.deepEqual(accepted, { question: '¿Tienen certificación ISO 9001?', answer: 'Sí, vigente hasta 2027' });
  const profile = client.tables.opportunity_tender_profile[0];
  assert.equal(profile.revision, 4);
  assert.deepEqual(profile.answers.notes.map((note: Row) => [note.question, note.answer]), [['¿Tienen certificación ISO 9001?', 'Sí, vigente hasta 2027']]);
  assert.equal(profile.updated_by, ADMIN);
  const line = client.tables.opportunity_activity.find(row => row.id === PROPOSAL)!;
  assert.deepEqual([line.data.status, line.data.resolvedBy], ['accepted', ADMIN]);
  assert.ok(client.tables.opportunity_activity.some(row => row.kind === 'fit_proposal_resolved' && /^Confirmada en la ficha/.test(row.body)));
  assert.deepEqual(client.tables.opportunity_notifications.map(row => [row.user_id, row.title.split(':')[0]]), [[LUIS, 'Confirmaron tu respuesta para la ficha']]);
  await assert.rejects(resolveFitProposal(client as never, scopeOf(ADMIN, 'admin'), OPP, { activityId: PROPOSAL, accept: true }), /ya se revisó/);
  assert.equal(client.tables.opportunity_tender_profile[0].revision, 4, 'a second confirmation writes nothing more');
});

test('dropping an answer leaves the ficha as it was', async () => {
  const client = fakeClient(world({ opportunity_activity: [pending()] }));
  assert.equal(await resolveFitProposal(client as never, scopeOf(ADMIN, 'admin'), OPP, { activityId: PROPOSAL, accept: false }), null);
  assert.equal(client.tables.opportunity_tender_profile[0].revision, 3);
  assert.equal(client.tables.opportunity_activity.find(row => row.id === PROPOSAL)!.data.status, 'rejected');
  assert.match(client.tables.opportunity_notifications[0].title, /^Descartaron tu respuesta para la ficha/);
  await assert.rejects(resolveFitProposal(fakeClient(world()) as never, scopeOf(ADMIN, 'admin'), OPP, { activityId: PROPOSAL, accept: true }), /No encontramos esa respuesta/);
});

test('the prices of the offer are set by an administrator or whoever is in charge; the rest of the team cannot', async () => {
  const drafts = () => [{ organization_id: ORG, opportunity_id: OPP, id: 'draft-1', revision: 2, draft: { economic: { lines: [{}, {}] } }, prices: {} }];
  const input = { draftId: 'draft-1', expectedRevision: 2, prices: { 0: 7000000 } };
  const blocked = fakeClient(world({ opportunity_offer_drafts: drafts() }));
  await assert.rejects(saveOpportunityOfferPrices(blocked as never, scopeOf(LUIS, 'member'), OPP, input), /Los precios los fija quien está a cargo/);
  assert.equal(blocked.writes.length, 0);
  for (const who of [scopeOf(ANA, 'member'), scopeOf(ADMIN, 'admin')]) {
    const client = fakeClient(world({ opportunity_offer_drafts: drafts() }));
    const saved = await saveOpportunityOfferPrices(client as never, who, OPP, input);
    assert.deepEqual(saved.prices, { 0: 7000000 }); assert.equal(saved.revision, 3);
  }
  const nobody = fakeClient(world({ opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, responsible_id: null }], opportunity_offer_drafts: drafts() }));
  assert.equal((await saveOpportunityOfferPrices(nobody as never, scopeOf(LUIS, 'member'), OPP, input)).revision, 3, 'with nobody in charge, the team can');
});
