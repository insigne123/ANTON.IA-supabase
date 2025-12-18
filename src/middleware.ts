import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
    const res = NextResponse.next();
    const supabase = createMiddlewareClient({ req, res });

    const {
        data: { session },
    } = await supabase.auth.getSession();

    // If user is signed in and the current path is /login, redirect the user to /
    if (session && req.nextUrl.pathname === '/login') {
        return NextResponse.redirect(new URL('/', req.url));
    }

    // If user is not signed in and the current path is not /login, redirect the user to /login
    if (!session && req.nextUrl.pathname !== '/login' && !req.nextUrl.pathname.startsWith('/api/auth')) {
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
         */
        '/((?!api|_next/static|_next/image|favicon.ico|privacy).*)',
    ],
};
