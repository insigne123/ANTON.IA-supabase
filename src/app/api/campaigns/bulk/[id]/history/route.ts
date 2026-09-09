import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError } from '@/lib/server/bulk-campaigns';
import { getBulkRecipientHistory } from '@/lib/server/bulk-campaign-history';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth();
    const email = z.string().parse(req.nextUrl.searchParams.get('email'));
    return NextResponse.json(await getBulkRecipientHistory(auth, (await context.params).id, email), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) { return bulkCampaignError(error); }
}
