import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireSessionRequestAuth } from '@/lib/server/request-auth';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/lib/server/organization-context';
import { organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

export const runtime = 'nodejs';

const AcceptSchema = z.object({ token: z.string().trim().min(20).max(500) }).strict();

export async function POST(request: Request) {
  try {
    const auth = await requireSessionRequestAuth();
    const body = AcceptSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: 'Invitation token is invalid' }, { status: 400, headers: organizationNoStoreHeaders });
    }
    const tokenHash = createHash('sha256').update(body.data.token, 'utf8').digest('hex');
    const { data, error } = await auth.supabase.rpc('accept_organization_invite_v1', { p_token_hash: tokenHash });
    if (error) throw error;
    const organizationId = String(data || '');
    const response = NextResponse.json({ accepted: true, organizationId }, { headers: organizationNoStoreHeaders });
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, activeOrganizationCookieOptions());
    return response;
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_INVITE_ACCEPT_FAILED');
  }
}
