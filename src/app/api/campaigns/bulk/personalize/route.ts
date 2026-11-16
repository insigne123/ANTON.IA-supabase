import { NextRequest, NextResponse } from 'next/server';
import { PersonalizeInputSchema } from '@/lib/bulk-campaign-personal';
import { consumePersonalBudget } from '@/lib/server/bulk-ai-budget';
import { bulkCampaignError, requireBulkCampaignAuth } from '@/lib/server/bulk-campaigns';
import { personalizeRecipients } from '@/lib/server/campaign-personal';

export const runtime = 'nodejs';
// Five people at once, each a call to the model and at most a correction (55 s + 40 s).
export const maxDuration = 150;

/** The emails of a campaign written for up to five of its recipients (src/lib/server/campaign-personal.ts). Nothing is saved here. */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireBulkCampaignAuth();
    const input = PersonalizeInputSchema.parse(await req.json());
    await consumePersonalBudget(auth.organizationId, auth.user.id, input.emails.length);
    return NextResponse.json(await personalizeRecipients(auth, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
