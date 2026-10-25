import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { hashMessagingDraftContent } from '@/lib/messaging-contracts';
import { parseCoworkSendTarget } from '@/lib/server/cowork/send-email';
import { resolveCoworkSender } from '@/lib/server/cowork/sender';
import { stripHtmlToText } from '@/lib/email-outbound';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkEmailReviewMode, loadCoworkEmailReviewSeller, reviewCoworkEmail } from '@/lib/server/cowork/email-review';
import { CoworkSendEditRefused, coworkSendEditSchema, coworkSendEditable, editCoworkSendProposal } from '@/lib/server/cowork/send-edit';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };

/** Scoped preview of the exact draft version pinned by the send proposal.
 * Never invents content: shows the live version and whether it still matches. */
export async function GET(req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const draftId = new URL(req.url).searchParams.get('draftId') || '';
    const state = await getCoworkRun(auth, (await context.params).id);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers });
    const proposal = state.events.slice().reverse()
      .find((event: { kind: string }) => event.kind === 'approval.requested')?.payload as {
        action?: string; kind?: string; targetId?: string; label?: string;
      } | undefined;
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'send_email') {
      return NextResponse.json({ error: 'No hay propuesta de envío en este trabajo.' }, { status: 409, headers });
    }
    // The proposal's own row says what is approved: after an edit in the card (COW-29) it points to the new revision.
    const row = await getSupabaseAdminClient().from('cowork_effect_proposals').select('target_id')
      .eq('run_id', state.run.id).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    const targetId = String(row.data?.target_id || proposal.targetId || '');
    let approved: ReturnType<typeof parseCoworkSendTarget>;
    try {
      approved = parseCoworkSendTarget(targetId);
    } catch {
      return NextResponse.json({ error: 'La propuesta de envío no es válida.' }, { status: 409, headers });
    }
    if (approved.draftId !== draftId) {
      return NextResponse.json({ error: 'El borrador no coincide con la propuesta.' }, { status: 409, headers });
    }
    const draft = await getCurrentNativeDraft({ userId: auth.user.id, organizationId: auth.organizationId, draftId });
    if (!draft || draft.channel !== 'email') {
      return NextResponse.json({ error: 'El borrador ya no está disponible.' }, { status: 409, headers });
    }
    const contentHash = hashMessagingDraftContent(draft);
    const sender = await resolveCoworkSender({ userId: auth.user.id, organizationId: auth.organizationId }, approved.provider);
    const matches = draft.versionId === approved.versionId && contentHash === approved.contentHash && sender.identityHash === approved.senderHash;
    const text = draft.content.text || stripHtmlToText(draft.content.html || '');
    // A read of the exact email against the offer (COWORK_EMAIL_REVIEW); it advises and never blocks, and any failure is no review.
    const review = matches && coworkEmailReviewMode() !== 'off'
      ? await reviewCoworkEmail({
        seller: await loadCoworkEmailReviewSeller(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId }),
        conversation: null, draft: { subject: draft.content.subject || null, body: text },
      }).catch(() => null) : null;
    return NextResponse.json({
      to: draft.recipient.email, toName: draft.recipient.displayName,
      subject: draft.content.subject, text, review,
      from: sender.email, provider: sender.provider,
      revision: draft.revision, versionId: draft.versionId, matches,
      editable: matches && await coworkSendEditable(auth, state.run.id, targetId),
      label: String(proposal.label || ''),
    }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo cargar la vista previa.' }, { status: 503, headers });
  }
}

/** «Editar» in the card (COW-29): saves the corrected subject and body and moves the proposal to that version. */
export async function PATCH(req: NextRequest, context: Context) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const body = coworkSendEditSchema.parse(await req.json());
    return NextResponse.json(await editCoworkSendProposal(auth, id, body), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof CoworkSendEditRefused) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: invalid ? 'El correo necesita asunto y cuerpo, dentro del largo permitido.' : 'No se pudo guardar el cambio del correo.' },
      { status: invalid ? 400 : 503, headers });
  }
}
