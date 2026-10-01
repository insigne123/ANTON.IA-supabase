import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { resolveActiveOrganization } from '@/lib/server/organization-context';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type AdminDashboardAuthContext = {
  user: any;
  organizationId: string;
  organizationName: string;
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  /** Credit limits cost the platform money: only the operators in ADMIN_DASHBOARD_ALLOWED_EMAILS change them. */
  canManageCredits: boolean;
};

export class AdminDashboardAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminDashboardAuthError';
    this.status = status;
  }
}

function platformOperatorEmails() {
  return new Set(String(process.env.ADMIN_DASHBOARD_ALLOWED_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

/**
 * The panel of the person's active organization, for its owners and admins. Every read below is scoped to that
 * organization id, which comes from the signed-in membership and never from the request.
 */
export async function requireAdminDashboardAccess(options: { manageCredits?: boolean } = {}): Promise<AdminDashboardAuthContext> {
  const sessionClient = createRouteHandlerClient({ cookies });
  const { data: { user }, error: userError } = await sessionClient.auth.getUser();
  if (userError || !user) {
    throw new AdminDashboardAuthError('Inicia sesión para abrir el panel administrativo.', 401);
  }

  let activeOrganizationId = '';
  try {
    const resolved = await resolveActiveOrganization(sessionClient, user.id);
    activeOrganizationId = String(resolved.active?.organizationId || '');
  } catch (error) {
    console.error('[admin-dashboard-auth] Organization lookup failed:', error);
    throw new AdminDashboardAuthError('No pudimos verificar el acceso administrativo.', 503);
  }
  if (!activeOrganizationId) {
    throw new AdminDashboardAuthError('Necesitas pertenecer a una organización para abrir este panel.', 403);
  }

  // The role is checked again with the service client, so a stale client-side role never opens the panel.
  const supabase = getSupabaseAdminClient();
  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .eq('organization_id', activeOrganizationId)
    .in('role', ['owner', 'admin'])
    .maybeSingle();

  if (membershipError) {
    console.error('[admin-dashboard-auth] Membership lookup failed:', membershipError);
    throw new AdminDashboardAuthError('No pudimos verificar el acceso administrativo.', 503);
  }
  if (!membership) {
    throw new AdminDashboardAuthError('Necesitas un rol de owner o admin para abrir este panel.', 403);
  }

  const canManageCredits = platformOperatorEmails().has(String(user.email || '').trim().toLowerCase());
  if (options.manageCredits && !canManageCredits) {
    throw new AdminDashboardAuthError('Los límites de créditos los cambia el equipo de ANTON.IA. Escríbenos si tu equipo necesita más.', 403);
  }

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', activeOrganizationId)
    .maybeSingle();

  if (organizationError || !organization) {
    console.error('[admin-dashboard-auth] Organization lookup failed:', organizationError);
    throw new AdminDashboardAuthError('No pudimos verificar la organización del panel.', 503);
  }

  return {
    user,
    organizationId: String(organization.id),
    organizationName: String(organization.name || 'Organización'),
    supabase,
    canManageCredits,
  };
}

export function adminDashboardAuthErrorResponse(error: unknown) {
  if (error instanceof AdminDashboardAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error('[admin-dashboard-auth] Unexpected error:', error);
  return NextResponse.json({ error: 'No pudimos autorizar el panel administrativo.' }, { status: 500 });
}
