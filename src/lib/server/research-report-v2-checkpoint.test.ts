import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportV2Committee } from '@/ai/flows/build-report-v2-committee';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { parseWebEvidenceV2 } from '@/lib/report-v2-extraction';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import type { ReportV2SnapshotProjection } from '@/lib/report-v2-snapshot-adapter';
import { buildCompanyResearchArtifactIdentity, type CompanyResearchArtifact, type CompanyResearchArtifactIdentity } from './company-research-artifacts';
import { loadOrGatherReportV2Research } from './research-report-v2-checkpoint';
import { REPORT_V2_RESEARCH_VERSION, type gatherReportV2Research } from './research-report-v2-research';

type Input = Parameters<typeof loadOrGatherReportV2Research>[0];
type Dependencies = NonNullable<Parameters<typeof loadOrGatherReportV2Research>[1]>;
type Result = Awaited<ReturnType<typeof gatherReportV2Research>>;
const instant = '2026-09-08T12:00:00.000Z';

function input(): Input {
  return {
    researchSnapshotId: 'snapshot-private-id', ownerUserId: 'owner-private-id', synthesisContextHash: 'a'.repeat(64),
    organizationId: 'org-1', language: 'es', generatedAt: instant,
    sellerProfile: { products: [{ key: 'private-product', name: 'Private seller offer', description: 'Confidential pricing' }] },
    projection: {
      entity: {
        companyName: 'Acme', companyDomain: 'acme.example', contactCountry: 'PE', operatingCountries: [], countryScopedPaths: {}, excludedPaths: [], ambiguities: [],
        contact: { fullName: 'Imported Confidential Person', title: 'Director', seniority: 'director', department: 'Private department', tenureMonths: null, companyTenureMonths: null, linkedinUrl: 'https://linkedin.com/in/private-person' },
      },
      qualification: { verdict: 'qualified', allowedDepth: 'deep', reasons: ['Private seller criteria'], redirectTo: [] },
      sources: [], facts: [], claims: [], shortIdMap: {}, committee: [], initialGaps: [],
    },
  };
}

function gathered(value: Parameters<typeof gatherReportV2Research>[0]): Result {
  const source = parseWebEvidenceV2({
    html: '<article><p>Maria Publica es Gerente General de Acme.</p></article>',
    url: `https://${value.projection.entity.companyDomain}/peru/about`, targetDomain: value.projection.entity.companyDomain, retrievedAt: instant,
  }).source;
  const text = 'Maria Publica es Gerente General de Acme.';
  const fact = { id: buildStableReportV2Id('f', { sourceId: source.id, index: 0, block: text }), sourceId: source.id, text, observedAt: null, jurisdiction: null, locator: 'block:1' };
  const internalId = buildStableReportV2Id('f', { claim: text, evidenceIds: [fact.id] });
  const claims: ReportV2SnapshotProjection['claims'] = [{
    id: 'c01', internalId, type: 'fact', dimension: 'buying_committee', statement: text, evidenceIds: [fact.id],
    observedAt: null, freshnessDays: null, jurisdiction: 'PE', scope: 'person', confidence: 0.9,
  }];
  const entity = { ...value.projection.entity, operatingCountries: ['PE', 'CL'], countryScopedPaths: { PE: '/peru/', CL: '/chile/' } };
  return {
    ...value.projection, entity, sources: [source], facts: [fact], claims, shortIdMap: { c01: internalId },
    committee: buildReportV2Committee({ entity, qualification: value.projection.qualification, claims }),
    researchWarnings: [], researchMetrics: { queries: 6, pages: 1, elapsedMs: 100 },
  };
}

