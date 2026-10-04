import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { bulkCampaignError, campaignDeliveries, getBulkCampaign, requireBulkCampaignAuth } from '@/lib/server/bulk-campaigns';
import { getCampaignAttempts } from '@/lib/server/bulk-campaign-attempts';
import { bulkWorkerDependencies, runBulkCampaignWorker } from '@/lib/server/bulk-campaign-worker';
import { campaignProgress } from '@/lib/bulk-campaign-eligibility';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Messages one request may try. The rest go in the next call, or with the scheduled worker when it is on. */
const MAX_ATTEMPTS_PER_CALL = 25;
const BUDGET_MS = 40000;

/**
 * Sends what is due in one approved campaign from the server: one request instead of one per recipient from the browser.
 * Same worker, checks and idempotency as the scheduled run (`bulk:<campaign>:<draft>` durable claims), so a request and
 * the cron can overlap without a double send. Returns what happened and where the campaign stands now.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBulkCampaignAuth();
    const { id } = await context.params;
    const body = z.object({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await req.json());
    const campaign = await getBulkCampaign(auth, id);
    if (campaign.status !== 'approved' || !campaign.approved_at || campaign.review_hash !== body.reviewHash) {
      throw new AuthError('La campaña no está aprobada o está en pausa.', 409);
    }
    const summary = await runBulkCampaignWorker({ ...bulkWorkerDependencies(), list: async () => [campaign] }, BUDGET_MS, MAX_ATTEMPTS_PER_CALL);
    const [deliveries, attempts] = await Promise.all([campaignDeliveries(auth, campaign), getCampaignAttempts(auth.supabase, campaign)]);
    return NextResponse.json({ summary, progress: campaignProgress(campaign, deliveries, attempts) });
  } catch (error) { return bulkCampaignError(error); }
}
