import type { AntoniaConfig } from '@/lib/types';

export type AntoniaAutopilotMode = 'manual_assist' | 'semi_auto' | 'full_auto';
export type AntoniaApprovalMode = 'all_contacts' | 'low_score_only' | 'high_risk_only' | 'disabled';
export type LeadScoreTier = 'hot' | 'warm' | 'cool' | 'cold';

export type NormalizedAutopilotConfig = {
  autopilotEnabled: boolean;
  autopilotMode: AntoniaAutopilotMode;
  approvalMode: AntoniaApprovalMode;
  minAutoSendScore: number;
  minReviewScore: number;
  bookingLink: string;
  meetingInstructions: string;
  pauseOnNegativeReply: boolean;
  pauseOnFailureSpike: boolean;
};

export type LeadScoreResult = {
  score: number;
  tier: LeadScoreTier;
  reason: string;
};

export type AutopilotContactDecision = {
  action: 'send' | 'review' | 'skip';
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
};

export type LeadMissionFitAssessment = {
  action: 'allow' | 'block';
  reason: string;
  matchedSignals: string[];
  blockingSignals: string[];
};

export const DEFAULT_AUTOPILOT_CONFIG: NormalizedAutopilotConfig = {
  autopilotEnabled: false,
  autopilotMode: 'manual_assist',
  approvalMode: 'low_score_only',
  minAutoSendScore: 70,
  minReviewScore: 45,
  bookingLink: '',
  meetingInstructions: '',
  pauseOnNegativeReply: true,
  pauseOnFailureSpike: true,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(normalizeText(needle)));
}

function safeNumber(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function uniqueTexts(values: unknown[]) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function parseMissionTerms(value: unknown) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function looselyMatchesText(text: string, target: string) {
  const normalizedText = normalizeText(text);
  const normalizedTarget = normalizeText(target);
  if (!normalizedText || !normalizedTarget) return false;
  if (normalizedText.includes(normalizedTarget) || normalizedTarget.includes(normalizedText)) return true;

  const targetTokens = tokenize(normalizedTarget);
  if (targetTokens.length === 0) return false;

  const overlap = targetTokens.filter((token) => normalizedText.includes(token)).length;
  return overlap >= Math.max(1, Math.ceil(targetTokens.length / 2));
}

const INDUSTRY_ALIASES: Record<string, string[]> = {
  logistics: ['logistics', 'logistica', 'supply chain', 'transportation', 'freight', 'warehousing', 'warehouse', 'distribution', 'courier', 'delivery', 'last mile', '3pl', 'shipping', 'cargo'],
  retail: ['retail', 'ecommerce', 'e-commerce', 'consumer goods'],
  technology: ['technology', 'tech', 'software', 'saas', 'it services', 'computer software'],
  healthcare: ['healthcare', 'health care', 'hospital', 'medical', 'pharma', 'biotech'],
  finance: ['finance', 'financial services', 'banking', 'insurance', 'fintech'],
  manufacturing: ['manufacturing', 'industrial', 'factory', 'automotive', 'electronics manufacturing'],
  mining: ['mining', 'mineria'],
};

const SENIORITY_KEYWORDS: Record<string, string[]> = {
  owner: ['owner', 'founder', 'cofounder', 'dueno', 'dueño'],
  c_suite: ['ceo', 'cfo', 'coo', 'cto', 'cio', 'chief'],
  partner: ['partner', 'socio'],
  vp: ['vp', 'vice president'],
  head: ['head'],
  director: ['director'],
  manager: ['manager', 'gerente'],
  lead: ['lead', 'lider', 'líder'],
  senior: ['senior', 'sr'],
  entry: ['assistant', 'analyst', 'analista', 'coordinator', 'coordinador', 'junior'],
};

function resolveIndustryNeedles(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return [] as string[];

  const aliases = new Set<string>([normalized]);
  for (const [key, variants] of Object.entries(INDUSTRY_ALIASES)) {
    if (normalized === key || normalized.includes(key) || key.includes(normalized)) {
      variants.forEach((variant) => aliases.add(normalizeText(variant)));
    }
  }
  return Array.from(aliases).filter(Boolean);
}

function matchesIndustryEvidence(text: string, targetIndustry: unknown) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;
  return resolveIndustryNeedles(targetIndustry).some((needle) => looselyMatchesText(normalizedText, needle));
}

