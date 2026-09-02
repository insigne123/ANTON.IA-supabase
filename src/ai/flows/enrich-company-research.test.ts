import assert from 'node:assert/strict';
import test from 'node:test';

import { companyResearchEnrichmentInternals, mergeCompanyResearchClaimsV1 } from './enrich-company-research';
import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';

test('company enrichment adds only evidence-backed profile claims and caps single-source confidence', () => {
  const snapshot = draftSnapshotFixture();
  const enriched = mergeCompanyResearchClaimsV1({
    snapshot,
    model: 'fixture-model',
    candidates: [
      {
        kind: 'company_service',
        statement: 'Acme ofrece automatización para reducir el trabajo manual de equipos de operaciones.',
        confidence: 'high',
        evidenceIds: ['evidence-acme'],
      },
      {
        kind: 'company_size',
        statement: 'Acme cuenta con más de mil empleados.',
        confidence: 'high',
        evidenceIds: ['evidence-unknown'],
      },
    ],
  });

  const service = enriched.claims.find((claim) => claim.kind === 'company_service');
  assert.ok(service);
  assert.equal(service.confidence, 0.78);
  assert.deepEqual(service.supportingEvidenceIds, ['evidence-acme']);
  assert.equal(service.derivation.method, 'model');
  assert.equal(enriched.claims.some((claim) => claim.kind === 'company_size'), false);
});

test('company enrichment labels Apollo context as non-evidence and excludes contact fields', () => {
  const prompt = companyResearchEnrichmentInternals.buildPrompt(draftSnapshotFixture(), {
    schemaVersion: 'apollo-research-context/v1',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    observedAt: '2026-09-01T12:00:00.000Z',
    sources: [{ table: 'enriched_leads', recordId: 'lead-1', observedAt: '2026-09-01T12:00:00.000Z' }],
    person: {
      fullName: 'Ada Lovelace',
      title: 'Directora de Operaciones',
      email: 'must-not-enter@example.test',
    },
    company: { name: 'Acme', domain: 'acme.example', industry: 'Software' },
  } as any);
  assert.match(prompt, /observación auxiliar del proveedor/);
  assert.match(prompt, /no es evidencia pública/);
  assert.match(prompt, /Directora de Operaciones/);
  assert.doesNotMatch(prompt, /must-not-enter@example\.test/);
});
