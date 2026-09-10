import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import { PUBLIC_COMPANY_TTL_MS, publicCompanyCandidate, publicCompanyExternalBlock, publicCompanyCoverageWarnings, PUBLIC_COMPANY_EXTERNAL_MISSING, type PublicCompanyGraph } from '@/lib/public-company-research-contracts';
import { validatePublicCompanyGraph } from './public-company-research-validation';
import { mergePublicCompanyProjection, publicCompanyToNative } from '@/lib/public-company-research-adapter';
import { collectPublicCompany, loadPublicCompany, sharedPublicCompanyEnabled } from './public-company-research';
import { parseWebEvidenceV2 } from '@/lib/report-v2-extraction';
import { nativeResearchInternals } from './native-research';
import { projectResearchSnapshotV1ToReportV2 } from '@/lib/report-v2-snapshot-adapter';
import { collectPublicPersonEvidence } from './native-person-research';
import { gatherReportV2Research } from './research-report-v2-research';
import { isQualifiedResearchFactEvidence } from '@/lib/research-fact-eligibility';

const identity = publicCompanyCandidate({ apolloOrganizationId: 'apollo-org-1', companyDomain: 'acme.example', companyWebsite: 'https://www.acme.example/', country: 'Chile', language: 'es', depth: 'standard' })!;
function graph(at = Date.now() - 1000): PublicCompanyGraph {
  const url = 'https://acme.example/';
  const sourceId = buildStableReportV2Id('src', url);
  const facts = ['Acme presta servicios de soporte para equipos de operaciones.', 'Acme tambien ofrece servicios de mantenimiento y consultoria.'].map((block, index) => ({
    id: buildStableReportV2Id('f', { sourceId, index, block }), sourceId, text: block, observedAt: null, jurisdiction: null, locator: `block:${index + 1}`,
  }));
  return { sources: [{ id: sourceId, url, canonicalUrl: url, title: 'Acme', sourceType: 'corporate', jurisdiction: 'CL', publishedAt: null,
    modifiedAt: null, retrievedAt: new Date(at).toISOString(), ownDomain: true, contentHash: 'a'.repeat(64) }], facts,
  claims: [{ id: 'c01', internalId: 'f_1234567890', type: 'fact', dimension: 'company_service', statement: 'Acme presta servicios de soporte.',
    evidenceIds: [facts[0].id], observedAt: null, freshnessDays: null, jurisdiction: 'CL', scope: 'company', confidence: 0.8 }] };
}

// RPC mock models leases, but is not a SQL execution or multi-session lock test.
function harness() {
  let clock = Date.now();
  const rows = new Map<string, any>();
  const calls: Array<{ name: string; args: any }> = [];
  let collections = 0;
  const admin = { rpc: async (name: string, args: any) => {
    calls.push({ name, args });
    if (name.startsWith('claim_')) {
      const key = JSON.stringify([args.p_organization_id, args.p_identity]);
      let row = rows.get(key);
      if (!row) { row = { id: randomUUID(), organization_id: args.p_organization_id, identity: args.p_identity, revision: 0 }; rows.set(key, row); }
      if (!args.p_refresh && Date.parse(row.expires_at) > clock) return { data: { state: 'hit', artifact: structuredClone(row) }, error: null };
      if (Date.parse(row.lease_until) > clock) return { data: { state: 'busy' }, error: null };
      row.lease_token = randomUUID(); row.lease_until = new Date(clock + 300_000).toISOString();
      return { data: { state: 'miss', artifact: structuredClone(row), expired: Boolean(row.payload) }, error: null };
    }
    const row = [...rows.values()].find((row) => row.id === args.p_id && row.organization_id === args.p_organization_id);
    if (!row || row.lease_token !== args.p_token || Date.parse(row.lease_until) <= clock) return { data: null, error: new Error('lease lost') };
    row.lease_token = null; row.lease_until = null;
    if (name.startsWith('complete_')) Object.assign(row, { revision: row.revision + 1, payload: args.p_payload, captured_at: args.p_captured_at, expires_at: args.p_expires_at });
    return { data: structuredClone(row), error: null };
  } };
  const collect: typeof collectPublicCompany = async () => { collections += 1; return { graph: graph(clock - 1000), queries: 2, pages: 1, extractionBatches: 1 }; };
  return { admin, rows, calls, collect, now: () => clock, advance: (ms: number) => { clock += ms; }, count: () => collections, metric: () => undefined };
}