function parseEmployeeRange(input: unknown): { min?: number; max?: number } | null {
  const normalized = String(input || '').trim();
  if (!normalized) return null;

  const plus = normalized.match(/^(\d+)\+$/);
  if (plus) return { min: Number(plus[1]) };

  const range = normalized.match(/^(\d+)\s*[-,]\s*(\d+)$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return a <= b ? { min: a, max: b } : { min: b, max: a };
    }
  }

  const exact = Number(normalized);
  if (Number.isFinite(exact) && exact > 0) return { min: exact, max: exact };
  return null;
}

function getLeadEmployeeCount(lead: any) {
  const candidates = [
    lead?.organizationSize,
    lead?.organization_size,
    lead?.job_company_size,
    lead?.organization?.estimated_num_employees,
    lead?.organization?.size,
    lead?.researchReport?.company?.size,
    lead?.researchReport?.cross?.company?.size,
    lead?.research?.company?.size,
    lead?.research?.cross?.company?.size,
  ];

  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return null;
}

function matchesMissionCompanySize(lead: any, companySize: unknown) {
  const range = parseEmployeeRange(companySize);
  const count = getLeadEmployeeCount(lead);
  if (!range || !count) return null;
  if (typeof range.min === 'number' && count < range.min) return false;
  if (typeof range.max === 'number' && count > range.max) return false;
  return true;
}

function matchesSelectedSeniorities(lead: any, selected: unknown) {
  const desired = Array.isArray(selected)
    ? selected.map((item) => normalizeText(String(item).replace(/[_-]/g, ' '))).filter(Boolean)
    : [];
  if (desired.length === 0) return null;

  const title = normalizeText(lead?.title || lead?.role || '');
  const seniority = normalizeText(lead?.seniority || '');
  const haystack = `${title} ${seniority}`.trim();
  if (!haystack) return null;

  return desired.some((value) => {
    const keywords = SENIORITY_KEYWORDS[value] || [value];
    return keywords.some((keyword) => haystack.includes(normalizeText(keyword)));
  });
}

function getLeadMissionContext(lead: any) {
  return normalizeText([
    lead?.company,
    lead?.companyName,
    lead?.organization_name,
    lead?.title,
    lead?.role,
    lead?.location,
    lead?.city,
    lead?.country,
    lead?.headline,
    lead?.researchReport?.company?.industry,
    lead?.researchReport?.cross?.company?.industry,
    lead?.researchReport?.cross?.overview,
    lead?.researchReport?.websiteSummary?.overview,
    lead?.research?.company?.industry,
    lead?.research?.cross?.company?.industry,
    lead?.research?.overview,
    lead?.research?.summary,
    lead?.research?.cross?.overview,
    lead?.research?.websiteSummary?.overview,
  ].filter(Boolean).join(' '));
}

function getTrustedIndustryEvidence(lead: any) {
  return uniqueTexts([
    lead?.researchReport?.company?.industry,
    lead?.researchReport?.cross?.company?.industry,
    lead?.research?.company?.industry,
    lead?.research?.cross?.company?.industry,
    lead?.organization_industry,
    lead?.organizationIndustry,
    lead?.organization?.industry,
    lead?.job_company_industry,
    lead?.companyIndustry,
  ]);
}

function getFallbackIndustryEvidence(lead: any) {
  return uniqueTexts([lead?.industry]);
}

