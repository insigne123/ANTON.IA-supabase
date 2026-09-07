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

function getConfiguredOrganizationId() {
  const configuredId = String(process.env.ADMIN_DASHBOARD_ORGANIZATION_ID || '').trim();
  if (!configuredId) {
    throw new AdminDashboardAuthError('El panel administrativo no está configurado.', 503);
  }
  return configuredId;
}

function getConfiguredAdminEmails() {
  const emails = String(process.env.ADMIN_DASHBOARD_ALLOWED_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    throw new AdminDashboardAuthError('El acceso del panel administrativo no está configurado.', 503);
  }
  return new Set(emails);
}

export async function requireAdminDashboardAccess(): Promise<AdminDashboardAuthContext> {
  const sessionClient = createRouteHandlerClient({ cookies });
  const { data: { user }, error: userError } = await sessionClient.auth.getUser();
  if (userError || !user) {
    throw new AdminDashboardAuthError('Inicia sesión para abrir el panel administrativo.', 401);
  }

  const configuredOrganizationId = getConfiguredOrganizationId();
  const allowedEmails = getConfiguredAdminEmails();
  const userEmail = String(user.email || '').trim().toLowerCase();
  if (!allowedEmails.has(userEmail)) {
    throw new AdminDashboardAuthError('Tu cuenta no está autorizada para abrir este panel.', 403);
  }
  const supabase = getSupabaseAdminClient();
  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .eq('organization_id', configuredOrganizationId)
    .in('role', ['owner', 'admin'])
    .maybeSingle();

  if (membershipError) {
    console.error('[admin-dashboard-auth] Membership lookup failed:', membershipError);
    throw new AdminDashboardAuthError('No pudimos verificar el acceso administrativo.', 503);
  }
  if (!membership) {
    throw new AdminDashboardAuthError('Necesitas un rol de owner o admin para abrir este panel.', 403);
  }

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', configuredOrganizationId)
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
  };
}

export function adminDashboardAuthErrorResponse(error: unknown) {
  if (error instanceof AdminDashboardAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error('[admin-dashboard-auth] Unexpected error:', error);
  return NextResponse.json({ error: 'No pudimos autorizar el panel administrativo.' }, { status: 500 });
}
