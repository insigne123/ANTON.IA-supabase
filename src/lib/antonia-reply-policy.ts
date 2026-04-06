import type { ReplyClassification } from '@/lib/reply-classifier';
import type { AntoniaConfig } from '@/lib/types';

export type AntoniaReplyAutopilotMode = 'draft_only' | 'shadow_mode' | 'auto_safe' | 'full_auto';
export type AntoniaReplyApprovalMode = 'all_replies' | 'high_risk_only' | 'disabled';
export type AntoniaReplyDecisionAction = 'send' | 'draft' | 'review' | 'stop';

export type NormalizedReplyAutopilotConfig = {
  enabled: boolean;
  mode: AntoniaReplyAutopilotMode;
  approvalMode: AntoniaReplyApprovalMode;
  maxAutoTurns: number;
  autoSendBookingReplies: boolean;
  allowReplyAttachments: boolean;
  bookingLink: string;
  meetingInstructions: string;
};

export type ReplyRiskFlags = {
  lowConfidence: boolean;
  exceededTurnLimit: boolean;
  asksPricing: boolean;
  asksSecurity: boolean;
  asksLegal: boolean;
  asksIntegration: boolean;
  asksProcurement: boolean;
  asksAttachments: boolean;
  asksCustomPlan: boolean;
  ambiguousIntent: boolean;
};

export type AutonomousReplyDecision = {
  action: AntoniaReplyDecisionAction;
  recommendedAction: AntoniaReplyDecisionAction;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  riskFlags: ReplyRiskFlags;
  autoSendAllowed: boolean;
  shouldGenerateDraft: boolean;
};

