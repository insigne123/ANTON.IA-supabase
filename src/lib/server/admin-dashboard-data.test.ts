import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAdminDashboardOverview } from '@/lib/server/admin-dashboard-data';

const organizationId = 'e73dd11f-c8db-4ffc-9711-47dc74295064';
const userOne = '11111111-1111-4111-8111-111111111111';
const userTwo = '22222222-2222-4222-8222-222222222222';
const groupOne = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const groupTwo = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class FakeQuery {
  constructor(private readonly result: { data: any; error: any }) {}

  select() { return this; }
  eq() { return this; }
  gte() { return this; }
  lt() { return this; }
  neq() { return this; }
  or() { return this; }
  order() { return this; }
  limit() { return Promise.resolve(this.result); }
  maybeSingle() { return Promise.resolve(this.result); }
  then(resolve: (value: any) => any, reject: (reason: unknown) => any) {
    return Promise.resolve(this.result).then(resolve, reject);
  }
}

function dashboardClient(overrides: Record<string, any> = {}, failedTables: string[] = []) {
  const rows: Record<string, any> = {
    organizations: { id: organizationId, name: 'GrupoExpro' },
    organization_reporting_groups: [
      { id: groupOne, name: 'Chile', slug: 'chile', country_code: 'CL', color: '#2563eb', is_active: true },
      { id: groupTwo, name: 'Peru', slug: 'peru', country_code: 'PE', color: '#7c3aed', is_active: true },
    ],
    organization_reporting_group_members: [
      { group_id: groupOne, user_id: userOne, is_primary: true, unassigned_at: null },
      { group_id: groupTwo, user_id: userTwo, is_primary: true, unassigned_at: null },
    ],
    organization_members: [
      { user_id: userOne, role: 'owner', created_at: '2026-09-01T00:00:00.000Z' },
      { user_id: userTwo, role: 'member', created_at: '2026-09-01T00:01:00.000Z' },
    ],
    leads: [
      { id: 'lead-1', user_id: userOne, created_at: '2026-09-06T08:00:00.000Z', company: 'Acme' },
      { id: 'lead-2', user_id: userOne, created_at: '2026-09-06T08:05:00.000Z', company: 'Acme' },
      { id: 'lead-3', user_id: userTwo, created_at: '2026-09-06T08:10:00.000Z', company: 'Beta' },
    ],
    enriched_leads: [
      { id: 'lead-1', user_id: userOne, created_at: '2026-09-06T09:00:00.000Z', company_name: 'Acme', title: 'CEO', seniority: 'c_suite', data: {} },
    ],
    people_search_leads: [
      { id: 'person-1', user_id: userOne, created_at: '2026-09-06T09:30:00.000Z', organization_name: 'Acme', title: 'CEO', seniority: 'c_suite', primary_phone: '+56 1' },
      { id: 'person-2', user_id: userTwo, created_at: '2026-09-06T09:35:00.000Z', organization_name: 'Globex', title: 'Director', seniority: 'director', primary_phone: null },
    ],
    contacted_leads: [
      { id: 'contact-1', user_id: userOne, lead_id: 'lead-1', sent_at: '2026-09-06T10:00:00.000Z', replied_at: '2026-09-06T12:00:00.000Z', provider: 'gmail', status: 'replied', company: 'Acme', data: {} },
      { id: 'contact-2', user_id: userTwo, lead_id: 'lead-3', sent_at: '2026-09-06T11:00:00.000Z', replied_at: null, provider: 'linkedin', status: 'sent', company: 'Beta', data: {} },
      { id: 'draft-only', user_id: userOne, lead_id: 'lead-2', sent_at: null, replied_at: null, created_at: '2026-09-06T11:30:00.000Z', provider: 'gmail', status: 'draft', company: 'Draft Corp', data: {} },
    ],
    email_events: [
      { id: 'event-sent', contacted_id: 'contact-1', lead_id: 'lead-1', event_type: 'sent', event_at: '2026-09-06T10:00:00.000Z' },
      { id: 'event-reply', contacted_id: 'contact-1', lead_id: 'lead-1', event_type: 'reply', event_at: '2026-09-06T12:00:00.000Z' },
    ],
    antonia_event_ledger: [
      { id: 'ledger-sent', actor_user_id: userOne, event_type: 'backfill.email.sent', occurred_at: '2026-09-06T10:00:00.000Z', lead_id: 'lead-1', entity_id: 'event-sent' },
      { id: 'ledger-reply', actor_user_id: userOne, event_type: 'reply.received', occurred_at: '2026-09-06T12:00:00.000Z', lead_id: 'lead-1', entity_id: 'event-reply' },
      { id: 'ledger-research', actor_user_id: userOne, event_type: 'backfill.research.completed', occurred_at: '2026-09-06T13:00:00.000Z', research_job_id: 'research-1', entity_id: 'research-1' },
    ],
    lead_research_jobs: [
      { id: 'research-1', user_id: userOne, lead_id: 'lead-1', created_at: '2026-09-06T13:00:00.000Z', status: 'completed' },
      { id: 'research-2', user_id: userTwo, lead_id: 'lead-3', created_at: '2026-09-06T13:05:00.000Z', status: 'completed' },
    ],
    ...overrides,
  };

  return {
    from(table: string) {
      if (failedTables.includes(table)) return new FakeQuery({ data: null, error: { message: 'Unavailable' } });
      const data = rows[table];
      return new FakeQuery({ data, error: data === undefined ? { message: `Missing ${table}` } : null });
    },
    auth: {
      admin: {
        listUsers: async () => ({
          data: failedTables.includes('auth.users') ? null : {
            users: [
              {
                id: userOne,
                email: 'owner@grupoexpro.com',
                email_confirmed_at: '2026-08-01T00:00:00.000Z',
                last_sign_in_at: '2026-09-06T07:00:00.000Z',
                user_metadata: { full_name: 'Owner', avatar_url: 'https://example.com/owner.png' },
              },
              { id: userTwo, email: 'member@grupoexpro.com', user_metadata: { full_name: 'Member' } },
            ],
          },
          error: failedTables.includes('auth.users') ? { message: 'Unavailable' } : null,
        }),
      },
    },
  };
}

