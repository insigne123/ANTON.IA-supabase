import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAdminValue } from '@/lib/server/admin-value-data';

const ORG = 'e73dd11f-c8db-4ffc-9711-47dc74295064';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const ANA = '11111111-1111-4111-8111-111111111111';
const BETO = '22222222-2222-4222-8222-222222222222';
const TEAM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** A tiny in-memory PostgREST: applies eq, in, gte, lt and «not is null» so scoping mistakes show up as wrong numbers. */
class Query {
  private filters: Array<(row: any) => boolean> = [];
  private head = false;
  constructor(private readonly rows: any[], private readonly log: string[], private readonly table: string) {}
  select(_columns: string, options?: { head?: boolean }) { this.head = Boolean(options?.head); return this; }
  eq(column: string, value: unknown) { if (column === 'organization_id') this.log.push(`${this.table}:${value}`); this.filters.push((row) => row[column] === value); return this; }
  neq(column: string, value: unknown) { this.filters.push((row) => row[column] !== value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  gte(column: string, value: string) { this.filters.push((row) => row[column] != null && row[column] >= value); return this; }
  lt(column: string, value: string) { this.filters.push((row) => row[column] != null && row[column] < value); return this; }
  not(column: string) { this.filters.push((row) => row[column] != null); return this; }
  order() { return this; }
  limit() { return this; }
  then(resolve: (value: any) => any, reject?: (reason: unknown) => any) {
    const data = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    return Promise.resolve(this.head ? { data: null, count: data.length, error: null } : { data, count: data.length, error: null }).then(resolve, reject);
  }
}

function client() {
  const log: string[] = [];
  const tables: Record<string, any[]> = {
    organization_members: [
      { organization_id: ORG, user_id: ANA, role: 'owner', created_at: '2026-09-01T00:00:00.000Z' },
      { organization_id: ORG, user_id: BETO, role: 'member', created_at: '2026-09-02T00:00:00.000Z' },
      { organization_id: OTHER_ORG, user_id: '33333333-3333-4333-8333-333333333333', role: 'member', created_at: '2026-09-02T00:00:00.000Z' },
    ],
    organization_reporting_group_members: [{ organization_id: ORG, group_id: TEAM, user_id: BETO, unassigned_at: null }],
    provider_tokens: [{ user_id: ANA, provider: 'google' }],
    profiles: [{ id: ANA, company_name: 'GrupoExpro', signatures: { profile_extended: { valueProposition: 'Personal transitorio en 48 horas' } } }],
    contacted_leads: [
      { organization_id: ORG, user_id: ANA, sent_at: '2026-09-20T12:00:00.000Z', replied_at: '2026-09-21T12:00:00.000Z', reply_intent: 'meeting_request' },
      { organization_id: ORG, user_id: ANA, sent_at: '2026-09-20T12:05:00.000Z', replied_at: '2026-09-21T13:00:00.000Z', reply_intent: 'auto_reply' },
      { organization_id: ORG, user_id: ANA, sent_at: '2026-08-20T12:00:00.000Z', replied_at: null, reply_intent: null },
      { organization_id: OTHER_ORG, user_id: ANA, sent_at: '2026-09-20T12:00:00.000Z', replied_at: '2026-09-21T12:00:00.000Z', reply_intent: 'positive' },
    ],
    leads: [{ organization_id: ORG, user_id: BETO, created_at: '2026-09-25T12:00:00.000Z' }],
    lead_research_jobs: [],
    unified_crm_data: [{ organization_id: ORG, stage: 'meeting', updated_at: '2026-09-22T12:00:00.000Z' }],
    antonia_event_ledger: [{ organization_id: ORG, actor_user_id: BETO, occurred_at: '2026-09-28T12:00:00.000Z', source_confidence: 'observed' }],
  };
  const users: Record<string, any> = {
    [ANA]: { id: ANA, email: 'ana@grupoexpro.com', last_sign_in_at: '2026-09-30T12:00:00.000Z', user_metadata: { full_name: 'Ana Pérez' } },
    [BETO]: { id: BETO, email: 'beto@grupoexpro.com', last_sign_in_at: null, user_metadata: { full_name: 'Beto Soto' } },
  };
  return {
    log,
    from: (table: string) => new Query(tables[table] || [], log, table),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] || null }, error: users[id] ? null : { status: 404 } }) } },
  };
}

const NOW = new Date('2026-10-01T15:00:00.000Z');

test('the organization summary counts real replies, interest and meetings against the previous period', async () => {
  const supabase = client();
  const value = await loadAdminValue(supabase, ORG, { from: '2026-09-02', to: '2026-10-01' }, NOW);

  assert.deepEqual(value.previousRange, { from: '2026-08-03', to: '2026-09-01' });
  assert.equal(value.results.current.sent, 2);
  assert.equal(value.results.previous.sent, 1);
  assert.equal(value.results.current.replies.real, 1, 'the automatic reply does not count');
  assert.equal(value.results.current.replies.automatic, 1);
  assert.equal(value.results.current.interested, 1);
  assert.equal(value.results.current.pipelineMeetings, 1);
  assert.equal(value.results.current.savedContacts, 1);
  assert.deepEqual(value.results.comparison.sent, { value: 2, previous: 1, delta: 1, trend: 'up' });
  assert.ok(supabase.log.every((entry) => !entry.endsWith(OTHER_ORG)), 'never reads another organization');

  assert.deepEqual(value.adoption.funnel.map((step) => step.value), [2, 2, 2, 1, 1]);
  assert.deepEqual(value.needsHelp.map((item) => [item.name, item.reason]), [['Beto Soto', 'no_mail']]);
  const ana = value.people.find((person) => person.userId === ANA);
  assert.deepEqual([ana?.mailConnected, ana?.profileReady, ana?.hasSent], [true, true, true]);
});

test('a team filter scopes people and results to that team, and leaves meetings to the organization view', async () => {
  const value = await loadAdminValue(client(), ORG, { from: '2026-09-02', to: '2026-10-01', groupId: TEAM }, NOW);
  assert.equal(value.scope, 'filtered');
  assert.deepEqual(value.people.map((person) => person.name), ['Beto Soto']);
  assert.equal(value.results.current.sent, 0);
  assert.equal(value.results.current.savedContacts, 1);
  assert.equal(value.results.current.pipelineMeetings, 0);
});
