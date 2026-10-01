import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';
import { MAIL_PROVIDER_LABEL } from '@/lib/mail-sender';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** The person's mailboxes and the one that sends by default. No tokens. */
export async function GET() {
  try {
    const auth = await requireAuth();
    return NextResponse.json(await readMailSenderPreference(getSupabaseAdminClient(), auth.user.id), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo leer tu remitente.' }, { status: 503, headers });
  }
}

const choiceSchema = z.object({ provider: z.enum(['google', 'outlook']).nullable() }).strict();

/** Chooses the mailbox that sends by default; only one that is connected. Saved on the person's own profile. */
export async function PUT(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const parsed = choiceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Elige Gmail u Outlook.' }, { status: 400, headers });
    const { provider } = parsed.data;
    const admin = getSupabaseAdminClient();
    const current = await readMailSenderPreference(admin, auth.user.id);
    if (provider && !current.connected[provider]) {
      return NextResponse.json({ error: `Conecta ${MAIL_PROVIDER_LABEL[provider]} antes de elegirla para enviar.` }, { status: 409, headers });
    }
    // The person's own row, under the policies of profiles.
    const saved = await auth.supabase.from('profiles').update({ default_mail_provider: provider }).eq('id', auth.user.id).select('id').maybeSingle();
    if (saved.error || !saved.data) return NextResponse.json({ error: 'No se pudo guardar tu remitente. Inténtalo de nuevo.' }, { status: 503, headers });
    return NextResponse.json(await readMailSenderPreference(admin, auth.user.id), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo guardar tu remitente. Inténtalo de nuevo.' }, { status: 503, headers });
  }
}