test('dashboard counts only confirmed sends and avoids canonical event double counting', async () => {
  const overview = await loadAdminDashboardOverview(
    dashboardClient(),
    organizationId,
    'GrupoExpro',
    { from: '2026-09-06', to: '2026-09-06' },
  );

  assert.deepEqual(overview.summary, {
    leadsCaptured: 3,
    leadsContacted: 2,
    phonesSearched: 1,
    investigations: 2,
    emailsSent: 1,
    replies: 1,
    linkedinConnections: 1,
    responseRate: 100,
    monthlyProjection: 180,
    companiesCaptured: 3,
    profilesWithSeniority: 2,
  });
  assert.deepEqual(overview.trend, [{ date: '2026-09-06', leads: 3, contacted: 2, researched: 2, replies: 1 }]);
  const owner = overview.users.find((user) => user.id === userOne);
  assert.equal(owner?.metrics.contacted, 1);
  assert.equal(owner?.metrics.responseRate, 100);
  assert.equal(owner?.metrics.activeDays, 1);
  assert.equal(owner?.lastActivityAt, '2026-09-06T13:00:00.000Z');
  assert.equal(owner?.lastSignInAt, '2026-09-06T07:00:00.000Z');
  assert.equal(owner?.emailConfirmed, true);
  assert.equal(owner?.avatarUrl, 'https://example.com/owner.png');
  assert.deepEqual(overview.filterOptions.groups, [
    { id: groupOne, name: 'Chile' },
    { id: groupTwo, name: 'Peru' },
  ]);
  assert.equal(overview.groups.find((group) => group.id === groupOne)?.metrics.responseRate, 100);
});

test('dashboard applies user attribution to every supported source', async () => {
  const overview = await loadAdminDashboardOverview(
    dashboardClient(),
    organizationId,
    'GrupoExpro',
    { from: '2026-09-06', to: '2026-09-06', userId: userOne },
  );

  assert.equal(overview.summary.leadsCaptured, 2);
  assert.equal(overview.summary.leadsContacted, 1);
  assert.equal(overview.summary.investigations, 1);
  assert.equal(overview.summary.phonesSearched, 1);
  assert.deepEqual(overview.users.map((user) => user.id), [userOne]);
  assert.deepEqual(overview.filterOptions.users.map((user) => user.id), [userTwo, userOne]);
});

test('dashboard fails closed when the management roster cannot be loaded', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const table of ['organizations', 'organization_reporting_groups', 'organization_reporting_group_members', 'organization_members', 'auth.users']) {
    await assert.rejects(
      loadAdminDashboardOverview(dashboardClient({}, [table]), organizationId, 'GrupoExpro', { from: '2026-09-06', to: '2026-09-06' }),
      /No pudimos cargar las personas y los equipos/,
      table,
    );
  }
});

test('dashboard still reports partial activity when the management roster is complete', async (t) => {
  t.mock.method(console, 'error', () => {});
  const overview = await loadAdminDashboardOverview(
    dashboardClient({}, ['leads']), organizationId, 'GrupoExpro', { from: '2026-09-06', to: '2026-09-06' },
  );
  assert.equal(overview.users.length, 2);
  assert.equal(overview.groups.length, 2);
  assert.match(overview.coverage.note || '', /leads/);
});

