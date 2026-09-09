import { NextRequest, NextResponse } from 'next/server';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError, saveBulkCampaign } from '@/lib/server/bulk-campaigns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const auth = await requireAuth();
    const { data, error } = await auth.supabase.from('bulk_campaigns')
      .select('id,revision,status,definition,created_at,updated_at').eq('organization_id', auth.organizationId)
      .eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ campaigns: data, automationEnabled: process.env.BULK_CAMPAIGNS_AUTOMATION_ENABLED === 'true' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
export async function POST(req: NextRequest) {
  try { return NextResponse.json({ campaign: await saveBulkCampaign(await requireAuth(), await req.json()) }, { status: 201 }); }
  catch (error) { return bulkCampaignError(error); }
}
