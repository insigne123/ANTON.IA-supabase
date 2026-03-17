import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
    const requestHost = req.nextUrl.hostname.toLowerCase();
    const backendHostedAppHost = String(process.env.BACKEND_HOSTED_APP_URL || 'https://studio--studio-6624658482-61b7b.us-central1.hosted.app').trim();
    const backendHostedAppHostName = (() => {
        try {
            return new URL(backendHostedAppHost).hostname.toLowerCase();
        } catch {
            return 'studio--studio-6624658482-61b7b.us-central1.hosted.app';
        }
    })();
    const canonicalAppUrl = String(process.env.CANONICAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://studio--leadflowai-3yjcy.us-central1.hosted.app').trim();

    if (requestHost === backendHostedAppHostName && canonicalAppUrl) {
        const redirectTarget = new URL(req.nextUrl.pathname + req.nextUrl.search, canonicalAppUrl.endsWith('/') ? canonicalAppUrl : `${canonicalAppUrl}/`);
        return NextResponse.redirect(redirectTarget, 307);
    }

    const backendOnlyMode = String(process.env.BACKEND_ONLY_MODE || 'false').toLowerCase() === 'true';
    const backendRedirectUrl = String(process.env.BACKEND_REDIRECT_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
    const pathname = req.nextUrl.pathname;

    if (backendOnlyMode && backendRedirectUrl) {
        const redirectTarget = new URL(pathname + req.nextUrl.search, backendRedirectUrl.endsWith('/') ? backendRedirectUrl : `${backendRedirectUrl}/`);
        return NextResponse.redirect(redirectTarget, 307);
    }

    const res = NextResponse.next();
    const supabase = createMiddlewareClient({ req, res });

    const {
        data: { session },
    } = await supabase.auth.getSession();

    // If user is signed in and the current path is /login, redirect the user to /dashboard
    if (session && pathname === '/login') {
        return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    // Allow some public routes (unsubscribe, invites, privacy) even without session.
    // Note: the matcher also skips most static assets; this is just an extra guard.
    const isPublicRoute =
        pathname === '/login' ||
        pathname === '/unsubscribe' ||
        pathname.startsWith('/invite') ||
        pathname.startsWith('/privacy');

    if (!session && !isPublicRoute && !pathname.startsWith('/api/auth')) {
        return NextResponse.redirect(new URL('/login', req.url));
    }

    return res;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - privacy (privacy policy pages)
         * - public routes (unsubscribe, invite)
         * - any path containing a dot (static assets like .png/.json)
         */
        '/((?!api|_next/static|_next/image|favicon.ico|privacy|unsubscribe|invite|.*\\..*).*)',
    ],
};
