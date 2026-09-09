import { NextRequest, NextResponse } from 'next/server';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError } from '@/lib/server/bulk-campaigns';
import { deleteAudienceProfile } from '@/lib/server/bulk-audience-profiles';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function DELETE(_req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth();
    await deleteAudienceProfile(auth, (await context.params).id);
    return NextResponse.json({ ok: true });
  } catch (error) { return bulkCampaignError(error); }
}
