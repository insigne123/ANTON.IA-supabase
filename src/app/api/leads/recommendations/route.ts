import { NextResponse } from 'next/server';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { readCoworkLeadRecommendations } from '@/lib/server/cowork/lead-recommend-read';

export const dynamic = 'force-dynamic';

/**
 * «Recomendados para ti» in Inicio (plan 8, phase 2): the saved contacts nobody wrote to yet, best first for the customer
 * declared in «Perfil», without the people another member is working. Same ranking as Cowork's leads.recommend.
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    const result = await readCoworkLeadRecommendations(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId }, '');
    return NextResponse.json({ ...result, top: result.top.slice(0, 10) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No se pud')) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return handleAuthError(error);
  }
}
