import { NextResponse } from 'next/server';
import { handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readNavPending } from '@/lib/server/nav-pending';

export const dynamic = 'force-dynamic';

/** What waits for the signed-in person in Conversaciones, Cowork and Oportunidades, for the numbers in the menu (APP-23). */
export async function GET(request: Request) {
  try {
    const { supabase, user, organizationId } = await requireHomeAuth(request);
    const pending = await readNavPending({ supabase, admin: getSupabaseAdminClient(), user, organizationId, now: new Date() });
    return NextResponse.json({ organizationId, ...pending }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return requestAuthErrorResponse(error) || handleAuthError(error);
  }
}
