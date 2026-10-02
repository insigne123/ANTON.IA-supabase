import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { isConversationCloseOutcome } from '@/lib/conversation-close';
import { closeContactedConversation, ConversationCloseError } from '@/lib/server/conversation-close';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ contactedId: string }> };

/** «Cerrar conversación» (Plan 5, PR-9a): closes one of the person's own conversations with an outcome. */
export async function POST(req: NextRequest, context: Context) {
  try {
    const { user, organizationId, supabase } = await requireAuth();
    const { contactedId } = await context.params;
    const body = await req.json().catch(() => ({}));
    if (!isConversationCloseOutcome(body?.outcome)) throw new AuthError('Elige cómo terminó la conversación', 400);
    // A reply arriving after the user opened the view must remain pending.
    const observedAt = typeof body.observedAt === 'string' ? Date.parse(body.observedAt) : NaN;
    if (!Number.isFinite(observedAt) || observedAt > Date.now()) throw new AuthError('Actualiza la conversación antes de cerrarla', 400);
    const result = await closeContactedConversation(supabase as any, { userId: user.id, organizationId }, { contactedId, outcome: body.outcome, observedAt });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleAuthError(error instanceof ConversationCloseError ? new AuthError(error.message, error.status) : error);
  }
}
