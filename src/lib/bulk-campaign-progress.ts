import { DELIVERY_STATE_COPY, nextCampaignMessage, type BulkCampaign, type CampaignDelivery, type CampaignRecipient } from '@/lib/bulk-campaigns';
import { describeCampaignFailure, type CampaignAttempt } from '@/lib/bulk-campaign-attempts';

/**
 * Where each person of a launched campaign stands, in one badge and one line (9 Nov 2026 review). The status view said
 * «Requiere atención» without the reason, dates read «10-11-2026, 2:32:16 p. m.», an answer did not show, and a send Outlook
 * confirms later read as a problem.
 */
export type RecipientTone = 'replied' | 'done' | 'scheduled' | 'ready' | 'sending' | 'confirming' | 'retrying' | 'attention' | 'failed';

export type RecipientProgress = {
  tone: RecipientTone;
  /** The badge: two or three words. */
  label: string;
  /** One line: why, or what comes next. */
  detail: string | null;
  /** When the next thing happens: the due date of the next e-mail or the next check. */
  at: string | null;
  /** E-mails confirmed sent, of all the person's e-mails. */
  sent: number;
  total: number;
  /** The e-mail «Volver a comprobar» can release: a temporary hold of an e-mail that is due. */
  retryDraftId: string | null;
};

const stepName = (index: number) => (index === 0 ? 'Correo inicial' : `Seguimiento ${index}`);
/** Holds that end on their own at a set time: checking again by hand does not bring the send forward. */
const WAITS_FOR_TIME = new Set(['daily_quota_exceeded', 'BULK_CAMPAIGN_COMPANY_DAY_COLLISION', 'BULK_CAMPAIGN_ACCOUNT_NEGOTIATION', 'BULK_CAMPAIGN_NOT_DUE']);

export function recipientProgress(input: {
  recipient: CampaignRecipient;
  deliveries: CampaignDelivery[];
  attempts: CampaignAttempt[];
  approvedAt: string;
  replied: boolean;
  automation: boolean;
  /** A paused campaign sends nothing: what is due waits for it to resume. */
  paused?: boolean;
  now?: number;
}): RecipientProgress {
  const { recipient, deliveries, attempts } = input;
  const total = recipient.messages.length;
  const sent = recipient.messages.filter(message => deliveries.some(row => row.draft_id === message.draftId && row.status === 'sent')).length;
  const base = { sent, total, at: null, retryDraftId: null };
  const next = nextCampaignMessage(recipient, deliveries, input.approvedAt, input.now);
  // An answer stops the follow-ups (the dispatch guard and the worker hold them), so it is the person's state from then on.
  if (input.replied) return { ...base, tone: 'replied', label: 'Respondió', detail: next ? 'Los seguimientos se detienen.' : null };
  if (!next) return { ...base, tone: 'done', label: 'Secuencia completa', detail: null };
  const step = stepName(next.index);
  const attempt = attempts.find(value => value.draft_id === next.message.draftId && value.state !== 'sent');
  if (next.state === 'unknown') return { ...base, tone: 'confirming', label: 'Por confirmar', detail: `${step}: ${lower(DELIVERY_STATE_COPY.unknown)}` };
  if (next.state === 'sending' || next.state === 'pending') return { ...base, tone: 'sending', label: 'Enviando', detail: step };
  if (next.state === 'failed') return { ...base, tone: 'failed', label: 'No salió', detail: `${step}: ${lower(attempt?.message || DELIVERY_STATE_COPY.failed)}` };
  const retryDraftId = attempt && next.state === 'ready' && describeCampaignFailure(attempt.code).retryable && !WAITS_FOR_TIME.has(attempt.code) ? next.message.draftId : null;
  if (attempt?.state === 'retry_wait') return { ...base, tone: 'retrying', label: 'En espera', detail: `${step}: ${lower(attempt.message)}`, at: attempt.retry_at, retryDraftId };
  if (attempt) return { ...base, tone: 'attention', label: 'Requiere atención', detail: `${step}: ${lower(attempt.message)}`, retryDraftId };
  if (next.state === 'ready') {
    return { ...base, tone: 'ready', label: 'Listo para enviar', detail: input.paused ? `${step}: sale al reanudar la campaña.`
      : input.automation ? `${step}: sale en el próximo envío automático.` : `${step}: sale con «Enviar correos disponibles».` };
  }
  if (next.dueAt) return { ...base, tone: 'scheduled', label: 'Programado', detail: step, at: next.dueAt };
  return { ...base, tone: 'scheduled', label: 'Programado', detail: `${step}: sale cuando se confirme el anterior.` };
}

/** «Se alcanzó…» reads «se alcanzó…» after «Seguimiento 1:». */
function lower(text: string) {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** Tones that need the person: a send that did not go out, or a hold only a review lifts. */
export const NEEDS_ATTENTION: ReadonlySet<RecipientTone> = new Set(['attention', 'failed']);

export type CampaignProgress = {
  rows: Array<{ recipient: CampaignRecipient; progress: RecipientProgress }>;
  recipients: number;
  /** People with at least one e-mail confirmed. */
  reached: number;
  sentMessages: number;
  totalMessages: number;
  /** null when the answers could not be read: the view then does not claim zero. */
  replied: number | null;
  attention: number;
  /** The next scheduled e-mail of the campaign. */
  nextAt: string | null;
  /** Every person got every e-mail or answered. */
  finished: boolean;
};

export function campaignProgress(input: {
  campaign: Pick<BulkCampaign, 'recipients' | 'approved_at'>;
  deliveries: CampaignDelivery[];
  attempts: CampaignAttempt[];
  /** Lowercase e-mails of the people who answered after the launch; null when unknown. */
  replied: string[] | null;
  automation: boolean;
  paused?: boolean;
  now?: number;
}): CampaignProgress {
  const answered = new Set(input.replied || []);
  const approvedAt = input.campaign.approved_at || new Date(input.now ?? Date.now()).toISOString();
  const rows = input.campaign.recipients.map(recipient => ({ recipient, progress: recipientProgress({
    recipient, deliveries: input.deliveries, attempts: input.attempts, approvedAt,
    replied: answered.has(recipient.email.trim().toLowerCase()), automation: input.automation, paused: input.paused, now: input.now,
  }) }));
  const scheduled = rows.map(row => row.progress).filter(progress => progress.tone === 'scheduled' && progress.at).map(progress => progress.at as string).sort();
  return {
    rows,
    recipients: rows.length,
    reached: rows.filter(row => row.progress.sent > 0).length,
    sentMessages: rows.reduce((sum, row) => sum + row.progress.sent, 0),
    totalMessages: rows.reduce((sum, row) => sum + row.progress.total, 0),
    replied: input.replied ? rows.filter(row => row.progress.tone === 'replied').length : null,
    attention: rows.filter(row => NEEDS_ATTENTION.has(row.progress.tone)).length,
    nextAt: scheduled[0] || null,
    finished: rows.length > 0 && rows.every(row => row.progress.tone === 'done' || row.progress.tone === 'replied'),
  };
}
