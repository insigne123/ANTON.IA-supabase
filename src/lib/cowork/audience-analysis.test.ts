import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStoredAudience, classifyAudienceRole } from './audience-analysis';
test('explicit role policy marks contextual exclusion and preserves conflicting candidates', () => {
  const policy = { decisionTerms: ['gerente'], userTerms: ['reclutamiento'], referralTerms: ['analista'], excludeTerms: ['estudiante'] };
  assert.equal(classifyAudienceRole('Estudiante', policy).role, 'excluded_by_criteria');
  assert.equal(classifyAudienceRole('Gerente y estudiante', policy).role, 'needs_review');
  assert.equal(classifyAudienceRole('Analista de reclutamiento', policy).persona, 'user_candidate');
  assert.equal(classifyAudienceRole('Otro cargo', policy).role, 'unknown');
});

test('audience role uses word boundaries and never discards an unknown title', () => {
  assert.equal(classifyAudienceRole('Servicios administrativos').role, 'unknown');
  assert.equal(classifyAudienceRole('Gerente de servicios transitorios').role, 'decision_maker_candidate');
  assert.equal(classifyAudienceRole('Administrativo de reclutamiento').persona, 'user_candidate');
  assert.equal(classifyAudienceRole('Gerente de operaciones').persona, 'buyer_and_user_candidate');
  assert.equal(classifyAudienceRole('HR Manager').role, 'decision_maker_candidate');
  assert.equal(classifyAudienceRole(null).confidence, 'unknown');
});

test('freshness counts distinct companies, not people or substring matches', () => {
  const result = analyzeStoredAudience([
    { id: '1', company: 'Besalco Construcciones', industry: 'Construcción' },
    { id: '2', company: 'BESALCO CONSTRUCCIONES', industry: 'Construcción' },
    { id: '3', company: 'UCC', industry: 'Construcción' },
    { id: '4', company: null, industry: 'Construcción' },
  ], [{ company: 'ucc', sent_at: '2026-01-01' }], { leadsComplete: true, historyComplete: true });
  assert.equal(result.verticals[0].companiesObserved, 2);
  assert.equal(result.verticals[0].companiesWithRecordedSend, 1);
  assert.equal(result.verticals[0].newCompanyPercent, 50);
  assert.equal(result.missingCompany, 1);
});

test('partial history cannot imply a fresh vertical; unsent rows never count as sends', () => {
  const leads = [{ id: 'a', company: 'Ácme', industry: 'Software' }];
  const complete = analyzeStoredAudience(leads, [{ company: 'ACME', sent_at: null }], { leadsComplete: true, historyComplete: true });
  assert.equal(complete.verticals[0].newCompanyPercent, 100);
  const partial = analyzeStoredAudience(leads, [], { leadsComplete: true, historyComplete: false });
  assert.equal(partial.verticals[0].newCompanyPercent, null);
});
