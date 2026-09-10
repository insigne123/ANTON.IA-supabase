import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import { PUBLIC_COMPANY_VERSION } from '@/lib/public-company-research-contracts';
import { isDraftableCompanyFactClaim } from '@/lib/research-fact-eligibility';
import type { ResearchSnapshotV1 } from '@/lib/research-contracts';
import { buildDraftContextV2, createDefaultDraftWritingStyleV2, normalizeDraftSellerProfileV2, requiredReportAwareDraftPersonalizationV2 } from './draft-context-v2';
import { DRAFT_FIXTURE_NOW, draftSnapshotFixture } from './draft-v2-test-fixtures';
import { isDraftableCompanyFactWithPublicEvidence } from './draft-public-company-evidence';

const prefix = 'public-company:00000000-0000-4000-8000-000000000001:1';

function snapshotFixture() {
  const snapshot = draftSnapshotFixture({ includeRole: false });
  snapshot.subject.company.country = 'Chile';
  snapshot.subject.person.country = 'CL';
  snapshot.publicCompanyResearch = {
    artifactId: '00000000-0000-4000-8000-000000000001', revision: 1,
    expiresAt: '2026-08-23T12:00:00.000Z',
    identity: { apolloOrganizationId: 'apollo-acme', domain: 'acme.example', country: 'CL', language: 'es', depth: 'standard', version: PUBLIC_COMPANY_VERSION },
  };
  const source = snapshot.sources[0];
  source.id = `${prefix}:src_aaaaaaaaaa`;
  source.provider = 'public-company';
  const evidence = snapshot.evidence[0];
  evidence.id = `${prefix}:f_bbbbbbbbbb`;
  evidence.sourceId = source.id;
  evidence.kind = 'quote';
  evidence.path = prefix;
  evidence.extraction = { method: 'rule', provider: 'public-company', version: prefix };
  const claim = snapshot.claims[0];
  snapshot.claims = [claim];
  claim.id = `${prefix}:c01`;
  claim.supportingEvidenceIds = [evidence.id];
  claim.derivation = { method: 'model', promptVersion: prefix };
  claim.freshness.validUntil = snapshot.publicCompanyResearch.expiresAt;
  return snapshot;
}

function build(snapshot: ResearchSnapshotV1, contentHash = canonicalSha256(snapshot)) {
  return buildDraftContextV2({
    snapshot, artifact: { contentHash, capturedAt: snapshot.updatedAt },
    seller: normalizeDraftSellerProfileV2({ companyName: 'Northstar', services: ['Operational automation'] }),
    style: createDefaultDraftWritingStyleV2(), now: DRAFT_FIXTURE_NOW,
  });
}

test('shared public-company model claims become ready using quote text without changing the snapshot or quality', () => {
  const snapshot = snapshotFixture();
  const original = structuredClone(snapshot);
  assert.equal(isDraftableCompanyFactClaim({ snapshot, claim: snapshot.claims[0], nowMs: DRAFT_FIXTURE_NOW.getTime() }), false);
  const result = build(snapshot);
  assert.equal(result.context.quality.sufficientResearch, true);
  assert.equal(result.context.quality.score, 50);
  assert.equal(result.status, 'ready');
  const [anchor] = requiredReportAwareDraftPersonalizationV2(result.context);
  assert.deepEqual(anchor, { claimId: snapshot.claims[0].id, evidenceId: snapshot.evidence[0].id, sourceUrl: snapshot.sources[0].url });
  assert.equal(result.context.evidence[0].statement, snapshot.evidence[0].statement);
  assert.notEqual(result.context.evidence[0].statement, snapshot.claims[0].statement);
  assert.deepEqual(snapshot, original);
  assert.equal(result.context.research.contentHash, canonicalSha256(original));
});

