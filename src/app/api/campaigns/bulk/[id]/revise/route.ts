import { NextRequest, NextResponse } from 'next/server';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError } from '@/lib/server/bulk-campaigns';
import { reviseBulkCampaignPending } from '@/lib/server/bulk-campaign-revise';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function POST(req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth();
    const campaign = await reviseBulkCampaignPending(auth, (await context.params).id, await req.json());
    return NextResponse.json({ campaign });
  } catch (error) { return bulkCampaignError(error); }
}
