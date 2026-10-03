import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';

export const dynamic = 'force-dynamic';

/** Whether the signed-in person manages privacy requests and incidents: «Privacidad» shows those entries only then. */
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ admin: isPrivacyAdminEmail(user.email) }, { headers: { 'Cache-Control': 'no-store' } });
}
