import { NextResponse } from 'next/server';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { readCoworkIcp } from '@/lib/server/cowork/icp-read';

export const dynamic = 'force-dynamic';

/**
 * «Lo que dicen tus resultados» in Perfil (plan 8, phase 2): the same arithmetic Cowork reads with icp.analyze, with the
 * person's session, so row security applies as in every other screen.
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    const analysis = await readCoworkIcp(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId }, '');
    return NextResponse.json(analysis, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No se pud')) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return handleAuthError(error);
  }
}
