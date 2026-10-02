import assert from 'node:assert/strict';
import test from 'node:test';

import { readTeamLocks } from '@/lib/server/team-locks';

type Op = { table: string; filters: Array<[string, string, unknown]> };

function fake(tables: Record<string, (op: Op) => unknown>) {
  const log: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, filters: [] };
    const run = () => { log.push(op); return Promise.resolve({ data: tables[table]?.(op) ?? null, error: null }); };
    const query: any = {
      select: () => query, limit: () => query,
      eq: (column: string, value: unknown) => { op.filters.push(['eq', column, value]); return query; },
      in: (column: string, value: unknown) => { op.filters.push(['in', column, value]); return query; },
      or: (value: string) => { op.filters.push(['or', 'or', value]); return query; },
      not: (column: string) => { op.filters.push(['not', column, null]); return query; },
      maybeSingle: run,
      then: (resolve: any, reject: any) => run().then(resolve, reject),
    };
    return query;
  };
  return { log, client: { from } };
}

const scope = { userId: 'user-beto', organizationId: 'org-1' };
const members = () => [
  { user_id: 'user-ana', profiles: { full_name: 'Ana Pérez', email: 'ana@team.cl' } },
  { user_id: 'user-beto', profiles: [{ full_name: 'Beto Soto', email: 'beto@team.cl' }] },
];

test('without collaboration nothing is locked and nothing else is read', async () => {
  const { client, log } = fake({ organizations: () => ({ collaboration_v1_enabled: false }) });
  const locks = await readTeamLocks(client, scope, { emails: ['a@b.cl'] });
  assert.deepEqual(locks, { enabled: false, byEmail: {}, byProviderId: {}, byLinkedin: {} });
  assert.deepEqual(log.map(op => op.table), ['organizations']);
});

test('locks by email, with the owner\'s name, whether it is mine and whether they replied in this cycle', async () => {
  const { client } = fake({
    organizations: () => ({ collaboration_v1_enabled: true }),
    organization_contact_threads: () => [
      { recipient_key: 'marcela@sodexo.cl', status: 'active', opened_by_user_id: 'user-ana', first_contacted_at: '2026-09-01T00:00:00Z', last_contacted_at: '2026-09-20T00:00:00Z', reopened_at: null },
      { recipient_key: 'old@reply.cl', status: 'active', opened_by_user_id: 'user-ana', first_contacted_at: '2026-01-01T00:00:00Z', last_contacted_at: '2026-09-20T00:00:00Z', reopened_at: '2026-08-01T00:00:00Z' },
      { recipient_key: 'mine@lead.cl', status: 'active', opened_by_user_id: 'user-beto', first_contacted_at: '2026-09-01T00:00:00Z', last_contacted_at: '2026-09-02T00:00:00Z', reopened_at: null },
    ],
    organization_members: members,
    contacted_leads: () => [
      { email: 'Marcela@Sodexo.cl', replied_at: '2026-09-21T00:00:00Z' },
      { email: 'old@reply.cl', replied_at: '2026-03-01T00:00:00Z' },
    ],
  });
  const locks = await readTeamLocks(client, scope, { emails: ['MARCELA@sodexo.cl', 'old@reply.cl', 'mine@lead.cl'] });
  assert.deepEqual(locks.byEmail['marcela@sodexo.cl'], { status: 'active', ownerName: 'Ana Pérez', mine: false, replied: true, lastContactedAt: '2026-09-20T00:00:00Z' });
  assert.equal(locks.byEmail['old@reply.cl'].replied, false, 'a reply before the last reopen belongs to another cycle');
  assert.equal(locks.byEmail['mine@lead.cl'].mine, true);
});

test('search results without an email reach the lock through a contact saved in the organization', async () => {
  const thread = { recipient_key: 'rafael@empresa.cl', status: 'active', opened_by_user_id: 'user-ana', first_contacted_at: '2026-09-01T00:00:00Z', last_contacted_at: '2026-09-20T00:00:00Z', reopened_at: null };
  const { client, log } = fake({
    organizations: () => ({ collaboration_v1_enabled: true }),
    leads: (op: Op) => op.filters.some(([kind, column]) => kind === 'in' && column === 'apollo_id')
      ? [{ apollo_id: 'apollo-7', email: 'Rafael@Empresa.cl' }]
      : [{ linkedin_url: 'https://www.linkedin.com/in/rafael-diaz/', email: 'rafael@empresa.cl' }],
    organization_contact_threads: () => [thread],
    organization_members: members,
    contacted_leads: () => [],
  });
  const locks = await readTeamLocks(client, scope, { providerIds: ['apollo-7'], linkedinUrls: ['https://cl.linkedin.com/in/Rafael-Diaz?x=1'] });
  assert.equal(locks.byProviderId['apollo-7'].ownerName, 'Ana Pérez');
  assert.equal(locks.byLinkedin['linkedin.com/in/rafael-diaz'].status, 'active');
  const linkedinRead = log.find(op => op.table === 'leads' && op.filters.some(([kind]) => kind === 'or'))!;
  assert.match(String(linkedinRead.filters.find(([kind]) => kind === 'or')![2]), /linkedin_url\.ilike\.%linkedin\.com\/in\/rafael-diaz%/);
  assert.ok(log.filter(op => op.table === 'leads').every(op => op.filters.some(([, column, value]) => column === 'organization_id' && value === 'org-1')), 'only the organization\'s contacts');
});

test('nothing to look up, nothing read beyond the organization', async () => {
  const { client, log } = fake({ organizations: () => ({ collaboration_v1_enabled: true }) });
  const locks = await readTeamLocks(client, scope, { emails: ['not-an-email', ''] });
  assert.equal(locks.enabled, true);
  assert.deepEqual(locks.byEmail, {});
  assert.deepEqual(log.map(op => op.table), ['organizations']);
});