test('identity requires Apollo organization identity and isolates country/language/depth; no name or email fallback', () => {
  assert.equal(identity.domain, 'acme.example');
  assert.equal(identity.country, 'CL');
  assert.equal(identity.apolloOrganizationId, 'apollo-org-1');
  for (const input of [
    { companyDomain: 'acme.example', apolloOrganizationId: 'apollo-org-1' },
    { companyWebsite: 'https://acme.example', apolloOrganizationId: 'apollo-org-1' },
    { companyDomain: 'acme.example', companyWebsite: 'https://subsidiary.acme.example', apolloOrganizationId: 'apollo-org-1' },
    { companyDomain: 'acme.example', companyWebsite: 'https://other.example', apolloOrganizationId: 'apollo-org-1' },
    { companyDomain: 'gmail.com', companyWebsite: 'https://gmail.com', apolloOrganizationId: 'apollo-org-1' },
    { companyDomain: 'acme.example', companyWebsite: 'https://acme.example', apolloOrganizationId: null },
  ]) assert.equal(publicCompanyCandidate({ ...input, country: 'CL', language: 'es', depth: 'standard' }), null);
  const httpAdvertised = publicCompanyCandidate({ companyDomain: 'acme.example', companyWebsite: 'http://www.acme.example', apolloOrganizationId: 'apollo-org-1', country: 'CL', language: 'es', depth: 'standard' });
  assert.equal(httpAdvertised?.domain, 'acme.example');
  assert.equal(publicCompanyCandidate({ companyDomain: 'acme.example', companyWebsite: 'http://other.example', apolloOrganizationId: 'apollo-org-1', country: 'CL', language: 'es', depth: 'standard' }), null);
  assert.deepEqual(Object.keys(identity).sort(), ['apolloOrganizationId','country','depth','domain','language','version']);
});

test('cold/warm reuses all public work across users; org and dimensions stay isolated', async () => {
  const h = harness();
  const cold = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  const warm = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  assert.equal(h.count(), 1);
  assert.deepEqual(warm.graph, cold.graph);
  assert.deepEqual(warm.reference, cold.reference);
  assert.equal(warm.metrics.state, 'hit');
  assert.equal(warm.metrics.queries + warm.metrics.pages + warm.metrics.extractionBatches, 0);
  assert.equal(warm.metrics.costUsd, null);
  for (const other of [{ ...identity, country: 'PE' }, { ...identity, language: 'en' }, { ...identity, depth: 'deep' as const }]) {
    // Domain remains exact; mocked graph jurisdiction can be GLOBAL or another country.
    await loadPublicCompany({ identity: other, organizationId: 'org-a' }, h);
  }
  await loadPublicCompany({ identity: { ...identity, apolloOrganizationId: 'apollo-org-2' }, organizationId: 'org-a' }, h);
  await loadPublicCompany({ identity, organizationId: 'org-b' }, h);
  assert.equal(h.count(), 6);
  assert.doesNotMatch(JSON.stringify(h.calls), /seller|ownerUserId|snapshot|contact|leadId|icp/i);
});

