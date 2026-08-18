import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireSupliaAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadMessage(messageId: string, organizationId: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from('suplia_messages')
    .select('id, conversation_id, organization_id')
    .eq('id', messageId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const auth = await requireSupliaAuth();
    const { messageId } = await params;
    const body = await req.json().catch(() => ({}));
    const rating = body?.rating === 'up' || body?.rating === 'down' ? body.rating : null;

    if (!rating) return NextResponse.json({ error: 'rating invalido' }, { status: 400 });

    const message = await loadMessage(messageId, auth.organizationId);
    if (!message) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 });

    const now = new Date().toISOString();
    const { error } = await getSupabaseAdminClient()
      .from('suplia_message_feedback')
      .upsert({
        organization_id: auth.organizationId,
        conversation_id: message.conversation_id,
        message_id: messageId,
        user_id: auth.user.id,
        rating,
        comment: typeof body?.comment === 'string' ? body.comment.slice(0, 2000) : null,
        updated_at: now,
      }, { onConflict: 'message_id,user_id' });

    if (error) throw error;
    return NextResponse.json({ ok: true, rating });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/feedback] error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo guardar el feedback' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const auth = await requireSupliaAuth();
    const { messageId } = await params;
    const message = await loadMessage(messageId, auth.organizationId);

    if (!message) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 });

    const { error } = await getSupabaseAdminClient()
      .from('suplia_message_feedback')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', auth.user.id)
      .eq('organization_id', auth.organizationId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/feedback] delete error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo quitar el feedback' }, { status: 500 });
  }
}
