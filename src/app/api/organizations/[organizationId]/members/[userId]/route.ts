import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import { assertOrganizationAccess, organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

const ParamsSchema = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid() }).strict();
const UpdateRoleSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string; userId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);
    const body = UpdateRoleSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'Role is invalid' }, { status: 400, headers: organizationNoStoreHeaders });
    const { data, error } = await auth.supabase.rpc('update_organization_member_role_v1', {
      p_organization_id: params.organizationId,
      p_user_id: params.userId,
      p_role: body.data.role,
    });
    if (error) throw error;
    return NextResponse.json({ updated: Boolean(data) }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_MEMBER_UPDATE_FAILED');
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; userId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);
    const { data, error } = await auth.supabase.rpc('remove_organization_member_v1', {
      p_organization_id: params.organizationId,
      p_user_id: params.userId,
    });
    if (error) throw error;
    return NextResponse.json({ removed: Boolean(data) }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_MEMBER_REMOVE_FAILED');
  }
}
