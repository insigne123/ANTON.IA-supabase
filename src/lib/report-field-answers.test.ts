import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportFieldAnswers,
  confidenceTierFor,
  countReportFieldAnswersByStatus,
  REPORT_FIELD_DEFINITIONS,
  validateReportFieldAnswers,
} from './report-field-answers';
import type { ResearchReportView, ResearchWorkspaceResult } from '@/lib/research-workspace';

const evidence = (id: string, sourceUrl = 'https://fuente.example/nota') => ({
  id,
  statement: `Evidencia ${id}`,
  sourceId: `source-${id}`,
  sourceUrl,
  sourceTitle: 'Fuente',
  sourceType: 'press',
  publishedAt: '2026-03-01T00:00:00.000Z',
  retrievedAt: '2026-03-02T00:00:00.000Z',
  confidence: 0.8,
});

const claim = (overrides: Record<string, unknown> = {}) => ({
  id: 'claim-base',
  kind: 'company_overview',
  statement: 'Acme ofrece servicios de operación.',
  classification: 'fact' as const,
  confidence: 0.85,
  validUntil: null,
  observedAt: '2026-03-01T00:00:00.000Z',
  canonicalClaimIds: ['claim-1'],
  evidence: [evidence('e1')],
  ...overrides,
});

let claimSeq = 0;
const namedClaim = (overrides: Record<string, unknown> = {}) => {
  claimSeq += 1;
  return claim({ id: `claim-${claimSeq}`, ...overrides });
};

function viewFixture(overrides: Partial<ResearchReportView> = {}): ResearchReportView {
  return {
    executive: [],
    person: { fields: [], facts: [] },
    company: [],
    companyContext: [],
    companySections: { overview: [], offerings: [], market: [], scale: [] },
    signals: [],
    opportunities: [],
    gaps: [],
    contradictions: [],
    evidenceRecords: [],
    sources: [],
    updatedAt: null,
    completeness: null,
    coverage: { claims: 0, evidenceRecords: 0, companyFacts: 0, signals: 0, sources: 0, profileFields: 0 },
    missing: { company: true, person: true },
    ...overrides,
  };
}

function resultFixture(lead: Record<string, unknown> = {}): ResearchWorkspaceResult {
  return {
    status: 'completed',
    researchSnapshotId: 'snapshot-1',
    lead: { fullName: 'Ana Silva', companyName: 'Acme', ...lead },
    score: 78,
    evidence: [],
    sources: [],
    angle: '',
    quality: { score: 78, sufficientResearch: true },
    draftEligibility: { eligible: false, blockReason: null },
    warnings: [],
  };
}

test('covers all five questionnaire groups with one answer per approved field', () => {
  const answers = buildReportFieldAnswers(viewFixture(), resultFixture());
  assert.equal(answers.length, REPORT_FIELD_DEFINITIONS.length);
  assert.deepEqual(
    [...new Set(answers.map((answer) => answer.group))].sort(),
    ['commercial', 'company', 'contact', 'decision', 'personalization'],
  );
  assert.deepEqual(answers.map((answer) => answer.key), REPORT_FIELD_DEFINITIONS.map((definition) => definition.key));
});

test('resolves declared, direct, estimated, hypothesis, unavailable and restricted statuses', () => {
  const report = viewFixture({
    company: [
      namedClaim({ kind: 'company_industry', statement: 'Acme opera en servicios transitorios.' }),
      namedClaim({ kind: 'company_size', statement: 'Se estima un rango aproximado de 400 a 600 colaboradores.' }),
    ],
    person: {
      fields: [{ label: 'Nombre', value: 'Ana Silva' }],
      facts: [namedClaim({ kind: 'contact_role', statement: 'Ana Silva ocupa el cargo de Directora de Operaciones.' })],
    },
    opportunities: [
      namedClaim({ kind: 'company_service', classification: 'hypothesis', statement: 'Podría convenir una propuesta de coordinación.' }),
    ],
  });
  const answers = buildReportFieldAnswers(report, resultFixture());
  const byKey = new Map(answers.map((answer) => [answer.key, answer]));
  assert.equal(byKey.get('company.name')?.status, 'confirmed');
  assert.equal(byKey.get('company.industry')?.status, 'confirmed');
  assert.ok((byKey.get('company.industry')?.sourceUrls || []).length > 0);
  assert.equal(byKey.get('company.employees')?.status, 'estimated');
  assert.ok(byKey.get('company.employees')?.detail);
  assert.equal(byKey.get('contact.title')?.status, 'confirmed');
  assert.equal(byKey.get('commercial.productFit')?.status, 'hypothesis');
  assert.ok(byKey.get('commercial.productFit')?.value.startsWith('Hipótesis por validar:'));
  assert.equal(byKey.get('decision.owner')?.status, 'unavailable');
  assert.ok(byKey.get('decision.owner')?.detail);
  assert.equal(byKey.get('contact.phone')?.status, 'restricted');
  assert.deepEqual(validateReportFieldAnswers(answers), []);
});

