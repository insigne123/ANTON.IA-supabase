import type { ContactedLead } from '@/lib/types';
import { getBestDeliveryStatus, isFailedDeliverability } from '@/lib/delivery-failure-detector';
import { hasLeadReplied } from '@/lib/contact-history-guard';

export type CampaignType = 'reconnection' | 'follow_up';
export type CampaignRunStatus = 'idle' | 'success' | 'partial' | 'failed' | 'skipped';

export type CampaignReactivationSettings = {
  minDaysSinceLastContact: number;
  requireDeliveryEvidence: boolean;
  includeOpenedNoReply: boolean;
  includeClickedNoReply: boolean;
  includeDeliveredNoOpen: boolean;
  includeNeutralReplies: boolean;
  includeNoSignal: boolean;
  excludeFailedDeliveries: boolean;
  excludeDoNotContact: boolean;
};

export type CampaignAudienceSettings = {
  kind: 'reactivation';
  reactivation: CampaignReactivationSettings;
};

export type CampaignSmartSchedulingSettings = {
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
};

export type CampaignTrackingSettings = {
  enabled: boolean;
  pixel: boolean;
  linkTracking: boolean;
};

export type CampaignReconnectionBrief = {
  offerName: string;
  offerSummary: string;
  audienceHint: string;
  valuePoints: string[];
  cta: string;
  tone: string;
};

export type CampaignReconnectionSettings = {
  enabled: boolean;
  autoResearchOnSend: boolean;
  personalizeWithAi: boolean;
  brief: CampaignReconnectionBrief;
};

export type CampaignSettings = {
  smartScheduling: CampaignSmartSchedulingSettings;
  tracking: CampaignTrackingSettings;
  audience?: CampaignAudienceSettings;
  reconnection: CampaignReconnectionSettings;
};

export type ReactivationSegment =
  | 'neutral_reply'
  | 'clicked_no_reply'
  | 'opened_no_reply'
  | 'delivered_no_open'
  | 'no_signal';

export type ReactivationEvaluation = {
  matched: boolean;
  segment: ReactivationSegment | null;
  primaryLabel: string | null;
  labels: string[];
  daysSinceLastContact: number;
  lastContactAt: string | null;
  hasDeliveryEvidence: boolean;
  hasFailedDelivery: boolean;
  isDoNotContact: boolean;
};

export const defaultCampaignReactivationSettings: CampaignReactivationSettings = {
  minDaysSinceLastContact: 30,
  requireDeliveryEvidence: true,
  includeOpenedNoReply: true,
  includeClickedNoReply: true,
  includeDeliveredNoOpen: false,
  includeNeutralReplies: false,
  includeNoSignal: false,
  excludeFailedDeliveries: true,
  excludeDoNotContact: true,
};

const defaultSmartSchedulingSettings: CampaignSmartSchedulingSettings = {
  enabled: false,
  timezone: 'UTC',
  startHour: 9,
  endHour: 17,
};

const defaultTrackingSettings: CampaignTrackingSettings = {
  enabled: false,
  pixel: true,
  linkTracking: true,
};

export const defaultCampaignReconnectionSettings: CampaignReconnectionSettings = {
  enabled: false,
  autoResearchOnSend: true,
  personalizeWithAi: true,
  brief: {
    offerName: '',
    offerSummary: '',
    audienceHint: '',
    valuePoints: [],
    cta: 'Abramos una llamada corta esta semana.',
    tone: 'consultivo y directo',
  },
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function diffDays(now: Date, previous: Date) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((now.getTime() - previous.getTime()) / MS_PER_DAY);
}

export function createDefaultCampaignSettings(options?: { withReactivationAudience?: boolean; campaignType?: CampaignType }): CampaignSettings {
  const campaignType = options?.campaignType || (options?.withReactivationAudience ? 'reconnection' : 'follow_up');
  return {
    smartScheduling: { ...defaultSmartSchedulingSettings },
    tracking: { ...defaultTrackingSettings },
    reconnection: {
      ...defaultCampaignReconnectionSettings,
      enabled: campaignType === 'reconnection',
      brief: { ...defaultCampaignReconnectionSettings.brief },
    },
    audience: options?.withReactivationAudience
      ? {
        kind: 'reactivation',
        reactivation: { ...defaultCampaignReactivationSettings },
      }
      : undefined,
  };
}

export function inferCampaignType(input?: { campaignType?: unknown; settings?: any } | null): CampaignType {
  const rawType = String(input?.campaignType || '').trim().toLowerCase();
  if (rawType === 'reconnection' || rawType === 'follow_up') {
    return rawType;
  }

  const settings = input?.settings;
  if (settings?.audience?.kind === 'reactivation') return 'reconnection';
  if (settings?.reconnection?.enabled) return 'reconnection';
  return 'follow_up';
}

