import { NextResponse } from 'next/server';
import { handleAuthError } from '@/lib/server/auth-utils';
import {requireHomeAuth} from '@/lib/server/home-auth';
import {requestAuthErrorResponse} from '@/lib/server/request-auth';
import {homeScope} from '@/lib/home/scope';
import {readTeamLocks} from '@/lib/server/team-locks';
import { readCoworkLeadRecommendations } from '@/lib/server/cowork/lead-recommend-read';

export const dynamic = 'force-dynamic';

/**
 * «Recomendados para ti» in Inicio (plan 8, phase 2): the saved contacts nobody wrote to yet, best first for the customer
 * declared in «Perfil», without the people another member is working. Same ranking as Cowork's leads.recommend.
 */
export async function GET(request:Request) {
  try {
    const auth = await requireHomeAuth(request);
    const result = await readCoworkLeadRecommendations(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId }, '',{locks:readTeamLocks,personal:true});
    return NextResponse.json({ ...result, scope:homeScope(auth.user.id,auth.organizationId),top: result.top.slice(0, 10) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No se pud')) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return requestAuthErrorResponse(error)||handleAuthError(error);
  }
}
