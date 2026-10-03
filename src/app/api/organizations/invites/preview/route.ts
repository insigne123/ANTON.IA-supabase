import { createHash } from 'node:crypto';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { organizationNoStoreHeaders } from '@/lib/server/organization-api';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { describeInvitePreview, type InviteRow } from '@/lib/organization-invite-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What an invitation link is for, before anyone accepts it: the organization, the role and a masked address. It needs
 * no session (the invited person may not have an account yet). The token travels in a header, so it stays out of URLs
 * and access logs, and only its SHA-256 is looked up, as the accept route does.
 */
export async function GET(request: Request) {
  const token = String(request.headers.get('x-invite-token') || '').trim();
  if (token.length < 20 || token.length > 500) {
    return NextResponse.json({ status: 'invalid' }, { headers: organizationNoStoreHeaders });
  }
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const admin = getSupabaseAdminClient();
  const { data: invite, error } = await admin
    .from('organization_invites')
    .select('organization_id, email, role, expires_at, accepted_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) {
    console.error('[invite-preview] Invitation lookup failed:', error);
    return NextResponse.json({ error: 'No pudimos leer la invitación.' }, { status: 503, headers: organizationNoStoreHeaders });
  }

  let organizationName: string | null = null;
  if (invite?.organization_id) {
    const { data: organization } = await admin.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle();
    organizationName = String(organization?.name || '').trim() || null;
  }

  let sessionEmail: string | null = null;
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    sessionEmail = user?.email ?? null;
  } catch {
    // Without a readable session the page offers to sign in.
  }

  return NextResponse.json(
    describeInvitePreview((invite as InviteRow | null) ?? null, organizationName, { now: Date.now(), sessionEmail }),
    { headers: organizationNoStoreHeaders },
  );
}
