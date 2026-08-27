import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import { assertOrganizationAccess, organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

const ParamsSchema = z.object({ organizationId: z.string().uuid(), inviteId: z.string().uuid() }).strict();

export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; inviteId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);
    const inviteResult = await auth.supabase
      .from('organization_invites')
      .select('id')
      .eq('id', params.inviteId)
      .eq('organization_id', params.organizationId)
      .maybeSingle();
    if (inviteResult.error) throw inviteResult.error;
    if (!inviteResult.data) return NextResponse.json({ error: 'Invitation not found' }, { status: 404, headers: organizationNoStoreHeaders });

    const { data, error } = await auth.supabase.rpc('revoke_organization_invite_v1', { p_invite_id: params.inviteId });
    if (error) throw error;
    return NextResponse.json({ revoked: Boolean(data) }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_INVITE_REVOKE_FAILED');
  }
}
