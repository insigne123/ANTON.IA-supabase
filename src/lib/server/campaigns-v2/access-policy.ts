export type CampaignV2CreatorAccessDecision = 'allowed' | 'not_found' | 'forbidden';

export function campaignV2CreatorAccessDecision(input: {
  enabled: boolean;
  creatorId: string;
  userId: string;
}): CampaignV2CreatorAccessDecision {
  if (!input.enabled) return 'not_found';
  return input.creatorId === input.userId ? 'allowed' : 'forbidden';
}
