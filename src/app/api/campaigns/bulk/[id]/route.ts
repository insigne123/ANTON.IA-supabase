import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withConfirmedSends } from '@/lib/bulk-campaign-attempts';
import { getCampaignAttempts } from '@/lib/server/bulk-campaign-attempts';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError, campaignDeliveries, campaignReplies, getBulkCampaign, reviewBulkCampaign, saveBulkCampaign } from '@/lib/server/bulk-campaigns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth();
    const campaign = await getBulkCampaign(auth, (await context.params).id);
    // Who answered is best effort: without it the view says nothing about answers instead of «0».
    const [deliveries, attempts, replied] = await Promise.all([campaignDeliveries(auth, campaign), getCampaignAttempts(auth.supabase, campaign),
      campaignReplies(auth, campaign).catch(() => null)]);
    return NextResponse.json({ campaign, deliveries, attempts: withConfirmedSends(attempts, deliveries), replied }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
export async function PUT(req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth();
    const body = z.object({ revision: z.number().int().positive(), definition: z.unknown() }).strict().parse(await req.json());
    return NextResponse.json({ campaign: await saveBulkCampaign(auth, body.definition, (await context.params).id, body.revision) });
  } catch (error) { return bulkCampaignError(error); }
}
export async function POST(req: NextRequest, context: Context) {
  try { return NextResponse.json({ campaign: await reviewBulkCampaign(await requireAuth(), (await context.params).id, await req.json()) }); }
  catch (error) { return bulkCampaignError(error); }
}
