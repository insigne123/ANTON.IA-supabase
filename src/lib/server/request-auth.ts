import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { resolveActiveOrganization } from '@/lib/server/organization-context';
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

function requestSessionClient(req: Request) {
  const authorization = req.headers.get('authorization');
  if (!authorization) return { supabase: createRouteHandlerClient({ cookies }), token: undefined };
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length > 16000) throw new RequestAuthError('Unauthorized', 401);
  const token = match[1];
  // One verified token also backs the RLS membership query. Cookie rotation in
  // another request must not silently turn that query into an anonymous one.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { supabase, token };
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

export async function requireSessionRequestAuth(req?: Request): Promise<RequestAuthContext> {
  const { supabase, token } = req ? requestSessionClient(req) : { supabase: createRouteHandlerClient({ cookies }), token: undefined };
  const { data: { user }, error } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
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
  const { supabase, token } = requestSessionClient(req);
  const { data: { user }, error: userError } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();

  if (!userError && user) {
    const requestedOrganizationId = String(req.headers.get('x-organization-id') || '').trim() || null;
    let active;
    try {
      ({ active } = await resolveActiveOrganization(supabase, user.id, requestedOrganizationId));
    } catch (error) {
      console.error('[request-auth] Membership validation failed:', error);
      throw new RequestAuthError('Failed to verify organization membership', 500);
    }
    if (!active) {
      throw new RequestAuthError('User does not belong to the requested organization', 403);
    }
    return {
      user,
      organizationId: active.organizationId,
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
    return NextResponse.json({ error: error.message,
      code: error.status === 401 ? 'AUTH_SESSION_EXPIRED' : error.status === 403 ? 'ORGANIZATION_ACCESS_REQUIRED' : 'AUTH_CHECK_UNAVAILABLE',
    }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return null;
}
