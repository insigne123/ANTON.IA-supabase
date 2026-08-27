import { NextResponse } from 'next/server';
import { z } from 'zod';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/lib/server/organization-context';
import { organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();

export async function GET() {
  try {
    const auth = await requireAuth();
    const organizationIds = auth.organizationIds;
    const [organizationsResult, membersResult] = await Promise.all([
      auth.supabase.from('organizations').select('id,name').in('id', organizationIds),
      auth.supabase.from('organization_members').select('organization_id').in('organization_id', organizationIds),
    ]);
    if (organizationsResult.error) throw organizationsResult.error;
    if (membersResult.error) throw membersResult.error;

    const counts = new Map<string, number>();
    for (const member of membersResult.data || []) {
      const id = String(member.organization_id);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    const details = new Map<string, { id: string; name: string }>(
      (organizationsResult.data || []).map((organization: any) => [String(organization.id), organization]),
    );
    const organizations = (auth.memberships || []).map((membership) => ({
      id: membership.organizationId,
      name: String(details.get(membership.organizationId)?.name || 'Workspace'),
      role: membership.role,
      memberCount: counts.get(membership.organizationId) || 0,
    }));

    const response = NextResponse.json({ activeOrganizationId: auth.organizationId, organizations }, { headers: organizationNoStoreHeaders });
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, auth.organizationId, activeOrganizationCookieOptions());
    return response;
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    return organizationApiError(error, 'ORGANIZATIONS_READ_FAILED');
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    const parsed = CreateOrganizationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Organization name is invalid' }, { status: 400, headers: organizationNoStoreHeaders });
    }
    const { data, error } = await auth.supabase.rpc('create_new_organization', { org_name: parsed.data.name });
    if (error) throw error;
    const organizationId = String(data || '');
    const response = NextResponse.json({ organizationId }, { status: 201, headers: organizationNoStoreHeaders });
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, activeOrganizationCookieOptions());
    return response;
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_CREATE_FAILED');
  }
}
