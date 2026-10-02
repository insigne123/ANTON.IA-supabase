import assert from 'node:assert/strict';
import test from 'node:test';

import { closeContactedConversation, ConversationCloseError, readConversationTeamLock } from '@/lib/server/conversation-close';

type Op = { table: string; action: 'select' | 'update' | 'upsert'; payload?: any; filters: Array<[string, string, unknown]> };
type Result = { data: unknown; error: unknown };

function fake(handler: (op: Op) => Result, rpc: (fn: string, args: Record<string, unknown>) => Result = () => ({ data: null, error: null })) {
  const log: Op[] = [];
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const from = (table: string) => {
    const op: Op = { table, action: 'select', filters: [] };
    const run = () => { log.push(op); return Promise.resolve(handler(op)); };
    const query: any = {
      select: () => query,
      update: (payload: any) => { op.action = 'update'; op.payload = payload; return query; },
      upsert: (payload: any) => { op.action = 'upsert'; op.payload = payload; return query; },
      eq: (column: string, value: unknown) => { op.filters.push(['eq', column, value]); return query; },
      in: (column: string, value: unknown) => { op.filters.push(['in', column, value]); return query; },
      limit: () => query,
      maybeSingle: run,
      then: (resolve: any, reject: any) => run().then(resolve, reject),
    };
    return query;
  };
  return { log, rpcs, client: { from, rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push([fn, args]); return rpc(fn, args); } } };
}

const scope = { userId: 'user-ana', organizationId: 'org-1' };
const observedAt = Date.parse('2026-10-01T12:00:00Z');
const filter = (op: Op, column: string) => op.filters.find(([, name]) => name === column)?.[2];

function world(options: { team?: boolean; thread?: any; ownRow?: boolean; crmRows?: Array<{ id: string }>; stageError?: boolean } = {}) {
  return (op: Op): Result => {
    if (op.table === 'contacted_leads' && op.action === 'select') {
      return { data: options.ownRow === false ? null : { id: 'contacted-1', lead_id: 'lead-1', email: 'Marcela@Sodexo.cl' }, error: null };
    }
    if (op.table === 'contacted_leads' && op.action === 'update') return { data: { id: 'contacted-1' }, error: null };
    if (op.table === 'organizations') return { data: { collaboration_v1_enabled: Boolean(options.team) }, error: null };
    if (op.table === 'organization_contact_threads') return { data: options.thread ?? null, error: null };
    if (op.table === 'unified_crm_data' && op.action === 'select') return { data: options.crmRows ?? [], error: null };
    if (op.table === 'leads') return { data: { id: 'lead-1' }, error: null };
    if (op.table === 'unified_crm_data' && op.action === 'upsert') return { data: null, error: options.stageError ? { message: 'denied' } : null };
    throw new Error(`unexpected ${op.action} on ${op.table}`);
  };
}

test('alone: «Sin acuerdo» resolves the conversation and moves the lead to Perdido, without touching any team thread', async () => {
  const { client, log, rpcs } = fake(world());
  const result = await closeContactedConversation(client, scope, { contactedId: 'contacted-1', outcome: 'no_deal', observedAt });
  assert.deepEqual(result, { outcome: 'no_deal', team: { status: null, changed: false }, stage: 'closed_lost', stageSaved: true });
  assert.equal(rpcs.length, 0);
  const resolved = log.find(op => op.table === 'contacted_leads' && op.action === 'update')!;
  assert.deepEqual(resolved.payload, { conversation_resolved_at: '2026-10-01T12:00:00.000Z' });
  assert.equal(filter(resolved, 'user_id'), 'user-ana', 'only the person\'s own conversation');
  const stage = log.find(op => op.action === 'upsert')!;
  assert.equal(stage.payload.id, 'lead_saved|lead-1');
  assert.equal(stage.payload.stage, 'closed_lost');
  assert.equal(stage.payload.organization_id, 'org-1');
});