function harness(gather: typeof gatherReportV2Research = async (value) => gathered(value)) {
  let clock = Date.parse(instant);
  const artifacts = new Map<string, CompanyResearchArtifact>();
  const calls = {
    claim: [] as Parameters<NonNullable<Dependencies['claim']>>[0][],
    complete: [] as Parameters<NonNullable<Dependencies['complete']>>[0][],
    release: [] as Parameters<NonNullable<Dependencies['release']>>[0][],
    gather: [] as Parameters<typeof gatherReportV2Research>[0][],
  };
  const admin = { rpc() { throw new Error('Unexpected database access in unit test'); } };
  const dependencies: Dependencies = {
    admin,
    now: () => clock,
    claim: async (request, client) => {
      assert.equal(client, admin);
      calls.claim.push(request);
      const previous = artifacts.get(request.identity.cacheIdentity);
      if (previous && Date.parse(previous.expiresAt) > clock) {
        if (previous.status === 'completed' || previous.status === 'partial') return { state: 'cached', artifact: structuredClone(previous), claimToken: null };
        if (previous.status === 'running') return { state: 'busy', artifact: structuredClone(previous), claimToken: null };
      }
      const artifact: CompanyResearchArtifact = {
        ...request.identity, id: `artifact-${calls.claim.length}`, revision: (previous?.revision || 0) + 1, status: 'running', payload: {},
        expiresAt: new Date(clock + 300_000).toISOString(), errorCode: null, errorMessage: null, errorMetadata: {},
        createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString(), completedAt: null,
      };
      artifacts.set(artifact.cacheIdentity, artifact);
      return { state: 'claimed', artifact, claimToken: 'claim-token' };
    },
    complete: async (request, client) => {
      assert.equal(client, admin);
      calls.complete.push(structuredClone(request));
      const artifact = { ...request.artifact, status: request.status, payload: structuredClone(request.payload), expiresAt: request.expiresAt, errorMetadata: request.errorMetadata || {}, completedAt: new Date(clock).toISOString() };
      artifacts.set(artifact.cacheIdentity, artifact);
      return artifact;
    },
    release: async (request, client) => {
      assert.equal(client, admin);
      calls.release.push(request);
      artifacts.set(request.identity.cacheIdentity, { ...request.artifact, status: 'failed', expiresAt: new Date(clock).toISOString() });
      return true;
    },
    gather: async (value) => {
      calls.gather.push(value);
      return gather(value);
    },
  };
  return { dependencies, calls, artifacts, advance: (ms: number) => { clock += ms; } };
}