export function resolveAutopilotConfig(config?: Partial<AntoniaConfig> | null): NormalizedAutopilotConfig {
  return {
    autopilotEnabled: Boolean(config?.autopilotEnabled ?? DEFAULT_AUTOPILOT_CONFIG.autopilotEnabled),
    autopilotMode: (config?.autopilotMode as AntoniaAutopilotMode) || DEFAULT_AUTOPILOT_CONFIG.autopilotMode,
    approvalMode: (config?.approvalMode as AntoniaApprovalMode) || DEFAULT_AUTOPILOT_CONFIG.approvalMode,
    minAutoSendScore: clamp(safeNumber(config?.minAutoSendScore, DEFAULT_AUTOPILOT_CONFIG.minAutoSendScore), 0, 100),
    minReviewScore: clamp(safeNumber(config?.minReviewScore, DEFAULT_AUTOPILOT_CONFIG.minReviewScore), 0, 100),
    bookingLink: String(config?.bookingLink || '').trim(),
    meetingInstructions: String(config?.meetingInstructions || '').trim(),
    pauseOnNegativeReply: Boolean(config?.pauseOnNegativeReply ?? DEFAULT_AUTOPILOT_CONFIG.pauseOnNegativeReply),
    pauseOnFailureSpike: Boolean(config?.pauseOnFailureSpike ?? DEFAULT_AUTOPILOT_CONFIG.pauseOnFailureSpike),
  };
}

export function scoreLeadForMission(lead: any, missionParams?: any): LeadScoreResult {
  const reasons: string[] = [];
  let score = 20;

  const title = normalizeText(lead?.title || lead?.role || '');
  const company = normalizeText(lead?.company || lead?.companyName || lead?.organization_name || '');
  const industry = normalizeText(lead?.industry || lead?.organization_industry || '');
  const location = normalizeText(lead?.location || lead?.country || lead?.city || '');
  const jobTitles = parseMissionTerms(missionParams?.jobTitle);
  const missionIndustry = normalizeText(missionParams?.industry || '');
  const missionLocation = normalizeText(missionParams?.location || '');
  const keywords = normalizeText(missionParams?.keywords || '');

  if (title) {
    score += 8;
    reasons.push('cargo detectado');
  }

  if (lead?.email) {
    score += 10;
    reasons.push('email disponible');
  }

  if (lead?.linkedin_url || lead?.linkedinUrl) {
    score += 6;
    reasons.push('linkedin disponible');
  }

  if (jobTitles.length > 0 && title && jobTitles.some((jobTitle) => title.includes(jobTitle) || jobTitle.includes(title))) {
    score += 18;
    reasons.push('match con cargo objetivo');
  }

  if (missionIndustry && industry && (industry.includes(missionIndustry) || missionIndustry.includes(industry))) {
    score += 12;
    reasons.push('match de industria');
  }

  if (missionLocation && location && (location.includes(missionLocation) || missionLocation.includes(location))) {
    score += 10;
    reasons.push('match de ubicacion');
  }

  if (keywords) {
    const keywordList = keywords.split(',').map((item) => item.trim()).filter(Boolean);
    if (includesAny(`${title} ${company} ${industry}`, keywordList)) {
      score += 8;
      reasons.push('match con palabras clave');
    }
  }

  if (includesAny(title, ['ceo', 'cfo', 'coo', 'cto', 'founder', 'owner', 'director general'])) {
    score += 18;
    reasons.push('decision maker c-level');
  } else if (includesAny(title, ['vp', 'head', 'director', 'gerente', 'manager', 'lead'])) {
    score += 12;
    reasons.push('seniority relevante');
  }

  if (includesAny(title, ['hr', 'rrhh', 'human resources', 'people', 'talent', 'operations', 'operaciones', 'finance', 'finanzas'])) {
    score += 10;
    reasons.push('area afin a outsourcing');
  }

  const bounded = clamp(score, 0, 100);
  let tier: LeadScoreTier = 'cold';
  if (bounded >= 80) tier = 'hot';
  else if (bounded >= 60) tier = 'warm';
  else if (bounded >= 40) tier = 'cool';

  return {
    score: bounded,
    tier,
    reason: reasons.slice(0, 4).join(' · ') || 'sin senales suficientes',
  };
}