const DEFAULT_REPLY_CONFIG: NormalizedReplyAutopilotConfig = {
  enabled: false,
  mode: 'draft_only',
  approvalMode: 'high_risk_only',
  maxAutoTurns: 2,
  autoSendBookingReplies: false,
  allowReplyAttachments: false,
  bookingLink: '',
  meetingInstructions: '',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function resolveReplyAutopilotConfig(config?: Partial<AntoniaConfig> | null): NormalizedReplyAutopilotConfig {
  const mode = String(config?.replyAutopilotMode || DEFAULT_REPLY_CONFIG.mode) as AntoniaReplyAutopilotMode;
  const approvalMode = String(config?.replyApprovalMode || DEFAULT_REPLY_CONFIG.approvalMode) as AntoniaReplyApprovalMode;
  return {
    enabled: Boolean(config?.replyAutopilotEnabled ?? DEFAULT_REPLY_CONFIG.enabled),
    mode: ['draft_only', 'shadow_mode', 'auto_safe', 'full_auto'].includes(mode) ? mode : DEFAULT_REPLY_CONFIG.mode,
    approvalMode: ['all_replies', 'high_risk_only', 'disabled'].includes(approvalMode) ? approvalMode : DEFAULT_REPLY_CONFIG.approvalMode,
    maxAutoTurns: clamp(safeNumber(config?.replyMaxAutoTurns, DEFAULT_REPLY_CONFIG.maxAutoTurns), 1, 10),
    autoSendBookingReplies: Boolean(config?.autoSendBookingReplies ?? DEFAULT_REPLY_CONFIG.autoSendBookingReplies),
    allowReplyAttachments: Boolean(config?.allowReplyAttachments ?? DEFAULT_REPLY_CONFIG.allowReplyAttachments),
    bookingLink: String(config?.bookingLink || DEFAULT_REPLY_CONFIG.bookingLink).trim(),
    meetingInstructions: String(config?.meetingInstructions || DEFAULT_REPLY_CONFIG.meetingInstructions).trim(),
  };
}

export function detectReplyRiskFlags(params: {
  classification: Pick<ReplyClassification, 'intent' | 'confidence'>;
  rawReply: string;
  turnCount?: number;
  maxAutoTurns?: number;
}): ReplyRiskFlags {
  const text = normalizeText(params.rawReply);
  const turnCount = safeNumber(params.turnCount, 0);
  const maxAutoTurns = safeNumber(params.maxAutoTurns, DEFAULT_REPLY_CONFIG.maxAutoTurns);

  return {
    lowConfidence: Number(params.classification.confidence || 0) < 0.72,
    exceededTurnLimit: turnCount >= maxAutoTurns,
    asksPricing: hasPattern(text, [/(precio|pricing|cost|costo|tarifa|cotizacion|presupuesto)/i]),
    asksSecurity: hasPattern(text, [/(\bseguridad\b|\bsecurity\b|\biso\s*27001\b|\bsoc\s*2\b|\bcompliance\b|\bcumplimiento\b|\bdatos\b|\bprivacy\b|\bprivacidad\b)/i]),
    asksLegal: hasPattern(text, [/(\bcontrato\b|\bnda\b|\blegal\b|\bjuridic\w*\b|\bterms\b|\bterminos\b|\bcondiciones\b)/i]),
    asksIntegration: hasPattern(text, [/(\bintegracion\b|\bintegration\b|\bapi\b|\bwebhook\b|\bcrm\b|\berp\b|\bsap\b|\bsalesforce\b|\bhubspot\b)/i]),
    asksProcurement: hasPattern(text, [/(procurement|compra|compras|licitacion|vendor|proveedor homologado)/i]),
    asksAttachments: hasPattern(text, [/(brochure|broshure|brochure|presentacion|deck|pdf|caso de exito|one pager|adjunt)/i]),
    asksCustomPlan: hasPattern(text, [/(custom|a medida|personalizado|implementacion|alcance exacto|proposal|propuesta formal)/i]),
    ambiguousIntent: params.classification.intent === 'unknown' || params.classification.intent === 'neutral',
  };
}

function hasHighRiskFlags(flags: ReplyRiskFlags) {
  return flags.lowConfidence
    || flags.exceededTurnLimit
    || flags.asksPricing
    || flags.asksSecurity
    || flags.asksLegal
    || flags.asksIntegration
    || flags.asksProcurement
    || flags.asksCustomPlan;
}

function mapActionForMode(action: AntoniaReplyDecisionAction, mode: AntoniaReplyAutopilotMode) {
  if (action === 'send' && (mode === 'draft_only' || mode === 'shadow_mode')) {
    return 'draft' as const;
  }
  return action;
}

export function decideAutonomousReplyAction(params: {
  config?: Partial<AntoniaConfig> | null;
  classification: Pick<ReplyClassification, 'intent' | 'confidence'>;
  rawReply: string;
  turnCount?: number;
}): AutonomousReplyDecision {
  const config = resolveReplyAutopilotConfig(params.config);
  const flags = detectReplyRiskFlags({ ...params, maxAutoTurns: config.maxAutoTurns });
  const classification = params.classification;

  if (classification.intent === 'negative' || classification.intent === 'unsubscribe' || classification.intent === 'delivery_failure') {
    return {
      action: 'stop',
      recommendedAction: 'stop',
      severity: 'critical',
      reason: 'reply incompatible con automatizacion comercial',
      riskFlags: flags,
      autoSendAllowed: false,
      shouldGenerateDraft: false,
    };
  }

  if (classification.intent === 'auto_reply') {
    return {
      action: 'draft',
      recommendedAction: 'draft',
      severity: 'low',
      reason: 'auto-reply detectado; esperar nueva senal humana',
      riskFlags: flags,
      autoSendAllowed: false,
      shouldGenerateDraft: false,
    };
  }

  if (!config.enabled) {
    return {
      action: 'draft',
      recommendedAction: 'draft',
      severity: 'medium',
      reason: 'reply autopilot desactivado; generar borrador solamente',
      riskFlags: flags,
      autoSendAllowed: false,
      shouldGenerateDraft: true,
    };
  }

  if (config.approvalMode === 'all_replies') {
    return {
      action: 'review',
      recommendedAction: 'review',
      severity: 'medium',
      reason: 'politica exige aprobacion humana para toda respuesta',
      riskFlags: flags,
      autoSendAllowed: false,
      shouldGenerateDraft: true,
    };
  }

  const highRisk = hasHighRiskFlags(flags);
  if (config.approvalMode === 'high_risk_only' && highRisk) {
    return {
      action: 'review',
      recommendedAction: 'review',
      severity: flags.asksSecurity || flags.asksLegal || flags.asksPricing ? 'high' : 'medium',
      reason: 'reply con riesgo alto o fuera del scope seguro',
      riskFlags: flags,
      autoSendAllowed: false,
      shouldGenerateDraft: true,
    };
  }

  let recommendedAction: AntoniaReplyDecisionAction = 'draft';
  let severity: AutonomousReplyDecision['severity'] = 'low';
  let reason = 'reply apto para borrador asistido';

  if (classification.intent === 'meeting_request') {
    recommendedAction = config.autoSendBookingReplies && config.bookingLink ? 'send' : 'draft';
    reason = recommendedAction === 'send'
      ? 'lead solicito reunion y hay CTA de booking disponible'
      : 'lead solicito reunion, pero falta CTA o politica de autoenvio';
  } else if (classification.intent === 'positive') {
    if (config.mode === 'full_auto' && !flags.asksAttachments && !flags.ambiguousIntent) {
      recommendedAction = 'send';
      reason = 'reply positivo con bajo riesgo, apto para respuesta automatica';
    } else if (config.mode === 'auto_safe' && !flags.asksAttachments && !flags.ambiguousIntent && classification.confidence >= 0.85) {
      recommendedAction = 'send';
      reason = 'reply positivo claro bajo politica auto_safe';
    } else {
      recommendedAction = 'draft';
      reason = 'reply positivo pero requiere confirmacion o borrador';
    }
  } else if (classification.intent === 'neutral') {
    if (config.mode === 'full_auto' && !flags.ambiguousIntent && !highRisk) {
      recommendedAction = 'send';
      reason = 'reply neutral simple dentro del scope permitido';
    } else {
      recommendedAction = 'review';
      severity = 'medium';
      reason = 'reply neutral o ambiguo; conviene revisar antes de responder';
    }
  } else {
    recommendedAction = 'review';
    severity = 'medium';
    reason = 'intent incierto para autonomia total';
  }

  const action = mapActionForMode(recommendedAction, config.mode);
  const autoSendAllowed = action === 'send';
  const shouldGenerateDraft = action !== 'stop';

  if (config.mode === 'shadow_mode' && recommendedAction === 'send') {
    reason = `${reason}; shadow mode evita enviar y deja borrador para comparacion`;
  }

  return {
    action,
    recommendedAction,
    severity,
    reason,
    riskFlags: flags,
    autoSendAllowed,
    shouldGenerateDraft,
  };
}