test('a late synthesis retry reuses only public evidence and keeps baseline contact and qualification', async () => {
  const value = input();
  const expected = gathered(value);
  const h = harness(async () => expected);
  const first = await loadOrGatherReportV2Research(value, h.dependencies);
  assert.equal(first, expected);
  assert.equal(h.calls.claim[0].leaseSeconds, 300);
  assert.equal(h.calls.complete[0].expiresAt, '2026-09-09T12:00:00.000Z');
  assert.equal(h.calls.complete[0].status, 'completed');
  assert.equal(h.calls.claim[0].identity.provider, 'report-v2');
  assert.match(h.calls.claim[0].identity.providerVersion, /^report-v2\//);
  assert.deepEqual(Object.keys(h.calls.complete[0].payload).sort(), ['claims', 'facts', 'shortIdMap', 'sources']);
  const persisted = JSON.stringify(h.calls.complete[0].payload);
  for (const secret of ['Imported Confidential Person', 'Private department', 'private-person', 'private-product', 'Private seller offer', 'Confidential pricing', 'Private seller criteria', value.ownerUserId, value.researchSnapshotId]) {
    assert.equal(persisted.includes(secret), false, secret);
  }
  assert.match(persisted, /Maria Publica/);
  assert.equal('researchSnapshotId' in h.calls.gather[0], false);
  assert.equal('ownerUserId' in h.calls.gather[0], false);
  assert.equal('synthesisContextHash' in h.calls.gather[0], false);

  h.advance(60_000);
  const second = await loadOrGatherReportV2Research({ ...value, generatedAt: '2026-09-08T12:01:00.000Z' }, { ...h.dependencies });
  assert.equal(h.calls.gather.length, 1);
  assert.equal(h.calls.complete.length, 1);
  assert.equal(h.calls.release.length, 0);
  assert.deepEqual(second.claims, first.claims);
  assert.deepEqual(second.facts, first.facts);
  assert.deepEqual(second.sources, first.sources);
  assert.deepEqual(second.shortIdMap, first.shortIdMap);
  assert.equal(second.entity, value.projection.entity);
  assert.equal(second.qualification, value.projection.qualification);
  assert.deepEqual(second.entity.countryScopedPaths, {});
  assert.deepEqual(second.committee, buildReportV2Committee({ entity: value.projection.entity, qualification: value.projection.qualification, claims: second.claims }));
  assert.ok(second.committee.some((member) => member.name === 'Imported Confidential Person'));
  assert.ok(second.committee.some((member) => member.name === 'Maria Publica'));
  assert.deepEqual(second.researchMetrics, { queries: 0, pages: 1, elapsedMs: 0 });
  assert.deepEqual(second.researchWarnings, []);
});

test('snapshot, owner, context, organization, domain, country, contact and language isolate cache identities', async () => {
  const h = harness();
  await loadOrGatherReportV2Research(input(), h.dependencies);
  const variations: Array<(value: Input) => void> = [
    (value) => { value.researchSnapshotId = 'manual-refresh-snapshot'; },
    (value) => { value.ownerUserId = 'other-owner'; },
    (value) => { value.synthesisContextHash = 'b'.repeat(64); },
    (value) => { value.organizationId = 'other-org'; },
    (value) => { value.projection.entity.companyDomain = 'other.example'; },
    (value) => { value.projection.entity.contactCountry = 'CL'; },
    (value) => { value.projection.entity.contact.fullName = 'Another Private Contact'; },
    (value) => { value.language = 'en'; },
  ];
  for (const vary of variations) {
    const value = input();
    vary(value);
    const result = await loadOrGatherReportV2Research(value, h.dependencies);
    assert.equal(result.entity.contactCountry, value.projection.entity.contactCountry);
    assert.equal(result.entity.contact.fullName, value.projection.entity.contact.fullName);
  }
  assert.equal(new Set(h.calls.claim.map((call) => call.identity.cacheIdentity)).size, variations.length + 1);
  assert.equal(h.calls.gather.length, variations.length + 1);
  const identities = JSON.stringify(h.calls.claim);
  assert.equal(identities.includes('owner-private-id'), false);
  assert.equal(identities.includes('Imported Confidential Person'), false);
});

test('the research version participates in the hashed provider context without being truncated', async () => {
  const value = input();
  const h = harness();
  await loadOrGatherReportV2Research(value, h.dependencies);
  const identity = h.calls.claim[0].identity;
  const entity = value.projection.entity;
  const context = {
    researchSnapshotId: value.researchSnapshotId, ownerUserId: value.ownerUserId, synthesisContextHash: value.synthesisContextHash,
    researchVersion: REPORT_V2_RESEARCH_VERSION,
    companyName: entity.companyName, companyDomain: entity.companyDomain, contactCountry: entity.contactCountry, contact: entity.contact, language: value.language,
  };
  const expected = (researchVersion: string) => buildCompanyResearchArtifactIdentity({
    ...identity, companyDomain: entity.companyDomain,
    providerContextFingerprint: canonicalSha256({ ...context, researchVersion }),
  });
  assert.equal(identity.cacheIdentity, expected(REPORT_V2_RESEARCH_VERSION).cacheIdentity);
  assert.notEqual(identity.cacheIdentity, expected(`${REPORT_V2_RESEARCH_VERSION}/next`).cacheIdentity);
});

test('warnings persist as partial status, never private warning text, and expire after 24 hours', async () => {
  const h = harness(async (value) => ({ ...gathered(value), researchWarnings: ['Private query or provider warning'] }));
  await loadOrGatherReportV2Research(input(), h.dependencies);
  assert.equal(h.calls.complete[0].status, 'partial');
  assert.equal(JSON.stringify(h.calls.complete[0].payload).includes('Private query'), false);
  h.advance(86_400_000 - 1);
  const cached = await loadOrGatherReportV2Research(input(), h.dependencies);
  assert.equal(h.calls.gather.length, 1);
  assert.deepEqual(cached.researchWarnings, ['cached_research_partial']);
  h.advance(1);
  await loadOrGatherReportV2Research(input(), h.dependencies);
  assert.equal(h.calls.gather.length, 2);
  assert.equal(h.calls.complete.length, 2);
});

test('busy leases skip gather, completion and release and expose a retryable error', async () => {
  const h = harness();
  const claim = h.dependencies.claim!;
  h.dependencies.claim = async (request, admin) => {
    await claim(request, admin);
    return claim(request, admin);
  };
  await assert.rejects(loadOrGatherReportV2Research(input(), h.dependencies), { message: 'REPORT_V2_RESEARCH_BUSY', code: 'REPORT_V2_RESEARCH_BUSY', retryable: true });
  assert.equal(h.calls.gather.length, 0);
  assert.equal(h.calls.complete.length, 0);
  assert.equal(h.calls.release.length, 0);
});

test('gather and completion failures release the lease without persisting provider text', async () => {
  const failure = new Error('Prompt containing Imported Confidential Person and private seller pricing');
  const h = harness(async () => { throw failure; });
  await assert.rejects(loadOrGatherReportV2Research(input(), h.dependencies), (error) => error === failure);
  assert.equal(h.calls.release.length, 1);
  assert.equal(h.calls.complete.length, 0);
  assert.equal(h.calls.release[0].errorMessage.includes('Imported Confidential Person'), false);

  h.dependencies.gather = async (value) => gathered(value);
  h.dependencies.complete = async () => { throw failure; };
  await assert.rejects(loadOrGatherReportV2Research(input(), h.dependencies), (error) => error === failure);
  assert.equal(h.calls.release.length, 2);
  h.dependencies.release = async () => { throw new Error('Release failed'); };
  await assert.rejects(loadOrGatherReportV2Research(input(), h.dependencies), (error) => error === failure);
});

test('baseline fallback, zero fetched pages and mixtures with imported claims are not checkpointed', async () => {
  for (const mode of ['fallback', 'zero_pages', 'mixed']) {
    const value = input();
    const imported = gathered(value);
    imported.claims[0].internalId = 'private-imported-claim';
    imported.claims[0].statement = 'Imported Confidential Person is a private lead.';
    imported.shortIdMap = { c01: 'private-imported-claim' };
    value.projection = imported;
    const h = harness(async (request) => {
      if (mode === 'fallback') return { ...request.projection, researchMetrics: { queries: 6, pages: 2, elapsedMs: 100 }, researchWarnings: ['some_claims_unavailable'] };
      const result = gathered(request);
      if (mode === 'zero_pages') result.researchMetrics.pages = 0;
      else result.claims.push({ ...imported.claims[0], id: 'c02' });
      return result;
    });
    await loadOrGatherReportV2Research(value, h.dependencies);
    await loadOrGatherReportV2Research(value, h.dependencies);
    assert.equal(h.calls.complete.length, 0, mode);
    assert.equal(h.calls.release.length, 2, mode);
    assert.equal(h.calls.gather.length, 2, mode);
  }
});

test('corrupt cached payloads fail explicitly without gathering or releasing another claim', async () => {
  const mutations: Array<(artifact: CompanyResearchArtifact) => void> = [
    (artifact) => { artifact.payload.claims[0].statement = 'A substituted public statement.'; },
    (artifact) => { artifact.payload.entity = input().projection.entity; },
    (artifact) => { artifact.errorMetadata = {}; },
    (artifact) => { artifact.providerVersion = 'another-version'; },
    (artifact) => { artifact.countryCode = 'cl'; },
  ];
  for (const mutate of mutations) {
    const h = harness();
    await loadOrGatherReportV2Research(input(), h.dependencies);
    const artifact = [...h.artifacts.values()][0];
    mutate(artifact);
    await assert.rejects(loadOrGatherReportV2Research(input(), h.dependencies), /REPORT_V2_RESEARCH_(CACHE|GRAPH)_INVALID/);
    assert.equal(h.calls.gather.length, 1);
    assert.equal(h.calls.release.length, 0);
  }
});

test('schema, content IDs, references and short IDs are validated even with a matching graph digest', async () => {
  const mutations: Array<(payload: CompanyResearchArtifact['payload']) => void> = [
    (graph) => { graph.facts[0].sourceId = 'src_0000000000'; },
    (graph) => { graph.claims[0].evidenceIds = ['f_0000000000']; },
    (graph) => { graph.shortIdMap.c01 = 'f_0000000000'; },
    (graph) => { graph.shortIdMap.c02 = graph.shortIdMap.c01; },
    (graph) => { delete graph.shortIdMap.c01; },
    (graph) => { graph.facts[0].text = 'Changed block content.'; },
    (graph) => { graph.sources[0].canonicalUrl = 'https://other.example/'; },
    (graph) => { graph.sources[0].contentHash = 'invalid'; },
    (graph) => { graph.sources.push(graph.sources[0]); },
    (graph) => { graph.facts.push(graph.facts[0]); },
    (graph) => { graph.claims.push(graph.claims[0]); },
    (graph) => { graph.claims[0].type = 'declared'; graph.claims[0].evidenceIds = []; },
    (graph) => { graph.entity = input().projection.entity; },
    (graph) => { graph.sources[0].importedDescription = 'Private company description'; },
  ];
  for (const mutate of mutations) {
    const h = harness();
    await loadOrGatherReportV2Research(input(), h.dependencies);
    const artifact = [...h.artifacts.values()][0];
    mutate(artifact.payload);
    artifact.errorMetadata.publicGraphHash = canonicalSha256({ cacheIdentity: artifact.cacheIdentity, graph: artifact.payload });
    await assert.rejects(loadOrGatherReportV2Research(input(), h.dependencies), /REPORT_V2_RESEARCH_GRAPH_INVALID/);
    assert.equal(h.calls.gather.length, 1);
    assert.equal(h.calls.release.length, 0);
  }
});

test('a malformed new web graph releases its own claim and never completes', async () => {
  for (const mutate of [
    (result: Result) => { result.claims[0].evidenceIds = ['f_0000000000']; },
    (result: Result) => { result.claims[0].internalId = null; },
    (result: Result) => { result.sources = []; },
  ]) {
    const h = harness(async (value) => {
      const result = gathered(value);
      mutate(result);
      return result;
    });
    await assert.rejects(loadOrGatherReportV2Research(input(), h.dependencies), /REPORT_V2_RESEARCH_GRAPH_INVALID/);
    assert.equal(h.calls.complete.length, 0);
    assert.equal(h.calls.release.length, 1);
  }
});

test('a public graph digest is bound to its scope, not just to its payload', async () => {
  const h = harness();
  await loadOrGatherReportV2Research(input(), h.dependencies);
  const first = structuredClone([...h.artifacts.values()][0]);
  const value = input();
  value.ownerUserId = 'different-owner';
  h.dependencies.claim = async ({ identity }: { identity: CompanyResearchArtifactIdentity }) => ({
    state: 'cached', artifact: { ...first, ...identity }, claimToken: null,
  });
  await assert.rejects(loadOrGatherReportV2Research(value, h.dependencies), /REPORT_V2_RESEARCH_CACHE_INVALID/);
  assert.equal(h.calls.gather.length, 1);
});

test('invalid scope and pre-aborted requests do not claim or gather', async () => {
  const h = harness();
  for (const overrides of [{ ownerUserId: '' }, { researchSnapshotId: '' }, { synthesisContextHash: 'invalid' }, { organizationId: '' }]) {
    await assert.rejects(loadOrGatherReportV2Research({ ...input(), ...overrides }, h.dependencies), /REPORT_V2_RESEARCH_SCOPE_INVALID/);
  }
  const aborted = new Error('Cancelled');
  await assert.rejects(loadOrGatherReportV2Research({ ...input(), signal: AbortSignal.abort(aborted) }, h.dependencies), (error) => error === aborted);
  assert.equal(h.calls.claim.length, 0);
  assert.equal(h.calls.gather.length, 0);
});

test('default artifact APIs use only the existing claim, complete and release RPCs with an injected admin', async () => {
  const calls: string[] = [];
  let row: Record<string, any> | null = null;
  const admin = {
    async rpc(name: string, args: Record<string, any>) {
      calls.push(name);
      if (name === 'claim_research_company_artifact_v1') {
        assert.equal(args.p_lease_seconds, 300);
        assert.equal(args.p_force_refresh, false);
        if (row?.status === 'completed' && row.cache_identity === args.p_cache_identity) {
          return { data: { state: 'cached', artifact: row, claim_token: null }, error: null };
        }
        row = {
          ...Object.fromEntries(Object.entries(args).filter(([key]) => !['p_force_refresh', 'p_lease_seconds'].includes(key)).map(([key, value]) => [key.slice(2), value])),
          id: 'artifact-rpc', revision: 1, status: 'running', payload: {}, expires_at: new Date(Date.now() + 300_000).toISOString(),
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null, error_metadata: {},
        };
        return { data: { state: 'claimed', artifact: row, claim_token: 'token-rpc' }, error: null };
      }
      assert.equal(args.p_artifact_id, 'artifact-rpc');
      assert.equal(args.p_claim_token, 'token-rpc');
      assert.equal(args.p_organization_id, input().organizationId);
      assert.equal(args.p_cache_identity, row?.cache_identity);
      if (name === 'complete_research_company_artifact_v1') {
        row = { ...row, status: args.p_status, payload: args.p_payload, expires_at: args.p_expires_at, completed_at: new Date().toISOString(), error_metadata: args.p_error_metadata };
        return { data: row, error: null };
      }
      assert.equal(name, 'release_research_company_artifact_claim_v1');
      return { data: true, error: null };
    },
  };
  let gathers = 0;
  const gather: typeof gatherReportV2Research = async (value) => { gathers += 1; return gathered(value); };
  await loadOrGatherReportV2Research(input(), { admin, gather });
  await loadOrGatherReportV2Research(input(), { admin, gather });
  assert.equal(gathers, 1);
  await assert.rejects(loadOrGatherReportV2Research({ ...input(), researchSnapshotId: 'fresh-snapshot' }, {
    admin, gather: async () => { throw new Error('Gather failed'); },
  }), /Gather failed/);
  assert.deepEqual(calls, [
    'claim_research_company_artifact_v1', 'complete_research_company_artifact_v1',
    'claim_research_company_artifact_v1', 'claim_research_company_artifact_v1', 'release_research_company_artifact_claim_v1',
  ]);
});