export function assessLeadMissionFit(lead: any, missionParams?: any): LeadMissionFitAssessment {
  const matchedSignals: string[] = [];
  const blockingSignals: string[] = [];
  const title = normalizeText(lead?.title || lead?.role || '');
  const location = normalizeText(lead?.location || lead?.country || lead?.city || '');
  const missionJobTitles = parseMissionTerms(missionParams?.jobTitle);
  const missionIndustry = normalizeText(missionParams?.industry || '');
  const missionLocation = normalizeText(missionParams?.location || '');
  const context = getLeadMissionContext(lead);

  if (missionJobTitles.length > 0) {
    if (title && missionJobTitles.some((jobTitle) => looselyMatchesText(title, jobTitle))) matchedSignals.push('cargo validado');
    else if (title) blockingSignals.push('cargo fuera del ICP');
  }

  if (missionLocation) {
    if (location && looselyMatchesText(location, missionLocation)) matchedSignals.push('ubicacion validada');
    else if (location) blockingSignals.push('ubicacion fuera del ICP');
  }

  if (missionIndustry) {
    const trustedIndustry = getTrustedIndustryEvidence(lead);
    const fallbackIndustry = getFallbackIndustryEvidence(lead);
    const trustedMatches = trustedIndustry.some((value) => matchesIndustryEvidence(value, missionIndustry));
    const contextMatches = context ? matchesIndustryEvidence(context, missionIndustry) : false;
    const fallbackMatches = fallbackIndustry.some((value) => matchesIndustryEvidence(value, missionIndustry));

    if (trustedIndustry.length > 0) {
      if (trustedMatches) matchedSignals.push('industria validada');
      else blockingSignals.push('industria fuera del ICP');
    } else if (contextMatches) {
      matchedSignals.push('contexto de empresa compatible');
    } else if (fallbackMatches && /\b(logistics|logistica|supply chain|freight|transport|shipping|cargo)\b/i.test(String(lead?.company || lead?.companyName || ''))) {
      matchedSignals.push('industria inferida por nombre de empresa');
    } else {
      blockingSignals.push('industria no verificada');
    }
  }

  const seniorityMatch = matchesSelectedSeniorities(lead, missionParams?.seniorities);
  if (seniorityMatch === true) matchedSignals.push('seniority validado');
  if (seniorityMatch === false) blockingSignals.push('seniority fuera del ICP');

  const companySizeMatch = matchesMissionCompanySize(lead, missionParams?.companySize);
  if (companySizeMatch === true) matchedSignals.push('tamano de empresa validado');
  if (companySizeMatch === false) blockingSignals.push('tamano de empresa fuera del ICP');

  return {
    action: blockingSignals.length > 0 ? 'block' : 'allow',
    reason: blockingSignals[0] || matchedSignals[0] || 'sin restricciones explicitas de ICP',
    matchedSignals,
    blockingSignals,
  };
}

function isHighRiskLead(lead: any, config: NormalizedAutopilotConfig) {
  const score = safeNumber(lead?.score, 0);
  const missingIdentity = !String(lead?.title || '').trim() || !String(lead?.company || lead?.companyName || '').trim();
  const missingLinkedin = !String(lead?.linkedin_url || lead?.linkedinUrl || '').trim();
  return score < config.minAutoSendScore || missingIdentity || missingLinkedin;
}

