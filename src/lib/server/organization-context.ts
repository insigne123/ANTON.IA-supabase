import { cookies } from 'next/headers';

import {
  selectActiveOrganizationMembership,
  type OrganizationMembership,
} from '@/lib/organization-scope';

export type { OrganizationMembership } from '@/lib/organization-scope';

export const ACTIVE_ORGANIZATION_COOKIE = 'antonia-active-organization';

export async function listOrganizationMemberships(supabase: any, userId: string): Promise<OrganizationMembership[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id, role, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data || []).map((row: any) => ({
    organizationId: String(row.organization_id),
    role: row.role as OrganizationMembership['role'],
    createdAt: String(row.created_at),
  }));
}

export async function resolveActiveOrganization(
  supabase: any,
  userId: string,
  requestedOrganizationId?: string | null,
) {
  const memberships = await listOrganizationMemberships(supabase, userId);
  if (memberships.length === 0) return { active: null, memberships };

  const cookieStore = await cookies();
  const requested = String(requestedOrganizationId || '').trim();
  const stored = String(cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value || '').trim();
  const active = selectActiveOrganizationMembership(memberships, requested, stored);

  return { active, memberships };
}

export function activeOrganizationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  };
}
