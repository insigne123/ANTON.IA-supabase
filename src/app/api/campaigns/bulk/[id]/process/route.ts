import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCampaignAttempts, sendTrackedCampaignMessage } from '@/lib/server/bulk-campaign-attempts';
import { withSentAttemptsAsDeliveries } from '@/lib/bulk-campaign-attempts';
import { AuthError } from '@/lib/server/auth-utils';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { nextCampaignMessage, matchAudience } from '@/lib/bulk-campaigns';
import { loadAudience } from '@/lib/server/bulk-campaign-audience';
import { assertCampaignRecipientAllowed, bulkCampaignError, campaignDeliveries, getBulkCampaign } from '@/lib/server/bulk-campaigns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One durable, idempotent send per request. The browser may resume without regenerating or duplicating content. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await context.params;
    const body = z.object({ email: z.string().email(), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await req.json());
    const campaign = await getBulkCampaign(auth, id);
    if (campaign.status !== 'approved' || !campaign.approved_at || campaign.review_hash !== body.reviewHash) throw new AuthError('La campaña no está aprobada o está en pausa.', 409);
    const recipient = campaign.recipients.find(person => person.email === body.email);
    if (!recipient) throw new AuthError('El destinatario no pertenece a la audiencia aprobada.', 404);
    const [deliveries, attempts] = await Promise.all([campaignDeliveries(auth, campaign), getCampaignAttempts(auth.supabase, campaign)]);
    const next = nextCampaignMessage(recipient, withSentAttemptsAsDeliveries(deliveries, attempts), campaign.approved_at);
    if (!next || next.state !== 'ready') return NextResponse.json({ sent: false, state: next?.state || 'completed', dueAt: next?.dueAt });
    const current = (await loadAudience(auth)).find(person => person.email === recipient.email);
    if (!current || current.blockedReason || (next.index > 0 && current.replied)
      || (next.index === 0 && !matchAudience(current, campaign.definition.criteria))) throw new AuthError('El contacto cambió, respondió o ya no está disponible. Revisa su historial antes de continuar.', 409);
    await assertCampaignRecipientAllowed(auth, recipient.email);
    // Recheck pause after potentially slow eligibility queries.
    if ((await getBulkCampaign(auth, id)).status !== 'approved') throw new AuthError('La campaña está en pausa.', 409);
    const result = await sendTrackedCampaignMessage(campaign, next.message);
    return NextResponse.json({ sent: result.status === 'sent', state: result.status,
      error: result.dispatch?.errorMessage || null }, { status: result.status === 'sent' ? 200 : 409 });
  } catch (error) { return bulkCampaignError(error); }
}