export function decideAutopilotContactAction(params: {
  config?: Partial<AntoniaConfig> | null;
  lead: any;
}): AutopilotContactDecision {
  const config = resolveAutopilotConfig(params.config);
  const lead = params.lead || {};
  const score = safeNumber(lead?.score, 0);

  if (!lead?.email) {
    return {
      action: 'skip',
      reason: 'lead sin email verificable',
      severity: 'medium',
    };
  }

  if (!config.autopilotEnabled) {
    return {
      action: 'send',
      reason: 'autopilot avanzado desactivado, usando flujo actual',
      severity: 'low',
    };
  }

  if (config.approvalMode === 'all_contacts') {
    return {
      action: 'review',
      reason: 'politica requiere aprobacion para todo contacto',
      severity: 'medium',
    };
  }

  if (config.autopilotMode === 'manual_assist') {
    return {
      action: 'review',
      reason: 'modo manual assist: ANTONIA prepara, humano aprueba',
      severity: 'medium',
    };
  }

  const highRiskLead = isHighRiskLead(lead, config);

  if (config.approvalMode === 'high_risk_only' && highRiskLead) {
    return {
      action: 'review',
      reason: 'lead de alto riesgo para envio automatico',
      severity: 'high',
    };
  }

  if (config.autopilotMode === 'semi_auto') {
    if (score < config.minAutoSendScore) {
      return {
        action: 'review',
        reason: 'score por debajo del umbral de autoenvio',
        severity: score < config.minReviewScore ? 'high' : 'medium',
      };
    }
    return {
      action: 'send',
      reason: 'score suficiente para semi auto',
      severity: 'low',
    };
  }

  if (score < config.minReviewScore) {
    return {
      action: 'skip',
      reason: 'score demasiado bajo para full auto',
      severity: 'high',
    };
  }

  if (config.approvalMode === 'low_score_only' && score < config.minAutoSendScore) {
    return {
      action: 'review',
      reason: 'lead aprovechable pero requiere revision humana',
      severity: 'medium',
    };
  }

  return {
    action: 'send',
    reason: 'full auto autorizado por score y guardrails',
    severity: 'low',
  };
}

export function scoreTierLabel(tier: LeadScoreTier) {
  switch (tier) {
    case 'hot':
      return 'Hot';
    case 'warm':
      return 'Warm';
    case 'cool':
      return 'Cool';
    default:
      return 'Cold';
  }
}

export function autopilotModeLabel(mode: AntoniaAutopilotMode) {
  switch (mode) {
    case 'manual_assist':
      return 'Manual Assist';
    case 'semi_auto':
      return 'Semi Auto';
    case 'full_auto':
      return 'Full Auto';
    default:
      return mode;
  }
}

export function approvalModeLabel(mode: AntoniaApprovalMode) {
  switch (mode) {
    case 'all_contacts':
      return 'Aprobar todos';
    case 'low_score_only':
      return 'Solo score bajo';
    case 'high_risk_only':
      return 'Solo alto riesgo';
    case 'disabled':
      return 'Sin aprobacion';
    default:
      return mode;
  }
}

export function buildSuggestedMeetingReply(params: {
  leadName?: string | null;
  companyName?: string | null;
  bookingLink?: string | null;
  meetingInstructions?: string | null;
}) {
  const firstName = String(params.leadName || '').trim().split(' ')[0] || 'Hola';
  const companyName = String(params.companyName || '').trim();
  const bookingLink = String(params.bookingLink || '').trim();
  const meetingInstructions = String(params.meetingInstructions || '').trim();

  const lines = [
    `${firstName}, gracias por responder.`,
    companyName ? `Me encantaria avanzar una conversacion sobre ${companyName}.` : 'Me encantaria avanzar una conversacion breve.',
  ];

  if (bookingLink) {
    lines.push(`Si te acomoda, puedes tomar un horario aqui: ${bookingLink}`);
  } else {
    lines.push('Si te parece, comparteme 2 o 3 horarios y coordinamos la reunion.');
  }

  if (meetingInstructions) {
    lines.push(meetingInstructions);
  }

  lines.push('Quedo atento.');
  return lines.join('\n\n');
}