export function normalizeCampaignSettings(raw: any): CampaignSettings {
  const base = raw && typeof raw === 'object' ? { ...raw } : {};
  const smartScheduling = {
    enabled: toBoolean(raw?.smartScheduling?.enabled, defaultSmartSchedulingSettings.enabled),
    timezone: String(raw?.smartScheduling?.timezone || defaultSmartSchedulingSettings.timezone),
    startHour: clampNumber(raw?.smartScheduling?.startHour, defaultSmartSchedulingSettings.startHour, 0, 23),
    endHour: clampNumber(raw?.smartScheduling?.endHour, defaultSmartSchedulingSettings.endHour, 0, 23),
  };

  const tracking = {
    enabled: toBoolean(raw?.tracking?.enabled, defaultTrackingSettings.enabled),
    pixel: toBoolean(raw?.tracking?.pixel, defaultTrackingSettings.pixel),
    linkTracking: toBoolean(raw?.tracking?.linkTracking, defaultTrackingSettings.linkTracking),
  };

  const reconnection = {
    enabled: toBoolean(raw?.reconnection?.enabled, defaultCampaignReconnectionSettings.enabled),
    autoResearchOnSend: toBoolean(raw?.reconnection?.autoResearchOnSend, defaultCampaignReconnectionSettings.autoResearchOnSend),
    personalizeWithAi: toBoolean(raw?.reconnection?.personalizeWithAi, defaultCampaignReconnectionSettings.personalizeWithAi),
    brief: {
      offerName: String(raw?.reconnection?.brief?.offerName || defaultCampaignReconnectionSettings.brief.offerName),
      offerSummary: String(raw?.reconnection?.brief?.offerSummary || defaultCampaignReconnectionSettings.brief.offerSummary),
      audienceHint: String(raw?.reconnection?.brief?.audienceHint || defaultCampaignReconnectionSettings.brief.audienceHint),
      valuePoints: Array.isArray(raw?.reconnection?.brief?.valuePoints)
        ? raw.reconnection.brief.valuePoints.map((value: unknown) => String(value || '').trim()).filter(Boolean)
        : [...defaultCampaignReconnectionSettings.brief.valuePoints],
      cta: String(raw?.reconnection?.brief?.cta || defaultCampaignReconnectionSettings.brief.cta),
      tone: String(raw?.reconnection?.brief?.tone || defaultCampaignReconnectionSettings.brief.tone),
    },
  };

  const settings = {
    ...base,
    smartScheduling,
    tracking,
    reconnection,
  } as CampaignSettings;

  delete (settings as any).audience;

  if (raw?.audience?.kind === 'reactivation') {
    settings.audience = {
      kind: 'reactivation',
      reactivation: {
        minDaysSinceLastContact: clampNumber(
          raw?.audience?.reactivation?.minDaysSinceLastContact,
          defaultCampaignReactivationSettings.minDaysSinceLastContact,
          0,
          3650,
        ),
        requireDeliveryEvidence: toBoolean(
          raw?.audience?.reactivation?.requireDeliveryEvidence,
          defaultCampaignReactivationSettings.requireDeliveryEvidence,
        ),
        includeOpenedNoReply: toBoolean(
          raw?.audience?.reactivation?.includeOpenedNoReply,
          defaultCampaignReactivationSettings.includeOpenedNoReply,
        ),
        includeClickedNoReply: toBoolean(
          raw?.audience?.reactivation?.includeClickedNoReply,
          defaultCampaignReactivationSettings.includeClickedNoReply,
        ),
        includeDeliveredNoOpen: toBoolean(
          raw?.audience?.reactivation?.includeDeliveredNoOpen,
          defaultCampaignReactivationSettings.includeDeliveredNoOpen,
        ),
        includeNeutralReplies: toBoolean(
          raw?.audience?.reactivation?.includeNeutralReplies,
          defaultCampaignReactivationSettings.includeNeutralReplies,
        ),
        includeNoSignal: toBoolean(
          raw?.audience?.reactivation?.includeNoSignal,
          defaultCampaignReactivationSettings.includeNoSignal,
        ),
        excludeFailedDeliveries: toBoolean(
          raw?.audience?.reactivation?.excludeFailedDeliveries,
          defaultCampaignReactivationSettings.excludeFailedDeliveries,
        ),
        excludeDoNotContact: toBoolean(
          raw?.audience?.reactivation?.excludeDoNotContact,
          defaultCampaignReactivationSettings.excludeDoNotContact,
        ),
      },
    };
  }

  return settings;
}

