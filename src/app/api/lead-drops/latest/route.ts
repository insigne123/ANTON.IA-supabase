import { NextResponse } from 'next/server';
import { homeScope } from '@/lib/home/scope';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { withDropPhones } from '@/lib/server/lead-drop-call';
import { LeadDropsError, homeDrop, latestDropPending } from '@/lib/server/lead-drops';
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
    const home: Awaited<ReturnType<typeof homeDrop>> = await homeDrop(admin, scope, now).catch((error: unknown) => {
      if (error instanceof LeadDropsError) return { drop: null, pull: null };
      throw error;
    });
    // The section of «Hoy» shows each saved contact with where its mobile stands («Para llamar», src/lib/lead-drop-call.ts).
    const board = home.board ? { ...home.board, items: await withDropPhones(admin, scope, home.board.items, now) } : undefined;
    // «Tus contactos de hoy», the screen under «Hoy», opens the last contacts also when nothing of them is left to do.
    const latest = await latestDropPending(admin, scope, now).catch(() => null);
    // `plan` comes only for a team with a plan of its own, and only while there is something to offer.
    return NextResponse.json({ scope: homeScope(user.id, organizationId, now), ...home, ...(board ? { board } : {}), latestId: latest?.id ?? null },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error instanceof LeadDropsError ? new AuthError(error.message, error.status) : error);
  }
}
