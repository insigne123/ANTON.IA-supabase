import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessResearchQuality,
  evaluateHardCompanyContactLimit,
} from '@/lib/native-research-quality';

test('insufficient research is capped at forty and cannot draft', () => {
  const assessment = assessResearchQuality({
    status: 'insufficient_data',
    companyIdentityPresent: true,
    emailPresent: true,
    leadRolePresent: true,
    evidenceCount: 0,
    verifiedSourceCount: 0,
    recentSignalCount: 8,
    overallConfidence: 1,
  });

  assert.equal(assessment.rawScore, 48);
  assert.equal(assessment.score, 40);
  assert.equal(assessment.scoreCapApplied, true);
  assert.equal(assessment.sufficientResearch, false);
  assert.equal(assessment.draftEligibility.eligible, false);
  assert.equal(assessment.draftEligibility.blockReason, 'insufficient_research');
});

test('evidence-backed completed research is deterministically draft eligible', () => {
  const input = {
    status: 'completed',
    companyIdentityPresent: true,
    emailPresent: true,
    leadRolePresent: true,
    evidenceCount: 3,
    verifiedSourceCount: 2,
    companyFactCount: 2,
    companyFactSourceCount: 2,
    recentSignalCount: 1,
    overallConfidence: 0.82,
  } as const;
  const first = assessResearchQuality(input);
  const second = assessResearchQuality(input);

  assert.deepEqual(first, second);
  assert.ok(first.score > 40);
  assert.equal(first.sufficientResearch, true);
  assert.equal(first.draftEligibility.eligible, true);
  assert.equal(first.draftEligibility.hardContactLimit.enforced, false);
});

test('maxContactosPorEmpresa is a hard drafting exclusion, including zero', () => {
  const limit = evaluateHardCompanyContactLimit({
    maxContactosPorEmpresa: 2,
    contactosExistentes: 2,
  });
  assert.deepEqual(limit, {
    enforced: true,
    maxContactosPorEmpresa: 2,
    contactosExistentes: 2,
    remaining: 0,
    reached: true,
  });

  const assessment = assessResearchQuality({
    status: 'completed',
    companyIdentityPresent: true,
    emailPresent: true,
    leadRolePresent: true,
    evidenceCount: 2,
    verifiedSourceCount: 2,
    companyFactCount: 2,
    companyFactSourceCount: 2,
    recentSignalCount: 0,
    overallConfidence: 0.7,
    maxContactosPorEmpresa: 0,
    contactosExistentes: 0,
  });

  assert.equal(assessment.draftEligibility.eligible, false);
  assert.equal(assessment.draftEligibility.blockReason, 'company_contact_limit_reached');
  assert.equal(assessment.draftEligibility.hardContactLimit.reached, true);
});
