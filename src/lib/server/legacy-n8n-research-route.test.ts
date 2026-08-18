import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeLegacyN8nResearchRequest,
  type LegacyN8nResearchDependencies,
} from '@/lib/server/legacy-n8n-research-route';

const NOW = new Date('2026-08-13T12:00:00.000Z');

function request(body: Record<string, unknown>, key = 'client-attempt-1') {
  return new Request('https://app.example.test/api/research/n8n', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Partial<LegacyN8nResearchDependencies> = {}) {
  const calls: string[] = [];
  const jobs = new Map<string, any>();
  let quotaCalls = 0;

  const deps: LegacyN8nResearchDependencies = {
    webhook: 'https://n8n.example.test/webhook/research',
    apiKey: 'secret',
    timeoutMs: 60_000,
    resolveAccess: async () => ({
      access: {
        userId: 'trusted-user',
        organizationId: 'trusted-org',
        scopeKey: 'trusted-org',
        trustedInternal: false,
      },
      supabase: { rpc: async () => ({ error: null }) },
    }),
    resolveForwardContext: async ({ userId }) => ({
      userContext: { id: userId, name: 'Trusted Seller' },
      useSocialContext: false,
      socialCreditSource: 'none',
    }),
    getResearchLimit: async () => 5,
    consumeQuota: async () => {
      calls.push('quota');
      quotaCalls++;
      return { allowed: true, count: 1, limit: 5 };
    },
    claimRequest: async (input) => {
      calls.push('claim');
      const existing = jobs.get(input.requestIdempotencyKey);
      if (existing) {
        if (existing.requestClaimState === 'terminal_pending') {
          return { created: false, claimed: true, recovered: true, claimToken: 'claim-token', job: existing };
        }
        return { created: false, claimed: false, recovered: false, claimToken: null, job: existing };
      }
      const job: any = {
        id: 'job-1',
        userId: input.userId,
        organizationId: input.organizationId,
        scopeKey: input.scopeKey,
        requestIdempotencyKey: input.requestIdempotencyKey,
        providerReportId: null,
        leadRef: input.leadRef,
        leadId: input.leadId || null,
        email: input.email || null,
        companyName: input.companyName || null,
        companyDomain: input.companyDomain || null,
        status: 'queued',
        requestClaimState: 'pre_provider' as const,
        requestPayload: input.requestPayload,
        resultPayload: null,
        researchSnapshotId: null,
        errorCode: null,
        errorMessage: null,
      };
      jobs.set(input.requestIdempotencyKey, job);
      return { created: true, claimed: true, recovered: false, claimToken: 'claim-token', job };
    },
    markProviderSubmitting: async () => { calls.push('submitting'); },
    completeClaim: async (input) => {
      calls.push(input.phase === 'store_terminal' ? 'store-terminal' : 'complete');
      const job = jobs.get(input.providerReportId)!;
      if (input.phase === 'store_terminal') {
        Object.assign(job, {
          providerReportId: input.providerReportId,
          status: input.status,
          requestClaimState: 'terminal_pending',
          resultPayload: structuredClone(input.resultPayload),
        });
      } else {
        assert.ok(job.researchSnapshotId);
        job.requestClaimState = 'submitted';
      }
      return job;
    },
    releaseClaim: async () => { calls.push('release'); return true; },
    failClaim: async () => { calls.push('fail'); return true; },
    markProviderUnknown: async () => { calls.push('unknown'); return true; },
    persistTerminalResult: async ({ providerReportId, report }) => {
      calls.push('persist');
      const job = jobs.get(providerReportId)!;
      Object.assign(job, {
        status: 'completed',
        ...(job.requestClaimState === 'terminal_pending' ? {} : { resultPayload: report }),
        researchSnapshotId: 'snapshot-1',
      });
    },
    requestProvider: async () => {
      calls.push('provider');
      return {
        response: Response.json({ reports: [{ id: 'report-1', company: { name: 'Acme' } }] }),
        usedSocialContext: false,
        fellBackToNonSocial: false,
      };
    },
    now: () => NOW,
    ...overrides,
  };

  return { deps, calls, get quotaCalls() { return quotaCalls; } };
}

test('direct authenticated invocation uses trusted owner identity and forwards the server key', async () => {
  let forwarded: any = null;
  const harness = dependencies();
  harness.deps.requestProvider = async (input) => {
    harness.calls.push('provider');
    forwarded = input;
    return {
      response: Response.json({ reports: [{ id: 'report-1', company: { name: 'Acme' } }] }),
      usedSocialContext: false,
      fellBackToNonSocial: false,
    };
  };

  const response = await executeLegacyN8nResearchRequest(request({
    id: ' Lead-1 ',
    email: 'JANE@ACME.TEST',
    companyDomain: 'https://www.acme.test/about',
    user_id: 'spoofed-user',
    organization_id: 'spoofed-org',
    userContext: { id: 'spoofed-user', name: 'Seller' },
  }), harness.deps);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('idempotency-key') || '', /^research:n8n:v1:[a-f0-9]{64}$/);
  assert.equal(forwarded.headers['x-user-id'], 'trusted-user');
  assert.equal(forwarded.headers['x-organization-id'], 'trusted-org');
  assert.equal(forwarded.headers['Idempotency-Key'], response.headers.get('idempotency-key'));
  assert.equal(forwarded.payload.user_id, 'trusted-user');
  assert.equal(forwarded.payload.organization_id, 'trusted-org');
  assert.equal(forwarded.payload.userContext.id, 'trusted-user');
  assert.equal(forwarded.payload.companies[0].lead.id, 'Lead-1');
  assert.equal(forwarded.payload.companies[0].targetCompany.domain, 'acme.test');
  assert.ok(forwarded.payload.userCompanyProfile);
});

