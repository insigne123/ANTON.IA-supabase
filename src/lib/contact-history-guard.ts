import type { ContactedLead } from '@/lib/types';

type ContactHistoryLike = Partial<ContactedLead> & {
  lead_id?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  linkedinUrl?: string | null;
  last_reply_text?: string | null;
  replied_at?: string | null;
  reply_intent?: string | null;
  delivery_status?: string | null;
  bounce_category?: string | null;
  bounce_reason?: string | null;
  evaluation_status?: string | null;
  campaign_followup_reason?: string | null;
};

type CandidateLike = {
  id?: string | null;
  leadId?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  linkedin_url?: string | null;
};

const REPLY_INTENTS = new Set([
  'meeting_request',
  'positive',
  'negative',
  'unsubscribe',
  'auto_reply',
  'neutral',
  'delivery_failure',
]);

const OPT_OUT_REASONS = new Set([
  'unsubscribe',
  'unsubscribed',
  'opt_out',
  'opt-out',
]);

const TEMPORARY_DELIVERY_REASONS = new Set([
  'mailbox_full',
  'policy_block',
  'temporary_failure',
]);

const PERMANENT_DELIVERY_REASONS = new Set([
  'left_company',
  'mailbox_not_found',
  'domain_error',
]);

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function hasExplicitOptOutText(history: ContactHistoryLike) {
  const text = String(history.lastReplyText || history.last_reply_text || '').trim();
  return /\b(?:do\s+not\s+contact|stop\s+(?:emailing|contacting)|remove\s+me|no\s+(?:contactarme|me\s+(?:contacten|escriban)|nos\s+contacten)|dar(?:me|te|se)\s+de\s+baja)\b/i.test(text);
}

function normalizeLinkedin(value: unknown) {
  return normalize(value)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

export function hasLeadReplied(history: ContactHistoryLike) {
  const deliveryStatus = normalize(history.deliveryStatus || history.delivery_status);
  return Boolean(
    history.repliedAt ||
    history.replied_at ||
    history.status === 'replied' ||
    REPLY_INTENTS.has(normalize(history.replyIntent || history.reply_intent)) ||
    deliveryStatus === 'bounced' ||
    deliveryStatus === 'soft_bounced' ||
    String(history.lastReplyText || history.last_reply_text || '').trim()
  );
}

export function shouldPermanentlySuppressContact(history: ContactHistoryLike) {
  const intent = normalize(history.replyIntent || history.reply_intent);
  const followupReason = normalize(history.campaignFollowupReason || history.campaign_followup_reason);

  if (intent === 'unsubscribe' || OPT_OUT_REASONS.has(followupReason) || hasExplicitOptOutText(history)) return true;

  const evaluationStatus = normalize(history.evaluationStatus || history.evaluation_status);
  const deliveryStatus = normalize(history.deliveryStatus || history.delivery_status);
  const bounceCategory = normalize(history.bounceCategory || history.bounce_category);
  const deliveryReason = bounceCategory || followupReason;
  const isDeliveryFailure = intent === 'delivery_failure' ||
    deliveryStatus === 'bounced' ||
    deliveryStatus === 'soft_bounced' ||
    Boolean(bounceCategory);

  if (!isDeliveryFailure) return false;

  if (
    evaluationStatus === 'action_required' ||
    deliveryStatus === 'soft_bounced' ||
    TEMPORARY_DELIVERY_REASONS.has(deliveryReason)
  ) {
    return false;
  }

  return evaluationStatus === 'do_not_contact' ||
    deliveryStatus === 'bounced' ||
    PERMANENT_DELIVERY_REASONS.has(deliveryReason);
}

export function findPriorReplyMatch(candidate: CandidateLike, historyRows: ContactHistoryLike[]) {
  const candidateLeadId = normalize(candidate.leadId || candidate.id);
  const candidateEmail = normalize(candidate.email);
  const candidateLinkedin = normalizeLinkedin(candidate.linkedinUrl || candidate.linkedin_url);

  for (const row of historyRows || []) {
    if (!hasLeadReplied(row)) continue;

    const rowLeadId = normalize(row.leadId || row.lead_id);
    const rowEmail = normalize(row.email);
    const rowLinkedin = normalizeLinkedin(row.linkedinUrl || row.linkedin_url);

    if (candidateLeadId && rowLeadId && candidateLeadId === rowLeadId) return row;
    if (candidateEmail && rowEmail && candidateEmail === rowEmail) return row;
    if (candidateLinkedin && rowLinkedin && candidateLinkedin === rowLinkedin) return row;
  }

  return null;
}
