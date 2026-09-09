import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBulkCampaignAuth, getBulkCampaign, bulkCampaignError } from '@/lib/server/bulk-campaigns';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBulkCampaignAuth();
    const campaign = await getBulkCampaign(auth, (await context.params).id);
    const { draftId } = z.object({ draftId: z.string().uuid() }).strict().parse(await req.json());
    const { error } = await getSupabaseAdminClient().rpc('retry_bulk_campaign_attempt_v1', {
      p_campaign_id: campaign.id, p_draft_id: draftId, p_user_id: auth.user.id, p_organization_id: auth.organizationId,
    });
    if (error) {
      if (String(error.message).includes('BULK_CAMPAIGN_')) return NextResponse.json({ error: 'Este envío necesita revisión y no puede reintentarse. Actualiza su estado.' }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
