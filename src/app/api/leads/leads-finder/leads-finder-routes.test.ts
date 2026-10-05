import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { z } from 'zod';

import { identityFromProvider } from '@/lib/server/lead-identity';
import { LEADS_FINDER_PROVIDER, LeadsFinderError, splitLeadsFinderItems } from '@/lib/server/leads-finder/client';
import * as reveal from '@/lib/server/leads-finder/reveal';
import { isLeadsFinderId, LeadsFinderVaultError } from '@/lib/server/leads-finder/vault';

/**
 * The Leads Finder routes (Plan 11, PR 6c) against stand-ins: no network, no database. What matters is what leaves the
 * server: the search never answers an email, phone or personal LinkedIn, and «Enriquecer» reveals from the vault,
 * charged like Apollo, without calling Apify again.
 */
const ALLOWED = 'nicolas@empresa-demo.cl';
const people = splitLeadsFinderItems([
  { first_name: 'Ana', last_name: 'Pérez', email: 'ana.perez@empresa-demo.cl', mobile_number: '+56 9 1234 5678', linkedin: 'linkedin.com/in/ana-perez-demo',
    email_status: 'validated', job_title: 'Gerenta de Personas', company_name: 'Empresa Demo SpA', company_domain: 'empresa-demo.cl', country: 'Chile' },
  { first_name: 'Jorge', last_name: 'Soto', email: 'jorge.soto@otra-demo.cl', linkedin: 'linkedin.com/in/jorge-soto-demo', email_status: 'validated',
    job_title: 'Jefe de Operaciones', company_name: 'Otra Demo', company_domain: 'otra-demo.cl', country: 'Chile' },
]);
const SECRETS = ['ana.perez@empresa-demo.cl', 'jorge.soto@otra-demo.cl', '1234 5678', 'ana-perez-demo', 'jorge-soto-demo', 'Pérez', 'Soto'];