test('expiry recollects without rejuvenation; failed force refresh preserves previous valid revision', async () => {
  const h = harness();
  const first = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  await assert.rejects(loadPublicCompany({ identity, organizationId: 'org-a', refresh: true }, { ...h, collect: async () => { throw new Error('PRIVATE PROVIDER ERROR'); } }));
  assert.deepEqual((await loadPublicCompany({ identity, organizationId: 'org-a' }, h)).reference, first.reference);
  assert.doesNotMatch(JSON.stringify(h.calls), /PRIVATE PROVIDER ERROR/);
  h.advance(PUBLIC_COMPANY_TTL_MS);
  const expired = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  assert.equal(expired.reference.revision, 2);
  assert.equal(expired.metrics.expired, true);
  const refreshed = await loadPublicCompany({ identity, organizationId: 'org-a', refresh: true }, h);
  assert.equal(refreshed.reference.revision, 3);
});

test('concurrent misses produce one collector and busy; expired tokens cannot publish', async () => {
  const h = harness();
  let resolve!: () => void;
  const blocked = new Promise<void>((done) => { resolve = done; });
  let entered!: () => void;
  const started = new Promise<void>((done) => { entered = done; });
  const first = loadPublicCompany({ identity, organizationId: 'org-a' }, { ...h, collect: async (input) => { entered(); await blocked; return h.collect(input); } });
  await started;
  await assert.rejects(loadPublicCompany({ identity, organizationId: 'org-a' }, h), /BUSY/);
  assert.equal(h.count(), 0);
  h.advance(300_001);
  const winner = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  resolve();
  await assert.rejects(first, /STORE_UNAVAILABLE/);
  assert.deepEqual((await loadPublicCompany({ identity, organizationId: 'org-a' }, h)).reference, winner.reference);
});

test('public graph rejects contaminated raw facts, private claims, unknown keys, bad references and expired captures', () => {
  for (const corrupt of [
    (value: any) => { value.contact = { fullName: 'PRIVATE' }; },
    (value: any) => { value.facts[1].text = 'PRIVATE seller ICP'; },
    (value: any) => { value.facts[1].sourceId = 'src_0000000000'; },
    (value: any) => { value.claims[0].dimension = 'contact_role'; },
    (value: any) => { value.claims[0].scope = 'person'; },
    (value: any) => { value.claims[0].evidenceIds = ['f_0000000000']; },
    (value: any) => { value.sources[0].url = 'https://subsidiary.acme.example/'; },
    (value: any) => { value.facts.push(value.facts[0]); },
  ]) { const value = graph(); corrupt(value); assert.throws(() => validatePublicCompanyGraph(value, identity)); }
  assert.throws(() => validatePublicCompanyGraph(graph(Date.now() - PUBLIC_COMPANY_TTL_MS), identity), /SOURCE_INVALID/);
});

test('collector sends only domain/public evidence to extraction, rejects redirects, and preserves uncited facts', async () => {
  let extractions = 0;
  const result = await collectPublicCompany({ identity, organizationId: 'org-a' }, {
    fetchSource: async ({ url, exactHost }) => {
      assert.equal(exactHost, true);
      return parseWebEvidenceV2({ html: '<article><p>Acme ofrece servicios de soporte para equipos de operaciones y clientes.</p><p>Tambien presta servicios de mantenimiento especializado para sus clientes.</p></article>', url, targetDomain: identity.domain, retrievedAt: new Date().toISOString() });
    },
    search: async (input) => { assert.match(String(input.query), /^(?:site:)?acme\.example CL /); return { items: [] } as any; },
    extract: async (input) => {
      extractions += 1;
      assert.equal(input.providerContext, null);
      assert.equal(input.companyName, identity.domain);
      assert.deepEqual(Object.keys(input).sort(), ['capturedAt','companyDomain','companyName','providerContext','sources']);
      return { sources: input.sources.map((page) => page.source), facts: input.sources.flatMap((page) => page.blocks.map((block, index) => ({
        id: buildStableReportV2Id('f', { sourceId: page.source.id, index, block }), sourceId: page.source.id, text: block, locator: `block:${index + 1}`, observedAt: null, jurisdiction: null,
      }))), claimDrafts: [], results: [], failedSourceIds: [] };
    },
  });
  assert.equal(extractions, 1);
  assert.ok(result.graph.facts.length >= 1);
  assert.match(result.graph.facts.map((fact) => fact.text).join(' '), /mantenimiento/);
  assert.equal(result.graph.claims.length, 0);
  await assert.rejects(collectPublicCompany({ identity, organizationId: 'org-a' }, { fetchSource: async () => ({ source: { canonicalUrl: 'https://other.example/' } }) as any }), /IDENTITY_MISMATCH/);
});

