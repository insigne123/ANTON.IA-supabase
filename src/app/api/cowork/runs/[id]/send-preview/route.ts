import { NextRequest, NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { hashMessagingDraftContent } from '@/lib/messaging-contracts';
import { parseCoworkSendTarget } from '@/lib/server/cowork/send-email';
import { resolveCoworkSender } from '@/lib/server/cowork/sender';
import { stripHtmlToText } from '@/lib/email-outbound';

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
    let approved: ReturnType<typeof parseCoworkSendTarget>;
    try {
      approved = parseCoworkSendTarget(String(proposal.targetId || ''));
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
    return NextResponse.json({
      to: draft.recipient.email, toName: draft.recipient.displayName,
      subject: draft.content.subject, text: draft.content.text || stripHtmlToText(draft.content.html || ''),
      from: sender.email, provider: sender.provider,
      revision: draft.revision, versionId: draft.versionId, matches,
      label: String(proposal.label || ''),
    }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo cargar la vista previa.' }, { status: 503, headers });
  }
}