function load(file: string, modules: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`);
    return modules[name];
  }, exports);
  return exports.POST as (request: Request) => Promise<Response>;
}
const shared = (email: string, source = 'session') => ({
  'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
  '@/lib/server/antonia-event-ledger': { safeAppendAntoniaEvent: async () => null },
  '@/lib/server/leads-finder/access': { hasLeadsFinderAccess: (value: unknown) => value === ALLOWED },
  '@/lib/server/request-auth': {
    requireSessionOrTrustedInternalRequest: async () => ({ source, user: { id: 'u1', email }, organizationId: 'org' }),
    requestAuthErrorResponse: () => null,
  },
});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

function searchRoute(options: { email?: string; source?: string; vaultDown?: boolean; failure?: LeadsFinderError; saved?: string[] } = {}) {
  const calls = { quota: 0, searches: [] as any[], stored: [] as any[] };
  const admin = {
    from: () => {
      const chain: any = { select: () => chain, eq: () => chain, in: async () => ({ data: (options.saved || []).map(id => ({ source_provider_id: id })), error: null }) };
      return chain;
    },
  };
  const POST = load('src/app/api/leads/leads-finder/search/route.ts', {
    ...shared(options.email ?? ALLOWED, options.source),
    zod: { z },
    '@/lib/server/daily-quota-store': {
      getEffectiveDailyQuotaLimits: async () => ({ leadSearch: 50 }),
      checkAndConsumeDailyQuota: async () => { calls.quota++; return { allowed: true, count: 3, limit: 50 }; },
    },
    '@/lib/server/leads-finder/client': {
      LEADS_FINDER_PROVIDER, LeadsFinderError,
      searchLeadsFinder: async (input: unknown, deps: unknown) => {
        calls.searches.push({ input, deps });
        if (options.failure) throw options.failure;
        return { results: people, fetched: 2, notApplied: ['Industria «Agro» no está en Leads Finder'], costUsd: 0.004 };
      },
    },
    '@/lib/server/leads-finder/input': { LEADS_FINDER_MAX_PER_RUN: 100 },
    '@/lib/server/leads-finder/vault': {
      LeadsFinderVaultError,
      storeInVault: async (_client: unknown, input: any) => {
        calls.stored.push(input);
        if (options.vaultDown) throw new LeadsFinderVaultError('LEADS_FINDER_VAULT_UNAVAILABLE');
        return input.entries.length;
      },
    },
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => admin },
  });
  return { POST, calls };
}

test('the search answers like Apollo: masked last names, and no email, phone or personal LinkedIn ever leaves the server', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('the route itself never calls out'); });
  const { POST, calls } = searchRoute({ saved: [people[1].lead.id] });
  const response = await POST(post({ titles: ['Gerente de Personas'], person_locations: ['Chile'], max_results: 25 }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  const body = await response.json();
  const raw = JSON.stringify(body);
  for (const secret of SECRETS) assert.equal(raw.includes(secret), false, `«${secret}» must not reach the browser`);
  assert.equal(body.provider, 'leads_finder');
  assert.deepEqual(body.leads.map((lead: any) => lead.name), ['Ana Pé***z'], 'Jorge was already saved by the organization');
  assert.equal(body.leads[0].has_email, true, 'the result says it has an email, without showing it');
  assert.equal(body.already_saved, 1);
  assert.deepEqual(body.not_applied, ['Industria «Agro» no está en Leads Finder']);
  assert.equal(calls.quota, 1, 'the same daily search quota as Apollo');
  assert.equal(calls.searches[0].input.titles[0], 'Gerente de Personas');
  assert.equal(calls.searches[0].input.maxResults, 25);
  assert.equal(calls.stored[0].entries.length, 2, 'both contacts wait in the vault, the saved one too');
  assert.equal(calls.stored[0].entries[0].contact.email, 'ana.perez@empresa-demo.cl');
});

test('without access, without filters, without vault or with an Apify error the search shows nothing', async () => {
  for (const options of [{ email: 'otra@empresa-demo.cl' }, { source: 'internal' }]) {
    const { POST, calls } = searchRoute(options);
    const response = await POST(post({ titles: ['Gerente'] }));
    assert.equal(response.status, 404, 'it does not even say it exists');
    assert.equal(calls.quota + calls.searches.length, 0);
  }
  const empty = searchRoute();
  const noFilters = await empty.POST(post({ max_results: 10 }));
  assert.equal(noFilters.status, 400);
  assert.equal((await noFilters.json()).error, 'FILTER_REQUIRED');
  assert.equal(empty.calls.quota, 0, 'a search that cannot run spends no quota');
  assert.equal((await empty.POST(post({ titles: ['x'.repeat(300)] }))).status, 400);

  const down = searchRoute({ vaultDown: true });
  const unavailable = await down.POST(post({ titles: ['Gerente'] }));
  assert.equal(unavailable.status, 503);
  const body = await unavailable.json();
  assert.equal(body.error, 'LEADS_FINDER_VAULT_UNAVAILABLE');
  assert.equal(body.leads, undefined, 'a result that could not be enriched later is not shown');

  const failing = searchRoute({ failure: new LeadsFinderError('Apify: no queda saldo en la cuenta.', 503, false) });
  const failed = await failing.POST(post({ titles: ['Gerente'] }));
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'LEADS_FINDER_ERROR', message: 'Apify: no queda saldo en la cuenta.', mayHaveCharged: false });
});

function enrichRoute(options: { inVault?: string[]; existing?: any; allowed?: boolean; email?: string } = {}) {
  const calls = { claims: [] as any[], submitted: 0, completed: [] as any[], released: 0, inserted: [] as any[], forgotten: [] as string[], identities: [] as any[] };
  const vault = new Map(people.filter(person => (options.inVault ?? [people[0].lead.id]).includes(person.lead.id)).map(person => [person.lead.id, person]));
  const POST = load('src/app/api/leads/leads-finder/enrich/route.ts', {
    ...shared(options.email ?? ALLOWED),
    'node:crypto': crypto,
    '@/lib/server/daily-quota-store': {
      getEnrichmentQuotaOperation: async () => options.existing ?? null,
      getEffectiveDailyQuotaLimits: async () => ({ enrich: 20, research: 5 }),
      claimEnrichmentQuotaOperation: async (input: any) => {
        calls.claims.push(input);
        const allowed = options.allowed ?? true;
        return { operationId: input.operationId, claimed: true, allowed, claimToken: allowed ? 'claim' : null, consumed: allowed ? input.count : 0, count: 7, limit: 20, reused: false, status: 'claimed' };
      },
      markEnrichmentQuotaOperationSubmitted: async () => { calls.submitted++; },
      completeEnrichmentQuotaOperation: async (input: any) => { calls.completed.push(input); },
      releaseEnrichmentQuotaOperation: async () => { calls.released++; return true; },
    },
    '@/lib/server/enrichment-search-access': {
      hasEnrichmentSearchCreditAccess: () => true,
      enrichmentSearchCreditsUnavailablePayload: () => ({ error: 'ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE' }),
    },
    '@/lib/server/lead-identity': {
      identityFromProvider,
      applyEnrichedIdentity: async (_client: unknown, input: unknown) => { calls.identities.push(input); },
    },
    '@/lib/server/leads-finder/client': { LEADS_FINDER_PROVIDER },
    '@/lib/server/leads-finder/reveal': reveal,
    '@/lib/server/leads-finder/vault': {
      isLeadsFinderId, LeadsFinderVaultError,
      readFromVault: async (_client: unknown, input: { ids: string[] }) => new Map(input.ids.filter(id => vault.has(id)).map(id => [id, vault.get(id)!])),
      forgetInVault: async (_client: unknown, input: { ids: string[] }) => { calls.forgotten.push(...input.ids); },
    },
    '@/lib/server/supabase-admin': {
      getSupabaseAdminClient: () => ({ from: (table: string) => ({ insert: async (row: any) => { assert.equal(table, 'enriched_leads'); calls.inserted.push(row); return { error: null }; } }) }),
    },
  });
  return { POST, calls };
}

const SAVED_ANA = '11111111-1111-4111-8111-111111111111';
const SAVED_JORGE = '22222222-2222-4222-8222-222222222222';
const enrichBody = (ids = [people[0].lead.id, people[1].lead.id]) => ({
  leads: ids.map((id, index) => ({ sourceProviderId: id, clientRef: index === 0 ? SAVED_ANA : SAVED_JORGE })), revealEmail: true, revealPhone: false,
});

test('«Enriquecer» reveals from the vault, charged like Apollo, and leaves the same enriched lead with leads_finder as provider', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('no second call to Apify'); });
  const { POST, calls } = enrichRoute();
  const response = await POST(post(enrichBody(), { 'idempotency-key': 'op-1' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls.claims.map(claim => [claim.resource, claim.count, claim.limit]), [['enrich', 1, 20]], 'only the person still in the vault is charged');
  assert.equal(calls.submitted, 1);
  assert.equal(calls.inserted.length, 1);
  assert.equal(calls.inserted[0].source_provider, 'leads_finder');
  assert.equal(calls.inserted[0].email, 'ana.perez@empresa-demo.cl');
  assert.equal(calls.inserted[0].enrichment_status, 'completed');
  const [ana, jorge] = body.enriched;
  assert.equal(ana.clientRef, SAVED_ANA);
  assert.equal(ana.email, 'ana.perez@empresa-demo.cl');
  assert.equal(ana.fullName, 'Ana Pérez');
  assert.deepEqual([jorge.clientRef, jorge.enrichmentStatus], [SAVED_JORGE, 'expired'], 'Jorge is no longer in the vault: reported, not charged');
  assert.deepEqual(body.expired, [{ sourceProviderId: people[1].lead.id, clientRef: SAVED_JORGE }]);
  assert.deepEqual(calls.forgotten, [people[0].lead.id], 'the vault forgets what was revealed');
  assert.equal(calls.identities[0].savedLeadId, SAVED_ANA, 'the saved contact gets its real name back');
  // The operation keeps the outcome for a replay, not the contact.
  assert.equal(JSON.stringify(calls.completed[0].responsePayload).includes('ana.perez'), false);
});

test('a retry replays, expired results are not charged, and a spent allowance writes nothing', async () => {
  const replay = enrichRoute({ existing: { operationId: 'op-1', claimed: false, allowed: true, status: 'completed', responseStatus: 200, responsePayload: { enriched: [{ clientRef: SAVED_ANA, enrichmentStatus: 'completed' }] }, consumed: 1, count: 7, limit: 20, reused: true } });
  const replayed = await replay.POST(post(enrichBody(), { 'idempotency-key': 'op-1' }));
  assert.equal(replayed.status, 200);
  assert.equal(replayed.headers.get('x-idempotent-replay'), 'true');
  assert.equal(replay.calls.claims.length + replay.calls.inserted.length, 0, 'charged once');

  const gone = enrichRoute({ inVault: [] });
  const expired = await gone.POST(post(enrichBody(), { 'idempotency-key': 'op-2' }));
  assert.equal(expired.status, 410);
  assert.equal((await expired.json()).error, 'LEADS_FINDER_RESULTS_EXPIRED');
  assert.equal(gone.calls.claims.length, 0);

  const spent = enrichRoute({ allowed: false });
  const denied = await spent.POST(post(enrichBody(), { 'idempotency-key': 'op-3' }));
  assert.equal(denied.status, 429);
  assert.equal(spent.calls.submitted + spent.calls.inserted.length, 0);

  const none = enrichRoute({ email: 'otra@empresa-demo.cl' });
  assert.equal((await none.POST(post(enrichBody(), { 'idempotency-key': 'op-4' }))).status, 404);
  const route = enrichRoute();
  assert.equal((await route.POST(post(enrichBody()))).status, 400, 'an idempotency key is required');
  assert.equal((await route.POST(post({ leads: [{ sourceProviderId: 'apollo-123' }] }, { 'idempotency-key': 'op-5' }))).status, 400);
  assert.equal((await route.POST(post({ ...enrichBody(), revealEmail: false }, { 'idempotency-key': 'op-6' }))).status, 400);
  assert.equal(route.calls.claims.length, 0);
});