test('in a team: the active thread closes first, by its lowercased address, and «No interesado» stops this account\'s follow-ups', async () => {
  const thread = { id: 'thread-1', status: 'active', opened_by_user_id: 'user-ana' };
  const { client, log, rpcs } = fake(world({ team: true, thread }), () => ({ data: { status: 'suppressed' }, error: null }));
  const result = await closeContactedConversation(client, scope, { contactedId: 'contacted-1', outcome: 'not_interested', observedAt });
  assert.deepEqual(rpcs, [['close_organization_contact_thread_v1', { p_contact_thread_id: 'thread-1', p_outcome: 'not_interested' }]]);
  assert.equal(filter(log.find(op => op.table === 'organization_contact_threads')!, 'recipient_key'), 'marcela@sodexo.cl');
  assert.deepEqual(result.team, { status: 'suppressed', changed: true });
  const stop = log.filter(op => op.table === 'contacted_leads' && op.action === 'update').find(op => op.payload.campaign_followup_allowed === false)!;
  assert.equal(stop.payload.evaluation_status, 'do_not_contact');
  assert.equal(stop.payload.campaign_followup_reason, 'not_interested');
  assert.equal(filter(stop, 'email'), 'Marcela@Sodexo.cl');
  assert.equal(filter(stop, 'user_id'), 'user-ana');
});

test('a refusal from the team thread is said in plain words and leaves the conversation open', async () => {
  const thread = { id: 'thread-1', status: 'active', opened_by_user_id: 'user-beto' };
  const { client, log } = fake(world({ team: true, thread }), () => ({ data: null, error: { code: '42501', message: 'not authorized' } }));
  await assert.rejects(closeContactedConversation(client, scope, { contactedId: 'contacted-1', outcome: 'no_deal', observedAt }),
    (error: unknown) => error instanceof ConversationCloseError && error.status === 403 && /otra persona del equipo/.test(error.message));
  assert.equal(log.some(op => op.table === 'contacted_leads' && op.action === 'update'), false, 'nothing is resolved');
});

test('a thread that is no longer active is left alone; «Lo retomo yo» keeps the stage', async () => {
  const { client, log, rpcs } = fake(world({ team: true, thread: { id: 'thread-1', status: 'available', opened_by_user_id: null } }));
  const result = await closeContactedConversation(client, scope, { contactedId: 'contacted-1', outcome: 'keep', observedAt });
  assert.equal(rpcs.length, 0);
  assert.deepEqual(result, { outcome: 'keep', team: { status: 'available', changed: false }, stage: null, stageSaved: true });
  assert.equal(log.some(op => op.action === 'upsert'), false);
});

test('the stage goes to the pipeline row that already exists', async () => {
  const { client, log } = fake(world({ crmRows: [{ id: 'lead_enriched|lead-1' }] }));
  await closeContactedConversation(client, scope, { contactedId: 'contacted-1', outcome: 'won', observedAt });
  const stage = log.find(op => op.action === 'upsert')!;
  assert.deepEqual([stage.payload.id, stage.payload.stage], ['lead_enriched|lead-1', 'closed_won']);
});

test('a stage that cannot be saved does not undo the close: the result says so', async () => {
  const original = console.error; console.error = () => {};
  try {
    const { client } = fake(world({ stageError: true }));
    const result = await closeContactedConversation(client, scope, { contactedId: 'contacted-1', outcome: 'won', observedAt });
    assert.deepEqual([result.stage, result.stageSaved], [null, false]);
  } finally { console.error = original; }
});

test('only the person\'s own conversation can be closed', async () => {
  const { client } = fake(world({ ownRow: false }));
  await assert.rejects(closeContactedConversation(client, scope, { contactedId: 'contacted-9', outcome: 'won', observedAt }),
    (error: unknown) => error instanceof ConversationCloseError && error.status === 403);
});

test('the team lock the dialog reads', async () => {
  assert.deepEqual(await readConversationTeamLock(fake(world()).client, scope, 'a@b.cl'), { enabled: false, status: null, mine: false, threadId: null });
  const mine = await readConversationTeamLock(fake(world({ team: true, thread: { id: 't', status: 'active', opened_by_user_id: 'user-ana' } })).client, scope, 'a@b.cl');
  assert.deepEqual(mine, { enabled: true, status: 'active', mine: true, threadId: 't' });
  assert.deepEqual(await readConversationTeamLock(fake(world({ team: true })).client, scope, 'a@b.cl'), { enabled: true, status: null, mine: false, threadId: null });
});