export function getLeadLastContactAt(lead: Partial<ContactedLead>) {
  const candidates = [
    lead.lastInteractionAt,
    lead.lastFollowUpAt,
    lead.repliedAt,
    lead.clickedAt,
    lead.openedAt,
    lead.deliveredAt,
    lead.sentAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}

export function evaluateLeadForReactivation(
  lead: Partial<ContactedLead>,
  settings: CampaignReactivationSettings,
  now: Date = new Date(),
): ReactivationEvaluation {
  const lastContactAt = getLeadLastContactAt(lead);
  const lastContactDate = lastContactAt ? new Date(lastContactAt) : null;
  const daysSinceLastContact = lastContactDate ? diffDays(now, lastContactDate) : 0;
  const hasReply = Boolean(lead.repliedAt || lead.status === 'replied');
  const hasAnyReplyHistory = hasLeadReplied(lead);
  const hasOpen = Boolean(lead.openedAt || lead.status === 'opened');
  const hasClick = Boolean(lead.clickedAt || Number(lead.clickCount || 0) > 0);
  const resolvedDeliveryStatus = getBestDeliveryStatus(lead);
  const hasDeliveryEvidence = Boolean(
    resolvedDeliveryStatus === 'delivered' ||
    resolvedDeliveryStatus === 'opened' ||
    resolvedDeliveryStatus === 'clicked' ||
    resolvedDeliveryStatus === 'replied' ||
    lead.deliveredAt ||
    lead.deliveryReceiptMessageId ||
    lead.readReceiptMessageId ||
    hasOpen ||
    hasClick ||
    hasReply,
  );
  const hasFailedDelivery = isFailedDeliverability(lead);
  const isNegativeIntent = lead.replyIntent === 'negative' || lead.replyIntent === 'unsubscribe' || lead.replyIntent === 'delivery_failure';
  const isDoNotContact = Boolean(
    lead.evaluationStatus === 'do_not_contact' ||
    lead.campaignFollowupAllowed === false ||
    isNegativeIntent,
  );

  if (hasAnyReplyHistory) {
    return {
      matched: false,
      segment: null,
      primaryLabel: null,
      labels: [],
      daysSinceLastContact,
      lastContactAt,
      hasDeliveryEvidence,
      hasFailedDelivery,
      isDoNotContact,
    };
  }

  if (settings.excludeFailedDeliveries && hasFailedDelivery) {
    return {
      matched: false,
      segment: null,
      primaryLabel: null,
      labels: [],
      daysSinceLastContact,
      lastContactAt,
      hasDeliveryEvidence,
      hasFailedDelivery,
      isDoNotContact,
    };
  }

  if (settings.excludeDoNotContact && isDoNotContact) {
    return {
      matched: false,
      segment: null,
      primaryLabel: null,
      labels: [],
      daysSinceLastContact,
      lastContactAt,
      hasDeliveryEvidence,
      hasFailedDelivery,
      isDoNotContact,
    };
  }

  if (daysSinceLastContact < settings.minDaysSinceLastContact) {
    return {
      matched: false,
      segment: null,
      primaryLabel: null,
      labels: [],
      daysSinceLastContact,
      lastContactAt,
      hasDeliveryEvidence,
      hasFailedDelivery,
      isDoNotContact,
    };
  }

  if (settings.requireDeliveryEvidence && !hasDeliveryEvidence) {
    return {
      matched: false,
      segment: null,
      primaryLabel: null,
      labels: [],
      daysSinceLastContact,
      lastContactAt,
      hasDeliveryEvidence,
      hasFailedDelivery,
      isDoNotContact,
    };
  }

  const neutralReply =
    hasReply &&
    (lead.replyIntent === 'neutral' || lead.replyIntent === 'auto_reply') &&
    lead.campaignFollowupAllowed !== false;

  const candidates: Array<{ segment: ReactivationSegment; label: string }> = [];

  if (neutralReply && settings.includeNeutralReplies) {
    candidates.push({ segment: 'neutral_reply', label: 'Respondio sin cerrar la conversacion' });
  }

  if (!hasReply && hasClick && settings.includeClickedNoReply) {
    candidates.push({ segment: 'clicked_no_reply', label: 'Hizo click pero no respondio' });
  }

  if (!hasReply && hasOpen && settings.includeOpenedNoReply) {
    candidates.push({ segment: 'opened_no_reply', label: 'Abrio el correo pero no respondio' });
  }

  if (!hasReply && hasDeliveryEvidence && !hasOpen && !hasClick && settings.includeDeliveredNoOpen) {
    candidates.push({ segment: 'delivered_no_open', label: 'El correo anterior se entrego' });
  }

  if (!hasReply && !hasDeliveryEvidence && settings.includeNoSignal) {
    candidates.push({ segment: 'no_signal', label: 'No hay senales de entrega ni engagement' });
  }

  const primary = candidates[0];

  return {
    matched: Boolean(primary),
    segment: primary?.segment || null,
    primaryLabel: primary?.label || null,
    labels: candidates.map((candidate) => candidate.label),
    daysSinceLastContact,
    lastContactAt,
    hasDeliveryEvidence,
    hasFailedDelivery,
    isDoNotContact,
  };
}
