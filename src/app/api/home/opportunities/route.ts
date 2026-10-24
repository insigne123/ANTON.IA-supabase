import { NextResponse } from 'next/server';
import { handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { homeScope } from '@/lib/home/scope';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readHomeOpportunities } from '@/lib/server/home-opportunities';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/**
 * «Oportunidades» on «Hoy» for the signed-in person (src/lib/home/opportunities-today.ts): the ones they work, the reports ready, and
 * what waits for an answer: for an administrator, the decisions and blocks of the team and the recommended ones closing this week
 * without a team; for anyone else, the decisions they asked. Nothing for whoever has no access to Oportunidades.
 */
export async function GET(request: Request) {
  try {
    const { user, organizationId } = await requireHomeAuth(request);
    const now = new Date();
    const scope = homeScope(user.id, organizationId, now);
    const today = await readHomeOpportunities(getSupabaseAdminClient(), user, organizationId, now);
    if (!today) return NextResponse.json({ scope, access: false }, { headers });
    return NextResponse.json({ scope, access: true, ...today }, { headers });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error);
  }
}
