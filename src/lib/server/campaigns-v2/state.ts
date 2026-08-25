import type { CampaignV2NextAction, CampaignV2StepState } from '@/lib/campaigns-v2/contracts';

export function campaignV2NextAction(input: {
  state: CampaignV2StepState;
  nativeDraftReady?: boolean;
}): CampaignV2NextAction {
  if (input.state === 'ready_to_prepare') return 'prepare';
  if (input.state === 'approved') return 'send';
  if (input.state === 'pending_initial_send') return input.nativeDraftReady ? 'send' : 'review';
  if (input.state === 'drafting' || input.state === 'review_required') return 'review';
  return 'resolve';
}

export function campaignV2ComposeUrl(draftId: string | null, stepId: string) {
  return draftId
    ? `/contact/compose?draftId=${encodeURIComponent(draftId)}&campaignStepId=${encodeURIComponent(stepId)}`
    : null;
}
