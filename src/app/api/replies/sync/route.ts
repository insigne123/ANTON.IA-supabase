import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { syncRepliesForOrganization } from '@/lib/server/reply-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { user, organizationId } = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const limit = Number(body?.limit || 200);
    const result = await syncRepliesForOrganization(getSupabaseAdminClient(), {
      organizationId,
      userId: user.id,
      limit,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleAuthError(error);
  }
}
