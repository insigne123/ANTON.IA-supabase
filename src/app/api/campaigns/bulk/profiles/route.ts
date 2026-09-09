import { NextRequest, NextResponse } from 'next/server';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError } from '@/lib/server/bulk-campaigns';
import { createAudienceProfile, listAudienceProfiles } from '@/lib/server/bulk-audience-profiles';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const auth = await requireAuth();
    return NextResponse.json({ profiles: await listAudienceProfiles(auth) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    return NextResponse.json({ profile: await createAudienceProfile(auth, await req.json()) }, { status: 201 });
  } catch (error) { return bulkCampaignError(error); }
}
