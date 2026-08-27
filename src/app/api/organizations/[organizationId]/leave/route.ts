import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import { assertOrganizationAccess, organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

const ParamsSchema = z.object({ organizationId: z.string().uuid() }).strict();

export async function POST(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);
    const { data, error } = await auth.supabase.rpc('leave_organization_v1', { p_organization_id: params.organizationId });
    if (error) throw error;
    return NextResponse.json({ left: Boolean(data) }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_LEAVE_FAILED');
  }
}
