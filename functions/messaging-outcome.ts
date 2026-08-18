export type MessagingOutcome = 'sent' | 'failed';

export function getMessagingOutcomeEffects(input: { dryRun: boolean; outcome: MessagingOutcome }) {
  const sent = !input.dryRun && input.outcome === 'sent';
  return {
    receiptStatus: input.dryRun ? 'dry_run' as const : input.outcome,
    contactedCountDelta: sent ? 1 : 0,
    insertContactedLead: sent,
    updateCampaignSentRecords: sent,
    markLeadContacted: sent,
    allowLeadStatusMutation: !input.dryRun,
  };
}
