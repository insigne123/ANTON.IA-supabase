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

function dashboardClient() {
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
  };

  return {
    from(table: string) {
      const data = rows[table];
      return new FakeQuery({ data, error: data === undefined ? { message: `Missing ${table}` } : null });
    },
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: [
              { id: userOne, email: 'owner@grupoexpro.com', user_metadata: { full_name: 'Owner' } },
              { id: userTwo, email: 'member@grupoexpro.com', user_metadata: { full_name: 'Member' } },
            ],
          },
          error: null,
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
  assert.equal(overview.users[0].metrics.contacted, 1);
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
});
