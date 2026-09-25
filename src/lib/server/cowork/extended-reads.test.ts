import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queryCoworkExtendedReads, readCoworkAppContext } from './extended-reads';

const scope = { userId: 'user-1', organizationId: 'org-1' };
const LEAD = '00000000-0000-4000-8000-000000000001';

function mockClient(tables: Record<string, { rows?: unknown[]; count?: number; error?: { message: string }; single?: unknown }> = {}, storageFiles: Record<string, Array<{ name: string; size?: number }>> = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => {
          calls.push({ table: `storage:${bucket}`, method: 'list', args: [prefix] });
          const files = storageFiles[`${bucket}/${prefix}`];
          if (!files) return { data: [], error: null };
          return { data: files.map(file => ({ name: file.name, metadata: { size: file.size || 0 } })), error: null };
        },
      }),
    },
    from: (table: string) => {
      const state = tables[table] || {};
      const chain: Record<string, (...args: any[]) => any> = {
        select: (...args) => { calls.push({ table, method: 'select', args }); return chain; },
        eq: (...args) => { calls.push({ table, method: 'eq', args }); return chain; },
        order: () => chain, limit: () => chain, or: () => chain, gte: () => chain, in: () => chain, not: (...args) => { calls.push({ table, method: 'not', args }); return chain; },
        maybeSingle: async () => state.error
          ? { data: null, error: state.error }
          : { data: (state.single ?? null) as unknown, error: null },
        then: (resolve: (value: unknown) => void) => resolve(state.error
          ? { data: null, error: state.error }
          : { data: state.rows ?? [], error: null, count: state.count ?? (state.rows?.length || 0) }),
      };
      return chain;
    },
  } as never;
  return { client, calls };
}

test('crm.search returns team rows with scope label and caps at 20', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ id: `lead-${index}`, name: 'Ana' }));
  const { client, calls } = mockClient({ leads: { rows } });
  const result = await queryCoworkExtendedReads(client, scope, 'crm.search', 'Ana');
  assert.equal(result.scope, 'organization_crm');
  assert.equal(result.returned, 20);
  assert.equal(result.truncated, true);
  assert.ok(calls.some(call => call.method === 'eq' && call.args[0] === 'organization_id' && call.args[1] === 'org-1'));
  assert.ok(!calls.some(call => call.method === 'eq' && call.args[0] === 'user_id'), 'team scope must not filter by user');
});

test('crm.search rejects punctuation-only terms', async () => {
  const { client } = mockClient();
  await assert.rejects(queryCoworkExtendedReads(client, scope, 'crm.search', '!!!'), /Invalid search term/);
});

test('crm.get_lead requires UUID and returns lead plus contacted history', async () => {
  const { client } = mockClient();
  await assert.rejects(queryCoworkExtendedReads(client, scope, 'crm.get_lead', 'not-a-uuid'), /uuid/i);
  const lead = { id: LEAD, name: 'Ana' };
  const ok = mockClient({ leads: { single: lead }, contacted_leads: { rows: [{ id: 'c1' }] } });
  const result = await queryCoworkExtendedReads(ok.client, scope, 'crm.get_lead', LEAD) as {
    lead: unknown; contacted: unknown[];
  };
  assert.deepEqual(result.lead, lead);
  assert.equal(result.contacted.length, 1);
});

test('contacted.timeline requires UUID and database errors stay generic', async () => {
  const { client } = mockClient();
  await assert.rejects(queryCoworkExtendedReads(client, scope, 'contacted.timeline', 'x'), /uuid/i);
  const failing = mockClient({ contacted_leads: { error: { message: 'db down' } } });
  await assert.rejects(
    queryCoworkExtendedReads(failing.client, scope, 'contacted.search', 'Ana'),
    /No se pudieron consultar los contactados/);
});

