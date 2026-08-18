import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  findCachedLeadResearchReport,
  ensureLeadResearchReportWithDependencies,
  type LeadResearchReportsRepository,
} from '@/lib/server/lead-research-reports';
import {
  applyLeadResearchAccessToPayload,
  deriveLeadResearchAccess,
} from '@/lib/server/lead-research-access';
import {
  findAuthorizedLeadResearchJob,
  deterministicLeadResearchSnapshotId,
  persistLeadResearchSnapshotIdempotently,
  registerLeadResearchJob,
  type LeadResearchJob,
  type LeadResearchJobsRepository,
} from '@/lib/server/lead-research-jobs';

const legacyScopeRecoveryMigration = readFileSync(
  'supabase/migrations/20260817123000_recover_legacy_lead_research_report_scope.sql',
  'utf8',
);

function report(status = 'completed', createdAt = '2026-08-12T00:00:00.000Z') {
  return {
    id: 'report-1',
    company: { name: 'Acme' },
    websiteSummary: { overview: 'Current company evidence', services: [], sources: [] },
    signals: [],
    createdAt,
    cross: {
      company: { name: 'Acme' },
      overview: 'Current company evidence',
      pains: [],
      opportunities: [],
      risks: [],
      valueProps: [],
      useCases: [],
      talkTracks: [],
      subjectLines: [],
      emailDraft: { subject: '', body: '' },
      sources: [],
    },
    raw: { status },
  } as any;
}

test('cache lookup uses lead ref then email and rejects stale entries', async () => {
  const calls: string[] = [];
  const repository: LeadResearchReportsRepository = {
    async findByLeadRef(_scope, value) {
      calls.push(`ref:${value}`);
      return { report: report('completed', '2026-01-01T00:00:00.000Z') };
    },
    async findByEmail(_scope, value) {
      calls.push(`email:${value}`);
      return { report: report() };
    },
    async upsert() {},
  };

  const cached = await findCachedLeadResearchReport({
    userId: 'user-1',
    lead: { id: 'lead-1', email: 'Lead@Example.com', company: 'Same Company' },
  }, {
    repository,
    nowMs: Date.parse('2026-08-13T00:00:00.000Z'),
    ttlMs: 30 * 24 * 60 * 60 * 1000,
  });

  assert.deepEqual(calls, ['ref:lead-1', 'email:lead@example.com']);
  assert.equal(cached?.id, 'report-1');
});

test('cache lookup never queries company identity', async () => {
  const calls: string[] = [];
  const repository: LeadResearchReportsRepository = {
    async findByLeadRef(_scope, value) { calls.push(`ref:${value}`); return null; },
    async findByEmail(_scope, value) { calls.push(`email:${value}`); return null; },
    async upsert() {},
  };

  await findCachedLeadResearchReport({
    userId: 'user-1',
    lead: { company: 'Acme', companyDomain: 'acme.test' } as any,
  }, { repository });

  assert.deepEqual(calls, []);
});

test('cache lookup falls through from lead ref to the exact email column', async () => {
  const calls: string[] = [];
  const repository: LeadResearchReportsRepository = {
    async findByLeadRef(_scope, value) { calls.push(`ref:${value}`); return null; },
    async findByEmail(_scope, value) { calls.push(`email:${value}`); return null; },
    async upsert() {},
  };

  await findCachedLeadResearchReport({
    userId: 'user-1',
    lead: { email: 'lead@example.test' },
  }, { repository });

  assert.deepEqual(calls, ['ref:lead@example.test', 'email:lead@example.test']);
});

test('ensureLeadResearchReport polls active jobs and stores only the terminal report', async () => {
  const responses = [
    new Response(JSON.stringify({ report_id: 'provider-1', status: 'queued' }), { status: 202 }),
    new Response(JSON.stringify({ report_id: 'provider-1', status: 'running' }), { status: 200 }),
    new Response(JSON.stringify({
      report_id: 'provider-1',
      status: 'completed',
      company: { name: 'Acme' },
      website_summary: { overview: 'Acme provides verified workflow automation.', services: [], source_ids: ['source-1'] },
      sources: [{ id: 'source-1', url: 'https://acme.test/about' }],
    }), { status: 200 }),
  ];
  const stored: any[] = [];
  let sleeps = 0;

  const result = await ensureLeadResearchReportWithDependencies({
    userId: 'user-1',
    organizationId: 'org-1',
    lead: { id: 'lead-1', email: 'lead@example.test', company: 'Acme' },
  }, {
    findCached: async () => null,
    store: (async (input: any) => { stored.push(input.report); return true; }) as any,
    fetch: (async () => responses.shift()!) as typeof fetch,
    sleep: async () => { sleeps++; },
    baseUrl: 'https://app.example.test',
    internalSecret: 'secret',
    maxPollAttempts: 3,
    pollIntervalMs: 0,
  });

  assert.equal(sleeps, 2);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].raw.status, 'completed');
  assert.equal(result.report?.raw?.status, 'completed');
  assert.equal(result.created, true);
});