test('dashboard counts reply-only activity without requiring a send in the same period', async () => {
  const overview = await loadAdminDashboardOverview(dashboardClient({
    leads: [],
    email_events: [],
    antonia_event_ledger: [],
    lead_research_jobs: [],
    contacted_leads: [{
      id: 'contact-1', user_id: userOne, lead_id: 'lead-1', provider: 'gmail',
      sent_at: '2026-09-05T10:00:00.000Z', replied_at: '2026-09-06T12:00:00.000Z',
    }],
  }), organizationId, 'GrupoExpro', { from: '2026-09-06', to: '2026-09-06' });
  const person = overview.users.find((user) => user.id === userOne)!;
  assert.equal(person.metrics.contacted, 0);
  assert.equal(person.metrics.replies, 1);
  assert.equal(person.metrics.activeDays, 1);
  assert.equal(person.lastActivityAt, '2026-09-06T12:00:00.000Z');
});

test('dashboard counts each activity day and excludes replies and completions outside the period', async () => {
  const client = dashboardClient({
    leads: [],
    email_events: [],
    antonia_event_ledger: [],
    contacted_leads: [{
      id: 'contact-1', user_id: userOne, lead_id: 'lead-1', provider: 'gmail',
      sent_at: '2026-09-06T10:00:00.000Z', replied_at: '2026-09-08T12:00:00.000Z',
    }],
    lead_research_jobs: [{
      id: 'research-1', user_id: userOne, created_at: '2026-09-06T13:00:00.000Z', completed_at: '2026-09-08T13:00:00.000Z',
    }],
  });
  const singleDay = await loadAdminDashboardOverview(client, organizationId, 'GrupoExpro', { from: '2026-09-06', to: '2026-09-06' });
  const person = singleDay.users.find((user) => user.id === userOne)!;
  assert.equal(person.metrics.activeDays, 1);
  assert.equal(person.lastActivityAt, '2026-09-06T13:00:00.000Z');

  const multiDay = await loadAdminDashboardOverview(client, organizationId, 'GrupoExpro', { from: '2026-09-06', to: '2026-09-08' });
  const activePerson = multiDay.users.find((user) => user.id === userOne)!;
  assert.equal(activePerson.metrics.activeDays, 2);
  assert.equal(activePerson.lastActivityAt, '2026-09-08T13:00:00.000Z');
});

test('person response rate matches the overview for mixed channels and repeated email sends', async () => {
  const overview = await loadAdminDashboardOverview(dashboardClient({
    contacted_leads: [
      { id: 'contact-1', user_id: userOne, lead_id: 'lead-1', provider: 'gmail', sent_at: '2026-09-06T10:00:00.000Z', replied_at: '2026-09-06T12:00:00.000Z' },
      { id: 'followup', user_id: userOne, lead_id: 'lead-1', provider: 'gmail', sent_at: '2026-09-06T11:00:00.000Z' },
      { id: 'linkedin', user_id: userOne, lead_id: 'lead-2', provider: 'linkedin', sent_at: '2026-09-06T11:00:00.000Z' },
      { id: 'linkedin-2', user_id: userOne, lead_id: 'lead-3', provider: 'linkedin', sent_at: '2026-09-06T11:00:00.000Z' },
    ],
  }), organizationId, 'GrupoExpro', { from: '2026-09-06', to: '2026-09-06', userId: userOne });
  const person = overview.users[0];
  assert.equal(person.metrics.contacted, 3);
  assert.equal(overview.summary.emailsSent, 2);
  assert.equal(person.metrics.responseRate, 50);
  assert.equal(person.metrics.responseRate, overview.summary.responseRate);
  assert.equal(person.metrics.responseRate, overview.groups.find((group) => group.id === groupOne)?.metrics.responseRate);
});

test('person response rates use event and ledger send counts when contact history is incomplete', async () => {
  for (const source of ['email_events', 'antonia_event_ledger']) {
    const overview = await loadAdminDashboardOverview(dashboardClient({
      contacted_leads: [{ id: 'contact-1', user_id: userOne, lead_id: 'lead-1', provider: 'gmail', sent_at: '2026-09-05T10:00:00.000Z', replied_at: '2026-09-06T12:00:00.000Z' }],
      email_events: [],
      antonia_event_ledger: [],
      [source]: [1, 2].map((index) => ({
        id: `sent-${index}`, contacted_id: 'contact-1', actor_user_id: userOne, lead_id: 'lead-1',
        event_type: source === 'email_events' ? 'sent' : 'email.sent',
        event_at: '2026-09-06T10:00:00.000Z', occurred_at: '2026-09-06T10:00:00.000Z',
      })),
    }), organizationId, 'GrupoExpro', { from: '2026-09-06', to: '2026-09-06', userId: userOne });
    assert.equal(overview.summary.emailsSent, 2, source);
    assert.equal(overview.users[0].metrics.responseRate, 50, source);
    assert.equal(overview.users[0].metrics.responseRate, overview.summary.responseRate, source);
  }
});
