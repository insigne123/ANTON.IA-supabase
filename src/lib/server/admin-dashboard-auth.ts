import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type AdminDashboardAuthContext = {
  user: any;
  organizationId: string;
  organizationName: string;
  supabase: ReturnType<typeof getSupabaseAdminClient>;
};

export class AdminDashboardAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminDashboardAuthError';
    this.status = status;
  }
}

function configuredOrganizationMatches(organization: { id: string; name: string }) {
  const configuredId = String(process.env.ADMIN_DASHBOARD_ORGANIZATION_ID || '').trim();
  const configuredName = String(process.env.ADMIN_DASHBOARD_ORGANIZATION_NAME || 'GrupoExpro').trim();

  if (configuredId) return configuredId === organization.id;
  if (!configuredName) return true;
  return organization.name.trim().toLowerCase() === configuredName.toLowerCase();
}

export async function requireAdminDashboardAccess(): Promise<AdminDashboardAuthContext> {
  const sessionClient = createRouteHandlerClient({ cookies });
  const { data: { user }, error: userError } = await sessionClient.auth.getUser();
  if (userError || !user) {
    throw new AdminDashboardAuthError('Unauthorized', 401);
  }

  const supabase = getSupabaseAdminClient();
  const { data: memberships, error: membershipsError } = await supabase
    .from('organization_members')
    .select('organization_id, role, created_at')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .order('created_at', { ascending: true });

  if (membershipsError) {
    console.error('[admin-dashboard-auth] Membership lookup failed:', membershipsError);
    throw new AdminDashboardAuthError('Unable to verify admin access', 503);
  }

  const organizationIds = (memberships || [])
    .map((membership: any) => String(membership.organization_id || '').trim())
    .filter(Boolean);

  if (organizationIds.length === 0) {
    throw new AdminDashboardAuthError('Admin access required', 403);
  }

  const { data: organizations, error: organizationsError } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', organizationIds);

  if (organizationsError) {
    console.error('[admin-dashboard-auth] Organization lookup failed:', organizationsError);
    throw new AdminDashboardAuthError('Unable to verify organization access', 503);
  }

  const organization = (organizations || []).find((candidate: any) => configuredOrganizationMatches({
    id: String(candidate.id),
    name: String(candidate.name || ''),
  }));

  if (!organization) {
    throw new AdminDashboardAuthError('This admin portal is not enabled for your organization', 403);
  }

  return {
    user,
    organizationId: String(organization.id),
    organizationName: String(organization.name || 'Organización'),
    supabase,
  };
}

export function adminDashboardAuthErrorResponse(error: unknown) {
  if (error instanceof AdminDashboardAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error('[admin-dashboard-auth] Unexpected error:', error);
  return NextResponse.json({ error: 'Unable to authorize admin dashboard' }, { status: 500 });
}
