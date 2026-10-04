import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { CoworkThreadError, updateCoworkThread } from '@/lib/server/cowork/thread-settings';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

const ERRORS: Record<CoworkThreadError['code'], { status: number; error: string }> = {
  NOT_FOUND: { status: 404, error: 'Ese trabajo ya no está en tu lista.' },
  ACTIVE: { status: 409, error: 'Este trabajo sigue en curso. Espera a que termine o detenlo para eliminarlo.' },
  UNAVAILABLE: { status: 503, error: 'Por ahora no se pueden renombrar ni eliminar trabajos.' },
};

async function change(rootId: string, input: unknown) {
  try {
    const auth = await requireCoworkAccess();
    const thread = await updateCoworkThread(auth.supabase, getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId }, rootId, input);
    return NextResponse.json({ thread }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message?.startsWith('Usa hasta') ? error.issues[0].message : 'Revisa el nombre y vuelve a intentarlo.' }, { status: 400, headers });
    if (error instanceof CoworkThreadError) return NextResponse.json({ error: ERRORS[error.code].error, code: error.code }, { status: ERRORS[error.code].status, headers });
    console.error('[cowork/threads]', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return NextResponse.json({ error: 'No pudimos guardar el cambio. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}

/** «Renombrar» ({ title }) and «Deshacer» after deleting ({ hidden: false }). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ rootId: string }> }) {
  const { rootId } = await params;
  const body = await request.json().catch(() => null);
  return change(rootId, body);
}

/** «Eliminar» hides the conversation from the list; it can be brought back with «Deshacer». */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ rootId: string }> }) {
  const { rootId } = await params;
  return change(rootId, { hidden: true });
}
