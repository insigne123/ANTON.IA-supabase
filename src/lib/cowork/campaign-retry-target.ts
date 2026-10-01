import { createHash } from 'node:crypto';

/** What a retry of failed sends is pinned to (the server half is src/lib/server/cowork/campaign-retry.ts): the campaign and a hash of exactly the
 * drafts the card listed, so an approval can only retry what the person saw. Pure: no database, no provider. */

export const COWORK_CAMPAIGN_RETRY_MAX = 50;

/** Off unless the variable is exactly «true»: the switch that also stops a retry already approved. */
export function coworkCampaignRetryEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_CAMPAIGN_RETRY_ENABLED === 'true';
}

export function hashCoworkCampaignRetry(runId: string, campaignId: string, draftIds: string[]) {
  return createHash('sha256').update(JSON.stringify(['cowork|campaign-retry', runId, campaignId, [...draftIds].sort()])).digest('hex');
}

const TARGET = /^campaignretry:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-f0-9]{64})$/;
export function parseCoworkCampaignRetryTarget(targetId: string) {
  const match = TARGET.exec(String(targetId || ''));
  if (!match) throw new Error('La propuesta de reintento no es válida.');
  return { campaignId: match[1], hash: match[2] };
}
export const coworkCampaignRetryTarget = (campaignId: string, hash: string) => `campaignretry:${campaignId}:${hash}`;
