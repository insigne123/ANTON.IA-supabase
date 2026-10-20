import { NextResponse } from 'next/server';
import { homeScope } from '@/lib/home/scope';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { LeadDropsError, homeDrop } from '@/lib/server/lead-drops';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * «Contacto del día» in «Hoy» (src/lib/server/lead-drops.ts, homeDrop): the person's last drop with a contact left to
 * save, or `pull`, what «Hoy» offers instead: today's, made at that moment (POST /api/lead-drops/now), the way back to
 * it while it is written, or «Perfil» when there is no customer to go by.
 */
export async function GET(request: Request) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const now = new Date();
    const admin = getSupabaseAdminClient();
    const scope = { organizationId, userId: user.id };
    // Before the migration there are no drops: «Hoy» shows nothing.
    const { drop, pull } = await homeDrop(admin, scope, now).catch((error: unknown) => {
      if (error instanceof LeadDropsError) return { drop: null, pull: null };
      throw error;
    });
    return NextResponse.json({ scope: homeScope(user.id, organizationId, now), drop, pull },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error instanceof LeadDropsError ? new AuthError(error.message, error.status) : error);
  }
}