test('authenticated request without an organization fails closed before claim, quota, or provider', async () => {
  const harness = dependencies({
    resolveAccess: async () => ({
      access: {
        userId: 'trusted-user',
        organizationId: null,
        scopeKey: 'user:trusted-user',
        trustedInternal: false,
      },
      supabase: {},
    }),
  });

  const response = await executeLegacyN8nResearchRequest(request({ id: 'lead-1' }), harness.deps);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'ORGANIZATION_REQUIRED' });
  assert.deepEqual(harness.calls, []);
});

test('concurrent duplicate key neither consumes quota nor calls n8n twice and later replays terminal result', async () => {
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const harness = dependencies();
  harness.deps.requestProvider = async () => {
    harness.calls.push('provider');
    await providerGate;
    return {
      response: Response.json({ reports: [{ id: 'report-1', company: { name: 'Acme' } }] }),
      usedSocialContext: false,
      fellBackToNonSocial: false,
    };
  };
  const body = { id: 'lead-1', email: 'jane@acme.test', companyDomain: 'acme.test' };

  const firstPromise = executeLegacyN8nResearchRequest(request(body), harness.deps);
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = await executeLegacyN8nResearchRequest(request(body), harness.deps);
  releaseProvider();
  const first = await firstPromise;
  const replay = await executeLegacyN8nResearchRequest(request(body), harness.deps);

  assert.equal(concurrent.status, 202);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(harness.quotaCalls, 1);
  assert.equal(harness.calls.filter((call) => call === 'provider').length, 1);
});

test('claim precedes quota and quota denial returns 429 without calling n8n', async () => {
  const harness = dependencies();
  harness.deps.consumeQuota = async () => {
    harness.calls.push('quota');
    return { allowed: false, count: 5, limit: 5 };
  };

  const response = await executeLegacyN8nResearchRequest(request({ id: 'lead-1' }), harness.deps);
  const payload = await response.json();

  assert.equal(response.status, 429);
  assert.equal(payload.error, 'DAILY_RESEARCH_QUOTA_EXCEEDED');
  assert.deepEqual(harness.calls, ['claim', 'quota', 'release']);
  assert.equal(harness.calls.includes('provider'), false);
});

test('terminal persistence retry uses the durable provider result without calling n8n again', async () => {
  const harness = dependencies();
  const persist = harness.deps.persistTerminalResult;
  let failPersistence = true;
  harness.deps.persistTerminalResult = async (input) => {
    if (failPersistence) {
      failPersistence = false;
      harness.calls.push('persist');
      throw new Error('injected terminal persistence failure');
    }
    await persist(input);
  };
  const body = { id: 'lead-1', email: 'jane@acme.test', companyDomain: 'acme.test' };

  await assert.rejects(
    executeLegacyN8nResearchRequest(request(body), harness.deps),
    /injected terminal persistence failure/,
  );
  const retry = await executeLegacyN8nResearchRequest(request(body), harness.deps);
  const payload = await retry.json();
  const replay = await executeLegacyN8nResearchRequest(request(body), harness.deps);
  const replayPayload = await replay.json();

  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get('idempotency-replayed'), 'true');
  assert.equal(payload.reports[0].id, 'report-1');
  assert.equal(replay.status, 200);
  assert.equal(replayPayload.reports[0].id, 'report-1');
  assert.equal(harness.quotaCalls, 1);
  assert.equal(harness.calls.filter((call) => call === 'provider').length, 1);
  assert.equal(harness.calls.filter((call) => call === 'persist').length, 2);
  assert.equal(harness.calls.filter((call) => call === 'store-terminal').length, 1);
  assert.equal(harness.calls.filter((call) => call === 'complete').length, 1);
  assert.ok(harness.calls.indexOf('store-terminal') < harness.calls.indexOf('persist'));
  assert.ok(harness.calls.lastIndexOf('persist') < harness.calls.indexOf('complete'));
});
