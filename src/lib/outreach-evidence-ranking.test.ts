import assert from 'node:assert/strict';
import test from 'node:test';

import type { DraftContextV2 } from '@/lib/server/draft-context-v2';
import { rankOutreachEvidence, selectOutreachStrategy } from './outreach-evidence-ranking';

function evidence(id: string, statement: string, overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: id,
    statement,
    subjectScope: 'company' as const,
    confidence: 0.7,
    source: {
      sourceId: `src_${id}`,
      url: `https://example.com/${id}`,
      title: null,
      type: 'web',
      reliability: 0.7,
    },
    supportedFactClaimIds: [`c${id}`],
    ...overrides,
  };
}

function context(): DraftContextV2 {
  return {
    schemaVersion: 'draft-context/v2',
    research: {
      snapshotId: 'snap-1',
      contentHash: null,
      capturedAt: null,
      updatedAt: new Date().toISOString(),
      status: 'completed',
      fresh: true,
    },
    recipient: { leadRef: 'lead-1', email: 'renzo@example.com', displayName: 'Renzo' },
    company: { name: 'Empresa Tres', domain: 'example.com', websiteUrl: null, linkedinUrl: null, country: 'Chile' },
    person: { fullName: 'Renzo', title: 'Gerente de Operaciones', linkedinUrl: null, city: null, country: 'Chile' },
    seller: {
      name: 'Nicolas',
      jobTitle: 'Ejecutivo comercial',
      companyName: 'Yago',
      companyDomain: null,
      sector: null,
      description: null,
      services: ['Dotación transitoria para operaciones con centros de distribución'],
      valueProposition: 'Cobertura de turnos sin costo instalado',
      proofPoints: [],
    },
    style: { id: null, name: null, revision: null, contentHash: null, profile: {} },
    quality: { score: 80, minimumScore: 48, priority: 'A', sufficientResearch: true, draftEligible: true, factors: {} },
    report: {
      outreachBrief: {
        selectedFactualAnchorClaimIds: ['cops'],
        selectedHypothesisIds: [],
        doNotClaim: [],
      },
    },
    evidence: [
      evidence('generic', 'La empresa fue fundada hace varios años y opera en Chile.'),
      evidence('ops', 'La operación distribuye mercadería desde tres centros de distribución regionales con turnos rotativos.', { confidence: 0.9, source: { sourceId: 'src_ops', url: 'https://example.com/ops', title: null, type: 'web', reliability: 0.9 } }),
    ],
    hypotheses: [],
    constraints: {
      subject: { minCharacters: 3, maxCharacters: 80 },
      body: { minWords: 35, maxWords: 180 },
      cta: { exactText: '¿Te sirve que lo revisemos 15 minutos esta semana?', maximumCount: 1 },
      prohibitedPhrases: ['Espero que se encuentre bien'],
      minimumEvidenceProvenance: 1,
    },
    warnings: [],
  } as unknown as DraftContextV2;
}

test('ranking prefers role-relevant evidence over generic company facts', () => {
  const ranked = rankOutreachEvidence(context());
  assert.equal(ranked[0]?.evidence.evidenceId, 'ops');
});

test('strategy binds the selected fact to a seller capability without inventing needs', () => {
  const strategy = selectOutreachStrategy(context());
  assert.ok(strategy);
  assert.equal(strategy?.primaryFact.evidenceId, 'ops');
  assert.match(strategy?.capability || '', /Dotación transitoria/i);
  assert.equal(strategy?.exploratory, false);
  assert.match(strategy?.angle || '', /Gerente de Operaciones/);
});

test('strategy is exploratory when evidence cannot bridge to the offer', () => {
  const sparse = context();
  sparse.evidence = [evidence('generic', 'La empresa fue fundada hace varios años y opera en Chile.')];
  sparse.seller.services = ['Consultoría'];
  sparse.seller.valueProposition = null;
  const strategy = selectOutreachStrategy(sparse);
  assert.ok(strategy);
  assert.equal(strategy?.exploratory, true);
});

test('strategy can avoid already-used claims for follow-ups', () => {
  const strategy = selectOutreachStrategy(context(), { avoidClaimIds: ['cops'] });
  assert.ok(strategy);
  assert.notEqual(strategy?.primaryFact.claimId, 'cops');
});
