import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseWebEvidenceV2, resolveEntityFromExistingContextV2 } from '@/lib/report-v2-extraction';
import { qualifyEntityV2 } from './icp-gate';

const golden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const provider = JSON.parse(readFileSync('test/fixtures/grupoexpro/provider-context.json', 'utf8'));

function grupoExproEntity() {
  const html = readFileSync('test/fixtures/grupoexpro/peru.html', 'utf8');
  return resolveEntityFromExistingContextV2({
    contact: provider.contact,
    domain: golden.domain,
    sources: [parseWebEvidenceV2({
      html,
      url: 'https://grupoexpro.com/peru/quienes-somos/',
      targetDomain: golden.domain,
      retrievedAt: golden.capturedAt,
      jurisdiction: 'PE',
    })],
  });
}

test('rejects the imported contact while preserving account redirects and both rejection reasons', () => {
  const qualification = qualifyEntityV2({
    entity: grupoExproEntity(),
    rules: golden.sellerProfile.icpRules,
    headcount: 12_000,
  });
  assert.equal(qualification.verdict, golden.expected.qualificationVerdict);
  assert.equal(qualification.allowedDepth, 'shallow');
  assert.ok(qualification.reasons.some((reason) => reason.includes('jurisdiction')));
  assert.ok(qualification.reasons.some((reason) => reason.includes('role')));
  assert.ok(qualification.redirectTo.length >= golden.expected.minimumRedirects);
});

test('missing tenant rules never borrow defaults and only allow shallow research', () => {
  const qualification = qualifyEntityV2({ entity: grupoExproEntity(), rules: null });
  assert.deepEqual(qualification, {
    verdict: 'qualified',
    reasons: ['icp_rules_missing'],
    redirectTo: [],
    allowedDepth: 'shallow',
  });
});

test('only a fully matching contact and account enable deep research', () => {
  const entity = {
    ...grupoExproEntity(),
    contactCountry: 'CL' as const,
    contact: { ...grupoExproEntity().contact, title: 'Gerente de Operaciones', seniority: 'manager' as const, department: 'Operaciones' },
  };
  const qualification = qualifyEntityV2({ entity, rules: golden.sellerProfile.icpRules, headcount: 12_000 });
  assert.equal(qualification.verdict, 'qualified');
  assert.equal(qualification.allowedDepth, 'deep');
});
