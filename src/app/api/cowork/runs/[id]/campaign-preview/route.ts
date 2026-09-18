import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getBulkCampaign } from '@/lib/server/bulk-campaigns';
import { loadAudience } from '@/lib/server/bulk-campaign-audience';
import { parseCoworkCampaignTarget } from '@/lib/server/cowork/campaign-ops';
import { CampaignInputSchema } from '@/lib/bulk-campaigns';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };

/** Scoped preview of a campaign proposal: staged definition with live audience
 * count, or current campaign state with review-hash match for activate/pause. */
export async function GET(_req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const state = await getCoworkRun(auth, (await context.params).id);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers });
    const proposal = state.events.slice().reverse()
      .find((event: { kind: string }) => event.kind === 'approval.requested')?.payload as {
        action?: string; kind?: string; targetId?: string; label?: string;
      } | undefined;
    if (!proposal || proposal.action !== 'cowork.effect'
      || (proposal.kind !== 'campaign_create' && proposal.kind !== 'campaign_activate' && proposal.kind !== 'campaign_pause')) {
      return NextResponse.json({ error: 'No hay propuesta de campaña en este trabajo.' }, { status: 409, headers });
    }
    if (proposal.kind === 'campaign_create') {
      const row = await getSupabaseAdminClient().from('cowork_campaign_definitions')
        .select('definition').eq('run_id', (await context.params).id)
        .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
      if (row.error || !row.data) {
        return NextResponse.json({ error: 'La definición aprobada ya no está disponible.' }, { status: 409, headers });
      }
      const definition = CampaignInputSchema.parse(row.data.definition);
      const audience = await loadAudience(auth, definition.criteria);
      const matched = new Set(audience.filter(person => !person.blockedReason).map(person => person.email.toLowerCase()));
      return NextResponse.json({
        kind: 'campaign_create', label: String(proposal.label || ''),
        name: definition.name, objective: definition.objective, provider: definition.provider,
        messages: definition.messages.map(message => ({ subject: message.subject, body: message.body, delayDays: message.delayDays })),
        emails: definition.emails,
        matched: definition.emails.filter(email => matched.has(email.toLowerCase())).length,
      }, { headers });
    }
    let target;
    try {
      target = parseCoworkCampaignTarget(String(proposal.targetId || ''));
    } catch {
      return NextResponse.json({ error: 'La propuesta de campaña no es válida.' }, { status: 409, headers });
    }
    const campaign = await getBulkCampaign(auth, target.campaignId);
    return NextResponse.json({
      kind: proposal.kind, label: String(proposal.label || ''),
      name: String(campaign.definition?.name || campaign.id), status: campaign.status,
      revision: campaign.revision, recipients: campaign.recipients.length,
      emails: campaign.recipients.map(recipient => recipient.email),
      matches: campaign.revision === target.revision && campaign.review_hash === target.reviewHash,
    }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo cargar la vista previa.' }, { status: 503, headers });
  }
}
