import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { OpenTrackingError, readOpenTracking, saveOpenTracking } from '@/lib/server/open-tracking';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const toAuthError = (error: unknown) => (error instanceof OpenTrackingError ? new AuthError(error.message, error.status) : error);

/** «Medir aperturas» of the organization (src/lib/server/open-tracking.ts): whether it is on, and whether this person may change it. */
export async function GET() {
  try {
    const auth = await requireAuth();
    const admin = getSupabaseAdminClient();
    const [enabled, member] = await Promise.all([
      readOpenTracking(admin, auth.organizationId),
      admin.from('organization_members').select('role').eq('organization_id', auth.organizationId).eq('user_id', auth.user.id).maybeSingle(),
    ]);
    return NextResponse.json({ enabled, canEdit: ['owner', 'admin'].includes(String((member as any).data?.role || '')) }, { headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}

const BodySchema = z.object({ enabled: z.boolean() }).strict();

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const saved = await saveOpenTracking(getSupabaseAdminClient(), { organizationId: auth.organizationId, userId: auth.user.id }, body.data.enabled);
    return NextResponse.json(saved, { headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}
