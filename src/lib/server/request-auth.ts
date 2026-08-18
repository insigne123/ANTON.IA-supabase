import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type RequestAuthContext = {
  user: any;
  organizationId: string | null;
  supabase: any;
  source: 'session' | 'internal';
};

export class RequestAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RequestAuthError';
    this.status = status;
  }
}

async function findMembership(supabase: any, userId: string, organizationId?: string | null) {
  let query = supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId);

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  } else {
    query = query.order('created_at', { ascending: true }).limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[request-auth] Membership validation failed:', error);
    throw new RequestAuthError('Failed to verify organization membership', 500);
  }
  return data || null;
}

export async function requireSessionRequestAuth(): Promise<RequestAuthContext> {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new RequestAuthError('Unauthorized', 401);
  }

  return {
    user,
    organizationId: null,
    supabase,
    source: 'session',
  };
}

export async function requireSessionOrTrustedInternalRequest(req: Request): Promise<RequestAuthContext> {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const requestedOrganizationId = String(req.headers.get('x-organization-id') || '').trim() || null;
    const membership = await findMembership(supabase, user.id, requestedOrganizationId);
    if (!membership) {
      throw new RequestAuthError('User does not belong to the requested organization', 403);
    }
    return {
      user,
      organizationId: membership.organization_id,
      supabase,
      source: 'session',
    };
  }

  const userId = String(req.headers.get('x-user-id') || '').trim();
  const organizationId = String(req.headers.get('x-organization-id') || '').trim();
  if (!userId || !organizationId || !isTrustedInternalRequest(req)) {
    throw new RequestAuthError('Unauthorized', 401);
  }

  const admin = getSupabaseAdminClient();
  const membership = await findMembership(admin, userId, organizationId);
  if (!membership) {
    throw new RequestAuthError('User does not belong to the requested organization', 403);
  }

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    throw new RequestAuthError('Internal request user does not exist', 403);
  }

  return {
    user: data.user,
    organizationId,
    supabase: admin,
    source: 'internal',
  };
}

export function requestAuthErrorResponse(error: unknown) {
  if (error instanceof RequestAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}