test('fail-closed: hypotheses never resolve estimated-only fields and guesses stay unavailable', () => {
  const report = viewFixture({
    opportunities: [
      namedClaim({ kind: 'company_size', classification: 'hypothesis', statement: 'Podría tener unos 500 colaboradores.' }),
    ],
  });
  const answers = buildReportFieldAnswers(report, resultFixture());
  const byKey = new Map(answers.map((answer) => [answer.key, answer]));
  assert.equal(byKey.get('company.employees')?.status, 'unavailable');
  assert.equal(byKey.get('company.employees')?.value, 'No disponible en la evidencia actual.');
});

test('exposes team-provided corporate email, never phones, invented revenue, competitors or probabilities', () => {
  const answers = buildReportFieldAnswers(
    viewFixture(),
    resultFixture({ fullName: 'Ana Silva', email: 'ana.silva@acme.example', companyName: 'Acme' }),
  );
  const joined = answers.map((answer) => `${answer.value} ${answer.detail || ''}`).join(' ');
  const byKey = new Map(answers.map((answer) => [answer.key, answer]));
  assert.ok(!joined.includes('ana.privada@example.com'));
  assert.equal(byKey.get('contact.email')?.status, 'confirmed');
  assert.ok(byKey.get('contact.email')?.value.includes('ana.silva@acme.example'));
  assert.equal(byKey.get('contact.phone')?.status, 'restricted');
  assert.equal(byKey.get('company.competitors')?.status, 'unavailable');
  assert.equal(byKey.get('company.revenue')?.status, 'unavailable');
  assert.equal(byKey.get('commercial.responseProbability')?.status, 'restricted');
  assert.equal(byKey.get('commercial.conversionProbability')?.status, 'restricted');
  assert.ok(!/\d+\s*%|\b0\.\d+\b/.test(joined));
  assert.deepEqual(validateReportFieldAnswers(answers), []);
  const counts = countReportFieldAnswersByStatus(answers);
  assert.equal(counts.restricted, 3);
  assert.ok(counts.unavailable > 0);
});

test('numeric confidence becomes qualitative tiers, never raw numbers', () => {
  assert.equal(confidenceTierFor(0.9), 'alta');
  assert.equal(confidenceTierFor(0.6), 'media');
  assert.equal(confidenceTierFor(0.2), 'baja');
  assert.equal(confidenceTierFor(null), 'sin determinar');
  const report = viewFixture({
    person: {
      fields: [],
      facts: [namedClaim({ kind: 'contact_authority', statement: 'Ana Silva lidera operaciones regionales.' })],
    },
  });
  const answers = buildReportFieldAnswers(report, resultFixture({ title: 'Directora de Operaciones' }));
  const decisor = answers.find((answer) => answer.key === 'contact.roleDecisor');
  assert.equal(decisor?.status, 'hypothesis');
  assert.ok(decisor?.value.startsWith('Hipótesis por validar:'));
  assert.ok(!/\b0\.\d+\b/.test(`${decisor?.value} ${decisor?.detail}`));
  const seniority = answers.find((answer) => answer.key === 'contact.seniority');
  assert.equal(seniority?.status, 'hypothesis');
  assert.match(seniority?.value || '', /Director/);
  const leadScore = answers.find((answer) => answer.key === 'commercial.leadScore');
  assert.equal(leadScore?.value, 'Nivel Media.');
  assert.ok(!leadScore?.value.includes('78'));
});

test('validation flags confirmed claims without sources and unframed hypotheses', () => {
  const answers = buildReportFieldAnswers(viewFixture(), resultFixture());
  const tampered = answers.map((answer) => (
    answer.key === 'company.name'
      ? { ...answer, status: 'confirmed' as const, sourceUrls: ['https://fuente.example'] }
      : answer.key === 'commercial.productFit'
        ? { ...answer, status: 'hypothesis' as const, value: 'Una corazonada sin marco.' }
        : answer
  ));
  const issues = validateReportFieldAnswers(tampered);
  assert.ok(!issues.some((issue) => issue.startsWith('confirmed_without_sources:company.name')));
  assert.ok(issues.includes('hypothesis_without_framing:commercial.productFit'));
  assert.deepEqual(validateReportFieldAnswers([...answers, { ...answers[0], key: 'invented.field' }]).filter((issue) => issue.startsWith('unknown_field')), ['unknown_field:invented.field']);
});