test('public-company exception rejects unverified, stale, foreign, contradicted and mixed provenance', async (t) => {
  const mutations: Array<[string, (snapshot: ResearchSnapshotV1) => void]> = [
    ['missing reference', (s) => { delete s.publicCompanyResearch; }],
    ['invalid UUID', (s) => { s.publicCompanyResearch!.artifactId = 'not-a-uuid'; }],
    ['invalid expiration', (s) => { s.publicCompanyResearch!.expiresAt = 'invalid'; }],
    ['expired reference', (s) => { s.publicCompanyResearch!.expiresAt = DRAFT_FIXTURE_NOW.toISOString(); }],
    ['wrong artifact', (s) => { s.publicCompanyResearch!.artifactId = '00000000-0000-4000-8000-000000000002'; }],
    ['wrong revision', (s) => { s.publicCompanyResearch!.revision = 2; }],
    ['foreign domain', (s) => { s.publicCompanyResearch!.identity.domain = 'foreign.example'; }],
    ['missing domain', (s) => { delete s.subject.company.domain; }],
    ['foreign country', (s) => { s.publicCompanyResearch!.identity.country = 'PE'; }],
    ['missing country', (s) => { delete s.subject.company.country; }],
    ['foreign person country', (s) => { s.subject.person.country = 'Peru'; }],
    ['generic model claim', (s) => { s.claims[0].id = 'generic-model'; s.claims[0].derivation.promptVersion = 'model/v1'; }],
    ['claim namespace suffix', (s) => { s.claims[0].id += ':other'; }],
    ['wrong prompt namespace', (s) => { s.claims[0].derivation.promptVersion = `${prefix}0`; }],
    ['hypothesis', (s) => { s.claims[0].classification = 'hypothesis'; }],
    ['person claim', (s) => { s.claims[0].subjectScope = 'person'; }],
    ['expired claim', (s) => { s.claims[0].freshness.validUntil = DRAFT_FIXTURE_NOW.toISOString(); }],
    ['direct contradiction', (s) => { s.claims[0].contradictingEvidenceIds = [s.evidence[0].id]; }],
    ['unresolved claim contradiction', (s) => { s.contradictions = [{ id: 'conflict', status: 'unresolved', summary: 'Conflicting account', claimIds: [s.claims[0].id], evidenceIds: [] }]; }],
    ['unresolved evidence contradiction', (s) => { s.contradictions = [{ id: 'conflict', status: 'unresolved', summary: 'Conflicting evidence', claimIds: [], evidenceIds: [s.evidence[0].id] }]; }],
    ['no supports', (s) => { s.claims[0].supportingEvidenceIds = []; }],
    ['dangling support', (s) => { s.claims[0].supportingEvidenceIds.push(`${prefix}:f_cccccccccc`); }],
    ['wrong evidence namespace', (s) => { s.evidence[0].id = `${prefix}0:f_bbbbbbbbbb`; s.claims[0].supportingEvidenceIds = [s.evidence[0].id]; }],
    ['wrong source namespace', (s) => { s.sources[0].id = `${prefix}0:src_aaaaaaaaaa`; s.evidence[0].sourceId = s.sources[0].id; }],
    ['wrong evidence path', (s) => { s.evidence[0].path = 'other'; }],
    ['wrong extraction version', (s) => { s.evidence[0].extraction.version = 'other'; }],
    ['wrong extraction provider', (s) => { s.evidence[0].extraction.provider = 'other'; }],
    ['model extraction', (s) => { s.evidence[0].extraction.method = 'model'; }],
    ['non-quote evidence', (s) => { s.evidence[0].kind = 'fact'; }],
    ['person evidence', (s) => { s.evidence[0].subjectScope = 'person'; }],
    ['wrong source provider', (s) => { s.sources[0].provider = 'other'; }],
    ['non-official source', (s) => { s.sources[0].type = 'other'; }],
    ['foreign source with company title', (s) => { s.sources[0].url = 'https://foreign.example/acme'; }],
    ['suffix domain attack', (s) => { s.sources[0].url = 'https://acme.example.foreign.example/'; }],
    ['challenge page', (s) => { s.sources[0].url = 'https://acme.example/cdn-cgi/challenge-platform/check'; }],
    ['boilerplate quote', (s) => { s.evidence[0].statement = 'Please wait while your request is being verified'; }],
    ['mixed supports', (s) => {
      const evidence = { ...structuredClone(s.evidence[0]), id: 'foreign-evidence' };
      s.evidence.push(evidence);
      s.claims[0].supportingEvidenceIds.push(evidence.id);
    }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const snapshot = snapshotFixture();
      mutate(snapshot);
      assert.equal(isDraftableCompanyFactWithPublicEvidence({ snapshot, claim: snapshot.claims[0], nowMs: DRAFT_FIXTURE_NOW.getTime() }), false);
      // Malformed references and missing links fail snapshot validation before drafting.
      if (['invalid UUID', 'invalid expiration', 'no supports', 'dangling support'].includes(name)) {
        assert.throws(() => build(snapshot));
      } else {
        const result = build(snapshot);
        assert.equal(result.status, 'blocked');
        assert.deepEqual(requiredReportAwareDraftPersonalizationV2(result.context), []);
      }
    });
  }
});

test('existing direct/rule eligibility is unchanged and generic model claims stay rejected', () => {
  const snapshot = draftSnapshotFixture();
  for (const method of ['direct', 'rule', 'model'] as const) {
    snapshot.claims[0].derivation.method = method;
    const input = { snapshot, claim: snapshot.claims[0], nowMs: DRAFT_FIXTURE_NOW.getTime() };
    assert.equal(isDraftableCompanyFactWithPublicEvidence(input), isDraftableCompanyFactClaim(input));
  }
});

test('public-company quotes do not bypass quality, hash, lifecycle or artifact freshness gates', () => {
  const lowQuality = snapshotFixture();
  lowQuality.quality.overallConfidence = 0.2;
  const stale = snapshotFixture();
  stale.updatedAt = '2026-07-01T12:00:00.000Z';
  const running = snapshotFixture();
  running.lifecycle.status = 'running';
  for (const [result, reason] of [
    [build(lowQuality), 'quality_below_threshold'],
    [build(stale), 'research_stale'],
    [build(running), 'research_not_ready'],
    [build(snapshotFixture(), 'a'.repeat(64)), 'research_artifact_invalid'],
  ] as const) {
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.reason, reason);
  }
});
