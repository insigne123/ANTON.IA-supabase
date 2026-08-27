import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/lib/server/organization-context';
import { organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

export const dynamic = 'force-dynamic';

const ActiveOrganizationSchema = z.object({ organizationId: z.string().uuid() }).strict();

export async function PUT(request: Request) {
  try {
    const auth = await requireAuth();
    const parsed = ActiveOrganizationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Organization is invalid' }, { status: 400, headers: organizationNoStoreHeaders });
    }
    if (!auth.organizationIds.includes(parsed.data.organizationId)) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404, headers: organizationNoStoreHeaders });
    }

    const response = NextResponse.json({ activeOrganizationId: parsed.data.organizationId }, { headers: organizationNoStoreHeaders });
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, parsed.data.organizationId, activeOrganizationCookieOptions());
    return response;
  } catch (error) {
    return organizationApiError(error, 'ACTIVE_ORGANIZATION_UPDATE_FAILED');
  }
}