test('shared graph survives native snapshot and merges with a fresh private lead graph for audit', async () => {
  const h = harness();
  const company = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  let leadSearches = 0;
  for (const fullName of ['Ada Private', 'Bruno Private']) {
    const lead = { id: fullName, fullName, email: `${fullName.split(' ')[0]}@acme.example`, title: 'Director', companyName: 'Acme', companyDomain: identity.domain, country: 'CL' };
    const person = await collectPublicPersonEvidence({ organizationId: 'org-a', lead, options: { depth: 'standard', language: 'es', refresh: false }, search: async () => { leadSearches += 1; return { items: [] } as any; } });
    const output = nativeResearchInternals.buildSnapshot({ jobId: 'job', reportId: fullName, requestIdempotencyKey: 'request', access: { organizationId: 'org-a', userId: fullName },
      lead, options: { depth: 'standard', language: 'es', refresh: false }, company: { domain: identity.domain, official: null, whois: null, brand: null, fetchedAt: new Date().toISOString() },
      profile: {}, news: {}, jobs: {}, mentions: {}, similarweb: {}, person, warnings: person.warnings, publicCompany: company });
    assert.equal(output.snapshot.publicCompanyResearch?.artifactId, company.reference.artifactId);
    assert.ok(output.snapshot.evidence.some((fact) => fact.statement === company.graph.facts[1].text));
    const baseline = projectResearchSnapshotV1ToReportV2({ snapshot: output.snapshot, sellerProfile: { products: [] }, icpRules: null, generatedAt: new Date().toISOString() });
    const merged = mergePublicCompanyProjection(baseline, company.graph, company.reference);
    assert.equal(merged.entity.contact.fullName, fullName);
    assert.ok(merged.facts.some((fact) => fact.text === company.graph.facts[1].text));
    assert.ok(merged.claims.every((claim) => claim.evidenceIds.every((id) => merged.facts.some((fact) => fact.id === id))));
    assert.ok(merged.facts.every((fact) => merged.sources.some((source) => source.id === fact.sourceId)));
    assert.equal(new Set(merged.claims.map((claim) => claim.id)).size, merged.claims.length);
    assert.ok(merged.claims[0].internalId?.includes(company.reference.artifactId));
    assert.equal(merged.sources[0].retrievedAt, company.graph.sources[0].retrievedAt);
  }
  assert.equal(h.count(), 1);
  assert.ok(leadSearches >= 2);
  assert.doesNotMatch(JSON.stringify([...h.rows.values()]), /Ada Private|Bruno Private/);
  const native = publicCompanyToNative(company.graph, company.reference);
  assert.equal(native.claims[0].freshness.validUntil, company.reference.expiresAt);
  assert.equal(isQualifiedResearchFactEvidence({ evidence: native.evidence[0], source: native.sources[0], companyDomain: identity.domain }), true);
  assert.throws(() => publicCompanyToNative(company.graph, company.reference, Date.parse(company.reference.expiresAt)), /SOURCE_INVALID|EXPIRED/);
});

