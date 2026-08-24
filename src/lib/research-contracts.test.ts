import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResearchRequestIdempotencyKeyV1,
  getResearchAutoContactBlockReasonV1,
  ResearchSnapshotV1Schema,
  type ResearchSnapshotV1,
} from '@/lib/research-contracts';

const NOW = '2026-08-13T12:00:00.000Z';
const HASH = `sha256:${'a'.repeat(64)}`;

function validSnapshot(): ResearchSnapshotV1 {
  return {
    kind: 'research_snapshot' as const,
    schemaVersion: 'research-snapshot/v1' as const,
    id: 'snapshot-1',
    revision: 1 as const,
    scope: {
      kind: 'organization' as const,
      organizationId: 'org-1',
      ownerUserId: 'user-1',
    },
    subject: {
      leadRef: 'lead-1',
      email: 'jane@acme.test',
      person: {
        fullName: 'Jane Doe',
        linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
      },
      company: {
        name: 'Acme',
        domain: 'acme.test',
        websiteUrl: 'https://acme.test/',
      },
    },
    request: {
      requestId: 'request-1',
      idempotencyKey: 'request-key-1',
      inputFingerprint: HASH,
      provider: 'fixture',
      language: 'en',
      depth: 'standard' as const,
      requestedAt: NOW,
    },
    lifecycle: {
      status: 'completed' as const,
      completedAt: NOW,
      errors: [],
    },
    sources: [{
      id: 'source-1',
      type: 'official_site' as const,
      url: 'https://acme.test/about',
      canonicalUrl: 'https://acme.test/about',
      title: 'About Acme',
      provider: 'fixture',
      publishedAt: '2026-08-01T00:00:00.000Z',
      retrievedAt: NOW,
      reliability: 0.9,
    }],
    evidence: [{
      id: 'evidence-1',
      subjectScope: 'company' as const,
      kind: 'fact' as const,
      path: '$.overview',
      statement: 'Acme builds workflow software.',
      sourceId: 'source-1',
      locator: { kind: 'page_section' as const, value: 'About' },
      extractedAt: NOW,
      confidence: 0.85,
      extraction: {
        method: 'rule' as const,
        provider: 'fixture',
        version: 'fixture/v1',
      },
    }],
    claims: [{
      id: 'claim-1',
      kind: 'company_overview' as const,
      subjectScope: 'company' as const,
      classification: 'fact' as const,
      statement: 'Acme builds workflow software.',
      supportingEvidenceIds: ['evidence-1'],
      contradictingEvidenceIds: [],
      confidence: 0.85,
      freshness: {
        asOf: NOW,
        validUntil: '2026-09-12T12:00:00.000Z',
        policyVersion: 'research-freshness/v1' as const,
      },
      derivation: { method: 'direct' as const },
    }],
    contradictions: [],
    quality: {
      assessmentVersion: 'research-quality/v1' as const,
      coverage: { company: 1, person: 0, recentSignals: 0 },
      overallConfidence: 0.85,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test('ResearchSnapshotV1 accepts a valid strict completed snapshot', () => {
  const parsed = ResearchSnapshotV1Schema.parse(validSnapshot());

  assert.equal(parsed.id, 'snapshot-1');
  assert.equal(parsed.claims[0].supportingEvidenceIds[0], 'evidence-1');
});

test('canonical readiness rejects URL-only and fallback payloads', () => {
  assert.equal(getResearchAutoContactBlockReasonV1({
    status: 'completed',
    sources: [{ id: 'source-1', url: 'https://acme.test/about' }],
  }), 'insufficient_research');
  assert.equal(getResearchAutoContactBlockReasonV1({
    status: 'completed',
    source: 'fallback',
    overview: 'Acme builds workflow software for finance teams.',
    sources: [{ id: 'source-1', url: 'https://acme.test/about' }],
  }), 'fallback');
});

test('canonical readiness requires an explicit claim-evidence-source chain', () => {
  const snapshot = validSnapshot();
  assert.equal(getResearchAutoContactBlockReasonV1(snapshot), null);

  const unrelated = validSnapshot();
  unrelated.claims[0].supportingEvidenceIds = [];
  assert.equal(getResearchAutoContactBlockReasonV1(unrelated), 'missing_evidence_links');
  assert.equal(getResearchAutoContactBlockReasonV1({
    status: 'completed',
    pains: [{ statement: 'Manual reconciliation delays monthly reporting.', url: 'https://other.test/article' }],
    sources: [{ id: 'source-1', url: 'https://acme.test/about' }],
  }), 'missing_evidence_links');
});

test('company identity alone is not substantive research', () => {
  const snapshot = validSnapshot();
  snapshot.claims[0].kind = 'company_identity';

  assert.equal(getResearchAutoContactBlockReasonV1(snapshot), 'insufficient_research');
  assert.equal(ResearchSnapshotV1Schema.safeParse(snapshot).success, false);
});

test('research request idempotency is stable within a freshness bucket', () => {
  const input = {
    ownerId: ' Org-1:User-1 ',
    leadRef: ' Lead-1 ',
    email: 'JANE@ACME.TEST',
    companyDomain: 'ACME.TEST',
    provider: 'lead-research',
    freshnessBucket: '2026-08-13',
  };
  const first = buildResearchRequestIdempotencyKeyV1(input);
  const retry = buildResearchRequestIdempotencyKeyV1({ ...input, email: 'jane@acme.test' });
  const refresh = buildResearchRequestIdempotencyKeyV1({ ...input, freshnessBucket: '2026-08-14' });

  assert.equal(first, retry);
  assert.notEqual(first, refresh);
});

test('ResearchSnapshotV1 rejects unknown messaging fields at every strict boundary', () => {
  const rootMessaging = { ...validSnapshot(), emailDraft: { subject: 'Hello', body: 'Body' } };
  const nestedMessaging = validSnapshot();
  Object.assign(nestedMessaging.subject.company, { subjectLines: ['Hello'] });

  assert.equal(ResearchSnapshotV1Schema.safeParse(rootMessaging).success, false);
  assert.equal(ResearchSnapshotV1Schema.safeParse(nestedMessaging).success, false);
});

test('ResearchSnapshotV1 rejects duplicate IDs and dangling references', () => {
  const duplicate = validSnapshot();
  duplicate.sources.push({ ...duplicate.sources[0] });

  const crossCollectionDuplicate = validSnapshot();
  crossCollectionDuplicate.evidence[0].id = 'source-1';
  crossCollectionDuplicate.claims[0].supportingEvidenceIds = ['source-1'];

  const dangling = validSnapshot();
  dangling.evidence[0].sourceId = 'missing-source';
  dangling.claims[0].supportingEvidenceIds = ['missing-evidence'];

  assert.equal(ResearchSnapshotV1Schema.safeParse(duplicate).success, false);
  assert.equal(ResearchSnapshotV1Schema.safeParse(crossCollectionDuplicate).success, false);
  assert.equal(ResearchSnapshotV1Schema.safeParse(dangling).success, false);
});

test('ResearchSnapshotV1 enforces confidence, ISO dates, and HTTP URLs', () => {
  const invalid = validSnapshot();
  invalid.quality.overallConfidence = 1.1;
  invalid.sources[0].retrievedAt = 'yesterday';
  invalid.sources[0].url = 'not a URL';

  const result = ResearchSnapshotV1Schema.safeParse(invalid);

  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    assert.ok(paths.includes('quality.overallConfidence'));
    assert.ok(paths.includes('sources.0.retrievedAt'));
    assert.ok(paths.includes('sources.0.url'));
  }
});

test('completed requires evidence-backed claims and no blocking errors', () => {
  const noEvidence = validSnapshot();
  noEvidence.claims[0].supportingEvidenceIds = [];

  const blocked = validSnapshot();
  blocked.lifecycle.errors.push({
    code: 'provider_http_error',
    stage: 'fetch',
    severity: 'blocking',
    retryable: true,
    message: 'Provider failed.',
    observedAt: NOW,
  });

  assert.equal(ResearchSnapshotV1Schema.safeParse(noEvidence).success, false);
  assert.equal(ResearchSnapshotV1Schema.safeParse(blocked).success, false);
});

test('partial requires a usable claim and a coverage, source, or parsing warning', () => {
  const noWarning = validSnapshot();
  noWarning.lifecycle.status = 'partial';

  const validPartial = validSnapshot();
  validPartial.lifecycle.status = 'partial';
  validPartial.lifecycle.errors.push({
    code: 'truncated_response',
    stage: 'parse',
    severity: 'warning',
    retryable: true,
    message: 'Response was truncated.',
    observedAt: NOW,
  });

  assert.equal(ResearchSnapshotV1Schema.safeParse(noWarning).success, false);
  assert.equal(ResearchSnapshotV1Schema.safeParse(validPartial).success, true);
});
