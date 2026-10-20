import { NextResponse } from 'next/server';
import { homeScope } from '@/lib/home/scope';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { LeadDropsError, latestDrop } from '@/lib/server/lead-drops';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

/** The person's latest «Contactos de la semana» with contacts left to save, for «Hoy»; null when there is none. */
export async function GET(request: Request) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const now = new Date();
    const drop = await latestDrop(getSupabaseAdminClient(), { organizationId, userId: user.id }, now).catch(error => {
      // Before the migration there are no drops: «Hoy» shows nothing.
      if (error instanceof LeadDropsError) return null;
      throw error;
    });
    return NextResponse.json({ scope: homeScope(user.id, organizationId, now), drop }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error instanceof LeadDropsError ? new AuthError(error.message, error.status) : error);
  }
}
