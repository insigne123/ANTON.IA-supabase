import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { recoveryTokenHash } from '@/lib/recovery-link';

const reply = (body: { ok: true } | { error: 'vencido' }, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Spends the one-time token of a reset link, when the person presses «Continuar» on /restablecer-clave (see recovery-link.ts). The session it
 * opens is set in this response's cookies, so the page reloads already signed in and asks for the new password. A POST with a token is the only
 * way to spend it: opening the link, even by a mail filter that follows every link, changes nothing.
 */
export async function POST(request: Request) {
    let token: string | null = null;
    try {
        const body = await request.json() as { tokenHash?: unknown };
        token = recoveryTokenHash(new URLSearchParams({ type: 'recovery', token_hash: typeof body?.tokenHash === 'string' ? body.tokenHash : '' }));
    } catch { /* not JSON: not a token */ }
    if (!token) return reply({ error: 'vencido' }, 400);

    const cookieStore = await cookies();
    // auth-helpers 0.10 reads the store synchronously; the runtime needs the resolved store (see the callback).
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as unknown as ReturnType<typeof cookies> });
    const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' });
    if (error) {
        // Only the error code and status: never the token, the email or the provider's message.
        console.warn('[auth/recovery] token rejected', {
            code: typeof error.code === 'string' && /^[a-z_]{1,80}$/.test(error.code) ? error.code : 'unknown',
            status: error.status,
        });
        return reply({ error: 'vencido' }, 410);
    }
    return reply({ ok: true }, 200);
}
