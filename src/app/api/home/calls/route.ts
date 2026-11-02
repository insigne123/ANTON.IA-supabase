import { NextResponse } from 'next/server';
import { handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { homeScope } from '@/lib/home/scope';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { ContactCallError, readCallsToday } from '@/lib/server/contact-calls';

export const dynamic = 'force-dynamic';

/** «Llamadas» in «Hoy» (src/lib/contact-calls.ts): the person's calls without a result and their contacts waiting for a call. */
export async function GET(request: Request) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const now = new Date();
    const today = await readCallsToday(getSupabaseAdminClient(), { organizationId, userId: user.id }, now);
    return NextResponse.json({ scope: homeScope(user.id, organizationId, now), ...today }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ContactCallError) return NextResponse.json({ error: error.message }, { status: error.status });
    return requestAuthErrorResponse(error) || handleAuthError(error);
  }
}
