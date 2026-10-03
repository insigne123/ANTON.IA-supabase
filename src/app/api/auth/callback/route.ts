import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { safeNextPath } from '@/lib/safe-next-path';

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    // Only a path of this app: a link to the callback cannot send the new session to another site.
    const next = safeNextPath(requestUrl.searchParams.get('next'), '/');

    // Supabase sends `error` instead of `code` when the link expired or was already used.
    if (requestUrl.searchParams.get('error')) return NextResponse.redirect(new URL('/login?enlace=vencido', requestUrl.origin));

    if (code) {
        const cookieStore = cookies();
        const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        // An expired link, or one opened in another browser (the code verifier lives in the first one).
        if (error) return NextResponse.redirect(new URL('/login?enlace=vencido', requestUrl.origin));
    }

    return NextResponse.redirect(new URL(next, requestUrl.origin));
}
