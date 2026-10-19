import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { bridgeConfig, e164 } from '@/lib/server/call-bridge';
import { TouchError, readTouches, saveTouchCadence, scheduleTouch } from '@/lib/server/touches';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const toAuthError = (error: unknown) => (error instanceof TouchError ? new AuthError(error.message, error.status) : error);

/** «Llamadas y LinkedIn» of the signed-in person for «Hoy» (src/lib/touches.ts). */
export async function GET() {
  try {
    const auth = await requireAuth();
    const result = await readTouches(getSupabaseAdminClient(), { organizationId: auth.organizationId, userId: auth.user.id });
    return NextResponse.json({ ...result, bridge: Boolean(bridgeConfig()) }, { headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}

const Channel = z.object({ on: z.boolean(), day: z.number().int().min(1).max(30) }).strict();
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cadence'), call: Channel, linkedin: Channel, phone: z.string().trim().max(30).nullable().optional() }).strict(),
  z.object({ action: z.literal('schedule'), contactedId: z.string().trim().min(1).max(200), channel: z.enum(['call', 'linkedin']), dueAt: z.string().datetime({ offset: true }) }).strict(),
]);

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    const admin = getSupabaseAdminClient();
    if (body.data.action === 'cadence') {
      const phone = body.data.phone === undefined ? undefined : body.data.phone ? e164(body.data.phone) : null;
      if (body.data.phone && !phone) throw new AuthError('Revisa tu teléfono: escríbelo con el código del país, como +56 9 1234 5678.', 400);
      return NextResponse.json(await saveTouchCadence(admin, scope, { call: body.data.call, linkedin: body.data.linkedin, phone }), { headers: noStore });
    }
    return NextResponse.json(await scheduleTouch(admin, scope, body.data), { status: 201, headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}