test('access derivation ignores caller identity and rewrites the payload from trusted context', async () => {
  const access = await deriveLeadResearchAccess({
    sessionUserId: 'session-user',
    trustedInternal: true,
    internalUserId: 'spoofed-header-user',
    internalOrganizationId: 'spoofed-header-org',
  }, {
    userExists: async () => true,
    resolveOrganizationId: async (userId, organizationHint) => {
      assert.equal(userId, 'session-user');
      assert.equal(organizationHint, null);
      return 'trusted-org';
    },
  });
  assert.ok(access);

  const outgoing = applyLeadResearchAccessToPayload({
    user_id: 'caller-user',
    organization_id: 'caller-org',
    scope_key: 'caller-scope',
    user_context: { id: 'caller-user', name: 'Seller' },
    payload: { user_id: 'nested-caller', scope_key: 'nested-scope', keep: true },
    lead: { id: 'lead-1' },
  }, access!);

  assert.equal(outgoing.user_id, 'session-user');
  assert.equal(outgoing.organization_id, 'trusted-org');
  assert.equal(outgoing.scope_key, 'trusted-org');
  assert.equal(outgoing.user_context.id, 'session-user');
  assert.deepEqual(outgoing.payload, { keep: true });
  assert.equal(outgoing.lead.id, 'lead-1');
});

test('terminal report persistence strips provider transport envelopes', async () => {
  const { buildTerminalLeadResearchReport } = await import('@/lib/server/lead-research-reports');
  const terminal = buildTerminalLeadResearchReport({
    status: 'completed',
    report: {
      report_id: 'provider-1',
      status: 'completed',
      company: { name: 'Acme' },
      website_summary: { overview: 'Acme provides verified workflow automation.', services: [], source_ids: ['source-1'] },
      sources: [{ id: 'source-1', url: 'https://acme.test/about' }],
    },
    message: { content: '{"company":{"name":"Acme"}}' },
    finish_reason: 'stop',
  }, 'lead-1');

  assert.ok(terminal);
  assert.equal(terminal.report.raw.report, undefined);
  assert.equal(terminal.report.raw.message, undefined);
  assert.equal(terminal.report.raw.finish_reason, undefined);
  assert.equal(terminal.report.raw.report_id, 'provider-1');
});

test('legacy research report writes recover their owner scope from the enriched lead', () => {
  assert.match(legacyScopeRecoveryMigration, /from public\.enriched_leads e/);
  assert.match(legacyScopeRecoveryMigration, /e\.id::text = nullif\(btrim\(coalesce\(new\.lead_ref, ''\)\), ''\)/);
  assert.match(legacyScopeRecoveryMigration, /new\.scope_key := new\.organization_id::text/);
  assert.match(legacyScopeRecoveryMigration, /new\.scope_key := concat\('user:', new\.user_id::text\)/);
  assert.match(legacyScopeRecoveryMigration, /requires a scope key or an owned lead reference/);
  assert.match(legacyScopeRecoveryMigration, /before insert or update of scope_key, organization_id, user_id, lead_ref, lead_id/);
});

test('job ownership service registers and hides jobs outside the authenticated scope', async () => {
  const jobs = new Map<string, LeadResearchJob>();
  const repository: LeadResearchJobsRepository = {
    async findByProviderReportId(providerReportId, access) {
      const job = jobs.get(providerReportId) || null;
      return job && job.organizationId === access.organizationId && job.userId === access.userId ? job : null;
    },
    async insert(job) { jobs.set(job.providerReportId, job); },
    async updateStatus() {},
  };
  const access = { userId: 'user-1', organizationId: 'org-1', scopeKey: 'org-1' };

  await registerLeadResearchJob({
    ...access,
    providerReportId: 'provider-1',
    leadRef: 'lead-1',
    status: 'queued',
  }, repository);

  assert.equal((await findAuthorizedLeadResearchJob('provider-1', access, repository))?.leadRef, 'lead-1');
  assert.equal(await findAuthorizedLeadResearchJob('provider-1', {
    userId: 'user-2',
    organizationId: 'org-1',
    scopeKey: 'org-1',
  }, repository), null);
  assert.equal(await findAuthorizedLeadResearchJob('provider-1', {
    userId: 'user-1',
    organizationId: 'org-2',
    scopeKey: 'org-2',
  }, repository), null);
});

test('research snapshot identity is deterministic per owned provider job', () => {
  const input = {
    providerReportId: 'provider-1',
    scopeKey: 'org-1',
    userId: 'user-1',
  };

  assert.equal(deterministicLeadResearchSnapshotId(input), deterministicLeadResearchSnapshotId(input));
  assert.match(deterministicLeadResearchSnapshotId(input), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(
    deterministicLeadResearchSnapshotId(input),
    deterministicLeadResearchSnapshotId({ ...input, scopeKey: 'org-2' }),
  );
});

test('concurrent terminal persistence reuses one snapshot and one CAS winner', async () => {
  const snapshotId = deterministicLeadResearchSnapshotId({
    providerReportId: 'provider-1',
    scopeKey: 'org-1',
    userId: 'user-1',
  });
  const snapshots = new Set<string>();
  let linkedSnapshotId: string | null = null;
  let successfulLinks = 0;
  const persist = () => persistLeadResearchSnapshotIdempotently({
    snapshotId,
    async insertIfAbsent() {
      await Promise.resolve();
      snapshots.add(snapshotId);
    },
    async verifyOwnedSnapshot() {
      return snapshots.has(snapshotId);
    },
    async compareAndSetJobSnapshot() {
      if (linkedSnapshotId === null) {
        linkedSnapshotId = snapshotId;
        successfulLinks += 1;
      }
    },
    async readJobSnapshotId() {
      return linkedSnapshotId;
    },
  });

  const results = await Promise.all([persist(), persist()]);

  assert.deepEqual(results, [snapshotId, snapshotId]);
  assert.equal(snapshots.size, 1);
  assert.equal(successfulLinks, 1);
});
