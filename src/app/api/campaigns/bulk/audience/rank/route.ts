import { NextRequest, NextResponse } from 'next/server';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError } from '@/lib/server/bulk-campaigns';
import { consumeAssistBudget } from '@/lib/server/bulk-ai-budget';
import { rankAudience } from '@/lib/server/bulk-campaign-audience';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Smart audience ranking: the server builds a CSV of enriched saved leads,
 * the model ranks fit against the ideal-lead description, and eligibility
 * (contact history, blocks, replies) is enforced deterministically.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json().catch(() => null);
    await consumeAssistBudget(auth.organizationId, auth.user.id);
    const result = await rankAudience(auth, body);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
