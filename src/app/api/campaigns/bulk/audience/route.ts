import { NextRequest, NextResponse } from 'next/server';
import { AudienceSearchSchema } from '@/lib/bulk-campaigns';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { searchAudiencePage } from '@/lib/server/bulk-campaign-audience';
import { bulkCampaignError } from '@/lib/server/bulk-campaigns';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    // Backwards compatible: a bare criteria object searches the first page.
    const input = body && typeof body === 'object' && 'criteria' in body ? body : { criteria: body };
    const search = AudienceSearchSchema.parse(input);
    const result = await searchAudiencePage(auth, search);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
