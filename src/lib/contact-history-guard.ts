import type { ContactedLead } from '@/lib/types';

type ContactHistoryLike = Partial<ContactedLead> & {
  lead_id?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  linkedinUrl?: string | null;
  last_reply_text?: string | null;
  replied_at?: string | null;
  reply_intent?: string | null;
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

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLinkedin(value: unknown) {
  return normalize(value)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

export function hasLeadReplied(history: ContactHistoryLike) {
  return Boolean(
    history.repliedAt ||
    history.replied_at ||
    history.status === 'replied' ||
    REPLY_INTENTS.has(normalize(history.replyIntent || history.reply_intent)) ||
    String(history.lastReplyText || history.last_reply_text || '').trim()
  );
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