test('contacted.timeline derives whose turn it is without trusting prose', async () => {
  const sent = new Date(Date.now() - 3600000).toISOString();
  const replied = new Date(Date.now() - 1800000).toISOString();
  const answered = mockClient({ contacted_leads: { rows: [
    { id: 'c1', sent_at: sent, replied_at: replied, reply_intent: 'positive' },
  ] } });
  const ours = await queryCoworkExtendedReads(answered.client, scope, 'contacted.timeline', LEAD) as {
    turn: { status: string }; observedTurn: { status: string }; truncated: boolean;
  };
  assert.equal(ours.turn.status, 'unknown');
  assert.equal(ours.observedTurn.status, 'our_turn');
  assert.equal(ours.truncated, false);
  const waiting = mockClient({ contacted_leads: { rows: [{ id: 'c1', sent_at: sent, replied_at: null }] } });
  const theirs = await queryCoworkExtendedReads(waiting.client, scope, 'contacted.timeline', LEAD) as {
    turn: { status: string }; observedTurn: { status: string };
  };
  assert.equal(theirs.turn.status, 'unknown');
  assert.equal(theirs.observedTurn.status, 'their_turn');
  const auto = mockClient({ contacted_leads: { rows: [
    { id: 'c1', sent_at: sent, replied_at: replied, reply_intent: 'auto_reply' },
  ] } });
  const stillTheirs = await queryCoworkExtendedReads(auto.client, scope, 'contacted.timeline', LEAD) as {
    turn: { status: string }; observedTurn: { status: string };
  };
  assert.equal(stillTheirs.turn.status, 'unknown');
  assert.equal(stillTheirs.observedTurn.status, 'their_turn');
  const partial = mockClient({ contacted_leads: { rows: Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, sent_at: sent })) } });
  const unknown = await queryCoworkExtendedReads(partial.client, scope, 'contacted.timeline', LEAD) as {
    turn: { status: string }; truncated: boolean;
  };
  assert.equal(unknown.turn.status, 'unknown');
  assert.equal(unknown.truncated, true);
});

test('metrics.overview reports the last 7 days with explicit scope', async () => {
  const tables = {
    leads: { count: 100 }, contacted_leads: { count: 7 },
  };
  const { client, calls } = mockClient(tables);
  const result = await queryCoworkExtendedReads(client, scope, 'metrics.overview', '') as {
    period: string; scope: string; savedContacts: number; repliesThisWeek: number;
    autoRepliesThisWeek: number; bouncesThisWeek: number;
  };
  assert.equal(result.period, 'last_7_days');
  assert.equal(result.scope, 'organization_metrics');
  assert.equal(result.savedContacts, 100);
  assert.ok(calls.some(call => call.method === 'not' && call.args[0] === 'reply_intent'),
    'human replies must exclude automatic and bounce intents');
  assert.equal(result.repliesThisWeek, 7);
  assert.equal(result.autoRepliesThisWeek, 7);
  assert.equal(result.bouncesThisWeek, 7);
});

test('app.context exposes connections and offer without tokens or memories', async () => {
  const builder = async () => ({
    emailConnections: { google: true, outlook: false },
    counts: { leads: 3, contacted: 1, campaigns: 0, activeMissions: 0, openExceptions: 0 },
    performance: null, offer: 'Logística',
    user: { id: 'user-1' }, organizationId: 'org-1', profile: { secret: 'x' }, memories: [{ key: 'k', text: 't' }],
  });
  const result = await readCoworkAppContext(scope, builder as never);
  assert.equal(result.scope, 'organization_context');
  assert.deepEqual(result.emailConnections, { google: true, outlook: false });
  assert.ok(!('profile' in result) && !('memories' in result));
});

test('files.list scopes to the user prefix and reports names without contents', async () => {
  const { client, calls } = mockClient({}, {
    'cowork-uploads/org-1/user-1': [{ name: 'run-a' }, { name: 'run-b' }],
    'cowork-uploads/org-1/user-1/run-a': [{ name: 'in.csv', size: 12 }],
  });
  const result = await queryCoworkExtendedReads(client, scope, 'files.list', '');
  assert.equal(result.scope, 'own_uploads');
  assert.deepEqual(result.files, [{ name: 'in.csv', runId: 'run-a', size: 12, updatedAt: '' }]);
  assert.ok(calls.every(call => String(call.args[0] || '').startsWith('org-1/user-1')));
  assert.ok(!JSON.stringify(result).includes('a,b'));
});

test('app.context never sends "[object Object]": JSON company profiles become readable offers', async () => {
  const builder = async () => ({
    emailConnections: { google: true, outlook: false },
    counts: { leads: 3, contacted: 0, campaigns: 0, activeMissions: 0, openExceptions: 0 },
    performance: null, offer: null, user: { id: 'user-1' }, organizationId: 'org-1', profile: null, memories: [],
  });
  const client = { from: () => {
    const chain = { select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: { user_company_profile: { companyName: 'Yago SpA', products: [{ name: 'AXIS', summary: 'consultas judiciales automáticas en el PJUD' }] } }, error: null }) };
    return chain;
  } };
  const result = await readCoworkAppContext(scope, builder as never, client as never);
  assert.equal(result.offer, 'Yago SpA. Productos: AXIS: consultas judiciales automáticas en el PJUD');
  assert.equal(result.offerSource, 'organization');
  assert.doesNotMatch(JSON.stringify(result), /\[object Object\]/);
});
