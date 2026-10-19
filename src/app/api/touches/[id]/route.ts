import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { bridgeConfig, e164, startBridgeCall } from '@/lib/server/call-bridge';
import { TouchError, finishTouch, prepareTouchScript, readTouch, readTouchContacts, readTouchProfile, readTouches } from '@/lib/server/touches';
import { readTouchCadence } from '@/lib/touches';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('done'), outcome: z.string().trim().min(2).max(40), note: z.string().max(2000).optional() }).strict(),
  z.object({ action: z.literal('skip') }).strict(),
  z.object({ action: z.literal('script'), fresh: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('call') }).strict(),
]);

/** One touch: «Hecho», «Saltar», its script, or a call from ANTON.IA when the bridge is on. */
export async function POST(req: NextRequest, context: Context) {
  try {
    const auth = await requireAuth();
    const id = z.string().uuid().parse((await context.params).id);
    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    const admin = getSupabaseAdminClient();
    if (body.data.action === 'script') return NextResponse.json(await prepareTouchScript(admin, scope, id, { fresh: body.data.fresh }), { headers: noStore });
    if (body.data.action === 'call') {
      const config = bridgeConfig();
      if (!config) throw new AuthError('Llamar desde ANTON.IA aún no está activado. Usa tu teléfono y sube la grabación si quieres el resumen.', 409);
      const touch = await readTouch(admin, scope, id);
      if (touch.channel !== 'call') throw new AuthError('Esa tarea no es una llamada.', 400);
      const { profile } = await readTouchProfile(admin, scope);
      const seller = readTouchCadence(profile?.signatures)?.phone;
      if (!seller) throw new AuthError('Agrega tu teléfono en «Ajustar» para que ANTON.IA te llame primero.', 409);
      const today = await readTouches(admin, scope);
      const view = today.touches.find(item => item.id === id);
      const [contact] = await readTouchContacts(admin, scope, { ids: [touch.contacted_id] });
      const contactPhone = e164(view?.contact.phone);
      if (!contactPhone || !contact) throw new AuthError('Ese contacto no tiene un teléfono para llamar.', 409);
      const base = String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
      const sid = await startBridgeCall(config, { sellerPhone: seller, contactPhone, contactName: String(contact.name || 'tu contacto'),
        recordingCallback: `${base}/api/touches/twilio/recording?touch=${id}` });
      if (!sid) throw new AuthError('No pudimos iniciar la llamada. Intenta de nuevo o llama desde tu teléfono.', 502);
      return NextResponse.json({ calling: true }, { headers: noStore });
    }
    return NextResponse.json(await finishTouch(admin, scope, id, body.data), { headers: noStore });
  } catch (error) {
    return handleAuthError(error instanceof TouchError ? new AuthError(error.message, error.status) : error);
  }
}
