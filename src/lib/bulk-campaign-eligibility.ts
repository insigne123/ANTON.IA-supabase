import { matchAudience, nextCampaignMessage, type AudienceCriteria, type AudiencePerson, type BulkCampaign, type CampaignDelivery } from '@/lib/bulk-campaigns';
import { campaignAttemptAllowsRetry, withSentAttemptsAsDeliveries, type CampaignAttempt } from '@/lib/bulk-campaign-attempts';

export type RecipientEligibility =
  | { ok: true }
  | { ok: false; code: 'BULK_CAMPAIGN_RECIPIENT_CHANGED'; message: string };

/**
 * The audience check made right before each send, by the browser request and by the server worker alike: the contact is
 * still among your contacts and not blocked, nobody gets a follow-up after replying, and a first message still matches
 * the criteria that were approved. The provider-side guards (pause, unsubscribe, company reply, domain, frequency) run
 * later, inside the sender.
 */
export function recipientEligibility(
  current: AudiencePerson | undefined,
  messageIndex: number,
  criteria: AudienceCriteria,
  now = Date.now(),
): RecipientEligibility {
  const held = (message: string) => ({ ok: false as const, code: 'BULK_CAMPAIGN_RECIPIENT_CHANGED' as const, message });
  if (!current) return held('El contacto ya no está en tus contactos. Revisa su historial antes de continuar.');
  if (current.blockedReason) return held(`${current.blockedReason}. Revisa su historial antes de continuar.`);
  if (messageIndex > 0 && current.replied) return held('Respondió: sus seguimientos se detienen.');
  if (messageIndex === 0 && !matchAudience(current, criteria, now)) return held('Ya no cumple los criterios aprobados. Revisa su historial antes de continuar.');
  return { ok: true };
}

export type CampaignProgress = {
  /** Messages due now that a run would try. */
  ready: number;
  /** Follow-ups waiting for their day, or for the previous message to be confirmed. */
  waiting: number;
  /** People whose sequence is complete. */
  done: number;
  /** People held for review: an attempt marked for attention, or a delivery that is not confirmed. */
  attention: number;
  total: number;
};

/** Where each person of an approved campaign stands, from its deliveries and attempts. */
export function campaignProgress(campaign: Pick<BulkCampaign, 'recipients' | 'approved_at'>, deliveries: CampaignDelivery[], attempts: CampaignAttempt[], now = Date.now()): CampaignProgress {
  const progress: CampaignProgress = { ready: 0, waiting: 0, done: 0, attention: 0, total: campaign.recipients.length };
  if (!campaign.approved_at) return { ...progress, waiting: campaign.recipients.length };
  const merged = withSentAttemptsAsDeliveries(deliveries, attempts);
  for (const person of campaign.recipients) {
    const next = nextCampaignMessage(person, merged, campaign.approved_at, now);
    if (!next) { progress.done++; continue; }
    if (next.state === 'ready') {
      const attempt = attempts.find(value => value.draft_id === next.message.draftId);
      if (campaignAttemptAllowsRetry(attempt, now)) progress.ready++;
      else if (attempt?.state === 'retry_wait') progress.waiting++; // cooling down; tried again later
      else progress.attention++;
    } else if (next.state === 'failed' || next.state === 'unknown') progress.attention++;
    else progress.waiting++; // not due yet, or a send still in flight
  }
  return progress;
}