test('rollout is off by default and shared branch bypasses all three native company costs and legacy V2 checkpoint', () => {
  assert.equal(sharedPublicCompanyEnabled(), false);
  const native = readFileSync('src/lib/server/native-research.ts', 'utf8');
  assert.ok(native.indexOf('await loadPublicCompany(') < native.indexOf('} : await collectCompanySignals('));
  assert.match(native, /publicCompany \? Promise\.resolve\([\s\S]*?: collectSearchSignals/);
  assert.match(native, /if \(!publicCompany\) output.snapshot = await enrichCompanyResearchSnapshotV1/);
  const checkpoint = readFileSync('src/lib/server/research-report-v2-checkpoint.ts', 'utf8');
  assert.ok(checkpoint.indexOf('if (input.publicCompanyResearch) return') < checkpoint.indexOf('const identity = buildCompanyResearchArtifactIdentity'));
});

test('V2 shared path never invokes private company planning, fetching or extraction; keeps derived references and caller identity', async () => {
  const h = harness();
  const company = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  const baseline = {
    entity: { companyName: 'Acme', companyDomain: identity.domain, contactCountry: 'CL', operatingCountries: [], countryScopedPaths: {}, excludedPaths: [], ambiguities: [],
      contact: { fullName: 'Private Person', title: 'Director', seniority: 'director', department: 'Finance', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null } },
    qualification: { verdict: 'qualified', allowedDepth: 'deep', reasons: [], redirectTo: [] },
    ...graph(), shortIdMap: { c01: 'f_1234567890' }, committee: [], initialGaps: [],
  } as any;
  baseline.claims.push({ ...baseline.claims[0], id: 'c02', internalId: 'derived-private', type: 'derived', dimension: 'volume_estimate',
    inputs: ['c01'], formula: 'base * 2', assumptions: [{ id: 'asm_1234567890', label: 'Rate', value: 2, rationale: 'Private estimate', editable: true }] });
  const forbidden = async (): Promise<never> => { throw new Error('Unexpected repeated company expense'); };
  const result = await gatherReportV2Research({ projection: baseline, sellerProfile: { companyName: 'Private Seller', products: [] },
    organizationId: 'org-a', language: 'es', publicCompanyResearch: company.reference }, {
    loadPublicCompany: (input) => loadPublicCompany(input, h), plan: forbidden, resolve: forbidden, fetchSource: forbidden, search: forbidden, extract: forbidden,
  });
  assert.equal(h.count(), 1);
  assert.equal(result.researchMetrics.queries + result.researchMetrics.pages, 0);
  assert.equal(result.entity.contact.fullName, 'Private Person');
  assert.equal(result.claims.length, 3);
  assert.ok(result.researchWarnings.includes(PUBLIC_COMPANY_EXTERNAL_MISSING));
  assert.equal(result.claims[1].internalId, baseline.claims[0].internalId);
  const derived = result.claims.find((claim) => claim.type === 'derived')!;
  assert.equal(derived.type, 'derived');
  if (derived.type === 'derived') assert.deepEqual(derived.inputs, ['c02']);
  assert.equal(new Set(result.sources.map((source) => source.id)).size, result.sources.length);
  assert.doesNotMatch(JSON.stringify([...h.rows.values()]), /Private Person|Private Seller|Private estimate/);
  await assert.rejects(gatherReportV2Research({ projection: { ...baseline, entity: { ...baseline.entity, contactCountry: 'PE' } }, sellerProfile: { products: [] },
    organizationId: 'org-a', language: 'es', publicCompanyResearch: company.reference }, { loadPublicCompany: forbidden }), /MERGE_INVALID/);
});

test('country navigation survives canonicalization; bounded external evidence is fetched and cached once', async () => {
  const h = harness();
  const fetched: string[] = [];
  let queries = 0;
  const collect: typeof collectPublicCompany = (input) => collectPublicCompany(input, {
    fetchSource: async ({ url, domain, exactHost }) => {
      fetched.push(url);
      assert.equal(exactHost, true);
      const html = url === 'https://acme.example/'
        ? '<a href="/chile/">Chile</a><p>Acme ofrece servicios de mantenimiento para clientes internacionales.</p>'
        : url.includes('press.example')
          ? '<p>La empresa acme.example anuncio una nueva oficina en Chile el 1 de septiembre de 2026.</p>'
          : '<p>Acme presta servicios de soporte especializado para sus clientes en Chile.</p>';
      return parseWebEvidenceV2({ html, url, targetDomain: domain, retrievedAt: new Date(h.now() - 1000).toISOString() });
    },
    search: async ({ query }) => {
      queries += 1;
      assert.doesNotMatch(String(query), /"|-site:/);
      return { items: String(query).startsWith(identity.domain) ? [{ link: 'https://press.example/acme' }, { link: 'https://unrelated.example/acme' },
        { link: 'https://acme.example/not-external' }, { link: 'https://subsidiary.acme.example/not-external' }] : [] } as any;
    },
    extract: async ({ sources, providerContext }) => {
      assert.equal(providerContext, null);
      return { sources: sources.map((page) => page.source), facts: sources.flatMap((page) => page.blocks.map((block, index) => ({
        id: buildStableReportV2Id('f', { sourceId: page.source.id, index, block }), sourceId: page.source.id,
        text: block, locator: `block:${index + 1}`, observedAt: null, jurisdiction: null,
      }))), claimDrafts: [], results: [], failedSourceIds: [] };
    },
  });
  const cold = await loadPublicCompany({ identity, organizationId: 'org-a' }, { ...h, collect });
  const warm = await loadPublicCompany({ identity, organizationId: 'org-a' }, { ...h, collect });
  assert.ok(fetched.includes('https://acme.example/chile'));
  assert.equal(queries, 3);
  assert.ok(fetched.every((url) => !url.endsWith('/not-external')));
  assert.deepEqual(warm.graph, cold.graph);
  assert.equal(warm.metrics.pages + warm.metrics.queries, 0);
  assert.equal(cold.graph.sources.filter((source) => !source.ownDomain).length, 1);
  assert.ok(!publicCompanyCoverageWarnings(cold.graph).includes(PUBLIC_COMPANY_EXTERNAL_MISSING));
  assert.equal(publicCompanyToNative(cold.graph, cold.reference).sources.find((source) => source.url.includes('press.example'))?.type, 'other');
  const corrupt = structuredClone(cold.graph);
  const external = corrupt.facts.find((fact) => fact.text.includes('acme.example'))!;
  external.text = external.text.replace('acme.example', 'other.example');
  external.id = buildStableReportV2Id('f', { sourceId: external.sourceId, index: 0, block: external.text });
  assert.throws(() => validatePublicCompanyGraph(corrupt, identity), /FACT_INVALID/);
});

test('external identity does not match email, lookalikes, or a subsidiary', () => {
  for (const text of ['fakeacme.example', 'acme.example.evil.com', 'person@acme.example', 'subsidiary.acme.example', 'acmeXexample']) {
    assert.equal(publicCompanyExternalBlock(text, identity.domain), false, text);
  }
  assert.equal(publicCompanyExternalBlock('Empresa (https://www.acme.example/), anuncio', identity.domain), true);
});

test('native preserves event age and does not relabel group or another country as this company', async () => {
  const h = harness();
  const company = await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
  const value = structuredClone(company.graph);
  value.claims = [
    { ...value.claims[0], id: 'c01', dimension: 'signal', observedAt: new Date(h.now() - 90 * PUBLIC_COMPANY_TTL_MS).toISOString() },
    { ...value.claims[0], id: 'c02', scope: 'group' },
    { ...value.claims[0], id: 'c03', scope: 'country', jurisdiction: 'PE' },
  ];
  const native = publicCompanyToNative(value, company.reference);
  assert.equal(native.claims.length, 1);
  assert.equal(native.claims[0].freshness.asOf, value.claims[0].observedAt);
  assert.equal(native.evidence.length, value.facts.length);
  for (const age of [1, 90]) {
    value.claims[0].observedAt = new Date(h.now() - age * PUBLIC_COMPANY_TTL_MS).toISOString();
    const output = nativeResearchInternals.buildSnapshot({ jobId: 'job', reportId: 'report', requestIdempotencyKey: 'request', access: { organizationId: 'org-a', userId: 'owner' },
      lead: { companyDomain: identity.domain, companyName: 'Acme', country: 'CL' }, options: { depth: 'standard', language: 'es', refresh: false },
      company: { domain: identity.domain, official: null, whois: null, brand: null, fetchedAt: new Date().toISOString() },
      profile: {}, news: {}, jobs: {}, mentions: {}, similarweb: {}, person: { query: null, provider: 'serper', fetchedAt: new Date().toISOString(), items: [], warnings: [] },
      warnings: [], publicCompany: { ...company, graph: value } });
    assert.equal(output.snapshot.quality.coverage.recentSignals, age === 1 ? 0.5 : 0);
  }
  value.claims[0].observedAt = null;
  assert.throws(() => validatePublicCompanyGraph(value, identity), /CLAIM_INVALID/);
  value.claims[0].observedAt = new Date(h.now() - 500).toISOString();
  assert.throws(() => validatePublicCompanyGraph(value, identity), /CLAIM_INVALID/);
});

test('native enrollment uses original request fields at enqueue, not Apollo-enriched worker fields', () => {
  const native = readFileSync('src/lib/server/native-research.ts', 'utf8');
  const enqueue = native.slice(native.indexOf('async function enqueueNativeResearchInternal'), native.indexOf('export async function enqueueNativeResearch('));
  assert.match(enqueue, /publicCompanyIdentity: sharedPublicCompanyEnabled\(\) \? await loadApolloPublicCompanyIdentity\(/);
  assert.match(enqueue, /lead: requestedLead, apolloContext/);
  const worker = native.slice(native.indexOf('async function processJob('));
  assert.doesNotMatch(worker, /publicCompanyCandidate\(/);
  assert.match(worker, /PublicCompanyIdentitySchema.parse\(job.requestPayload.publicCompanyIdentity\)/);
  assert.match(worker, /canonicalJson\(publicIdentity\) !== canonicalJson\(currentIdentity\)/);
});

test('collector rejects raw facts with valid recomputed IDs when they were not fetched', async () => {
  await assert.rejects(collectPublicCompany({ identity, organizationId: 'org-a' }, {
    fetchSource: async ({ url }) => parseWebEvidenceV2({ html: '<article><p>Acme ofrece servicios de soporte y mantenimiento especializado a sus clientes.</p></article>', url, targetDomain: identity.domain, retrievedAt: new Date().toISOString() }),
    search: async () => ({ items: [] }) as any,
    extract: async ({ sources }) => {
      const sourceId = sources[0].source.id;
      const block = 'Private seller and ICP injected into an uncited fact';
      return { sources: sources.map((source) => source.source), facts: [{ id: buildStableReportV2Id('f', { sourceId, index: 0, block }), sourceId,
        text: block, observedAt: null, jurisdiction: null, locator: 'block:1' }], claimDrafts: [], results: [], failedSourceIds: [] };
    },
  }), /FACT_ORIGIN_INVALID/);
});

test('store scope mismatch and malformed or stale hits fail closed without paid fallback', async () => {
  for (const mutate of [
    (row: any) => { row.organization_id = 'other'; },
    (row: any) => { row.identity = { ...identity, domain: 'other.example' }; },
    (row: any) => { row.expires_at = 'invalid'; },
    (row: any) => { row.captured_at = new Date(Date.now() + 1000).toISOString(); },
    (row: any) => { row.payload.facts[1].text = 'Private contact'; },
  ]) {
    const h = harness();
    await loadPublicCompany({ identity, organizationId: 'org-a' }, h);
    mutate([...h.rows.values()][0]);
    const admin = { rpc: async () => ({ data: { state: 'hit', artifact: [...h.rows.values()][0] }, error: null }) };
    await assert.rejects(loadPublicCompany({ identity, organizationId: 'org-a' }, { ...h, admin }));
    assert.equal(h.count(), 1);
  }
});
