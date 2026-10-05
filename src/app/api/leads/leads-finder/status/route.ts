import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

import { hasLeadsFinderAccess } from '@/lib/server/leads-finder/access';

export const dynamic = 'force-dynamic';

/**
 * Whether «Buscar prospectos» offers Leads Finder to this person (Plan 11, PR 6c). It never says why not: a person without
 * access reads the same `available: false` whether the test is off or they are not on the list.
 */
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  return NextResponse.json(
    { available: Boolean(user && hasLeadsFinderAccess(user.email)) },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  );
}
