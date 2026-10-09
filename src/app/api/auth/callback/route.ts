import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { safeNextPath } from '@/lib/safe-next-path';
import { authCallbackOrigin } from '@/lib/server/auth-callback-origin';

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    let origin: string;
    try {
        origin = authCallbackOrigin(requestUrl);
    } catch {
        return NextResponse.json({ error: 'No se pudo abrir el enlace. Intenta de nuevo más tarde.' }, {
            status: 503, headers: { 'Cache-Control': 'no-store' },
        });
    }
    const redirect = (path: string) => {
        const response = NextResponse.redirect(new URL(path, origin));
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
    };
    const code = requestUrl.searchParams.get('code');
    // Only a path of this app: a link to the callback cannot send the new session to another site.
    const next = safeNextPath(requestUrl.searchParams.get('next'), '/');
    const recovery = requestUrl.searchParams.get('type') === 'recovery';
    const tokenHash = requestUrl.searchParams.get('token_hash');

    // Supabase sends `error` instead of `code` when the link expired or was already used.
    if (requestUrl.searchParams.get('error')) return redirect('/login?enlace=vencido');

    if (code || tokenHash) {
        const cookieStore = await cookies();
        // auth-helpers 0.10 reads the store synchronously. Its declaration uses
        // Next's now-async cookies() type, but the runtime needs the resolved store.
        const supabase = createRouteHandlerClient({ cookies: () => cookieStore as unknown as ReturnType<typeof cookies> });
        // Token-hash recovery links also work when opened in another browser.
        // Keep OAuth/PKCE exchange unchanged; never accept an arbitrary OTP type.
        const { error } = tokenHash
            ? recovery && /^[A-Za-z0-9_-]{1,256}$/.test(tokenHash)
                ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
                : { error: { code: 'invalid_recovery_link', status: 400 } }
            : await supabase.auth.exchangeCodeForSession(code!);
        // An expired link, or one opened in another browser (the code verifier lives in the first one).
        if (error) {
            // Diagnose a failed exchange without logging the code, verifier,
            // token, email, URL or raw provider message.
            console.warn('[auth/callback] code exchange failed', {
                code: typeof error.code === 'string' && /^[a-z_]{1,80}$/.test(error.code) ? error.code : 'unknown',
                status: error.status,
            });
            return redirect('/login?enlace=vencido');
        }
    }

    return redirect(recovery && (code || tokenHash) ? '/restablecer-clave' : next);
}
