export type ResearchQualityStatus = 'queued' | 'running' | 'completed' | 'partial' | 'insufficient_data' | 'failed' | 'cancelled';

export type HardCompanyContactLimit = {
  enforced: boolean;
  maxContactosPorEmpresa: number | null;
  contactosExistentes: number;
  remaining: number | null;
  reached: boolean;
};

export type ResearchDraftEligibility = {
  eligible: boolean;
  blockReason: 'insufficient_research' | 'company_contact_limit_reached' | null;
  hardContactLimit: HardCompanyContactLimit;
};

export type ResearchQualityAssessment = {
  score: number;
  rawScore: number;
  sufficientResearch: boolean;
  scoreCapApplied: boolean;
  factors: {
    companyIdentity: number;
    contactIdentity: number;
    decisionRole: number;
    evidence: number;
    verifiedSources: number;
    recentSignals: number;
    confidence: number;
  };
  draftEligibility: ResearchDraftEligibility;
};

export type ResearchQualityInput = {
  status: ResearchQualityStatus | string;
  companyIdentityPresent: boolean;
  emailPresent: boolean;
  leadRolePresent: boolean;
  evidenceCount: number;
  verifiedSourceCount: number;
  companyFactCount?: number;
  companyFactSourceCount?: number;
  recentSignalCount: number;
  overallConfidence: number;
  maxContactosPorEmpresa?: number | null;
  contactosExistentes?: number | null;
};

function nonNegativeInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function configuredLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function confidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

export function evaluateHardCompanyContactLimit(input: {
  maxContactosPorEmpresa?: number | null;
  contactosExistentes?: number | null;
}): HardCompanyContactLimit {
  const maxContactosPorEmpresa = configuredLimit(input.maxContactosPorEmpresa);
  const contactosExistentes = nonNegativeInteger(input.contactosExistentes);
  const enforced = maxContactosPorEmpresa != null;
  const reached = enforced && contactosExistentes >= maxContactosPorEmpresa;

  return {
    enforced,
    maxContactosPorEmpresa,
    contactosExistentes,
    remaining: maxContactosPorEmpresa == null ? null : Math.max(0, maxContactosPorEmpresa - contactosExistentes),
    reached,
  };
}

export function evaluateResearchDraftEligibility(input: {
  sufficientResearch: boolean;
  maxContactosPorEmpresa?: number | null;
  contactosExistentes?: number | null;
}): ResearchDraftEligibility {
  const hardContactLimit = evaluateHardCompanyContactLimit(input);
  const blockReason = hardContactLimit.reached
    ? 'company_contact_limit_reached'
    : !input.sufficientResearch
      ? 'insufficient_research'
      : null;

  return {
    eligible: blockReason == null,
    blockReason,
    hardContactLimit,
  };
}

export function assessResearchQuality(input: ResearchQualityInput): ResearchQualityAssessment {
  const evidenceCount = nonNegativeInteger(input.evidenceCount);
  const verifiedSourceCount = nonNegativeInteger(input.verifiedSourceCount);
  const companyFactCount = nonNegativeInteger(input.companyFactCount);
  const companyFactSourceCount = nonNegativeInteger(input.companyFactSourceCount);
  const recentSignalCount = nonNegativeInteger(input.recentSignalCount);
  const normalizedConfidence = confidence(input.overallConfidence);
  const status = String(input.status || '').trim().toLowerCase();

  const factors = {
    companyIdentity: input.companyIdentityPresent ? 12 : 0,
    contactIdentity: input.emailPresent ? 10 : 0,
    decisionRole: input.leadRolePresent ? 6 : 0,
    evidence: Math.min(30, evidenceCount * 10),
    verifiedSources: Math.min(20, verifiedSourceCount * 10),
    recentSignals: Math.min(10, recentSignalCount * 4),
    confidence: Math.round(normalizedConfidence * 10),
  };
  const rawScore = Object.values(factors).reduce((total, value) => total + value, 0);
  const sufficientResearch = ['completed', 'partial'].includes(status)
    && evidenceCount > 0
    && verifiedSourceCount > 0
    && companyFactCount > 0
    && companyFactSourceCount > 0;
  const score = sufficientResearch ? rawScore : Math.min(40, rawScore);

  return {
    score,
    rawScore,
    sufficientResearch,
    scoreCapApplied: !sufficientResearch && rawScore > score,
    factors,
    draftEligibility: evaluateResearchDraftEligibility({
      sufficientResearch,
      maxContactosPorEmpresa: input.maxContactosPorEmpresa,
      contactosExistentes: input.contactosExistentes,
    }),
  };
}
