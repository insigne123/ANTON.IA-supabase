import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { markReconnect, readReconnectAlerts, ReconnectError, saveReconnectSettings } from '@/lib/server/reconnect';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };

/** «Para retomar»: the person's own conversations worth reopening (src/lib/reconnect.ts). */
export async function GET() {
  try {
    const auth = await requireAuth();
    const result = await readReconnectAlerts(getSupabaseAdminClient(), { organizationId: auth.organizationId, userId: auth.user.id });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return handleAuthError(error instanceof ReconnectError ? new AuthError(error.message, error.status) : error);
  }
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['snooze', 'dismiss', 'restore']), contactedId: z.string().trim().min(1).max(200), days: z.number().int().min(1).max(180).optional() }).strict(),
  z.object({ action: z.literal('settings'), afterDays: z.number().int() }).strict(),
]);

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    const admin = getSupabaseAdminClient();
    const result = body.data.action === 'settings'
      ? await saveReconnectSettings(admin, scope, body.data.afterDays)
      : await markReconnect(admin, scope, body.data);
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return handleAuthError(error instanceof ReconnectError ? new AuthError(error.message, error.status) : error);
  }
}
