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
  const jobTitle = normalizeText(missionParams?.jobTitle || '');
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

  if (jobTitle && title && (title.includes(jobTitle) || jobTitle.includes(title))) {
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
