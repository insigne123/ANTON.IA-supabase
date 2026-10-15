import type { NextResponse } from 'next/server';
import { ResponseCookies } from 'next/dist/server/web/spec-extension/cookies.js';

/**
 * auth-helpers writes a refreshed session as a raw Set-Cookie header, which the Server Components of the same request
 * never see: «Oportunidades» then refreshed the session again and could not save it (a 500 after an hour away). Setting
 * the same cookies through res.cookies also hands them to the render; the browser still receives each one once.
 */
export function forwardSessionCookies(res: NextResponse) {
    for (const cookie of new ResponseCookies(res.headers).getAll()) res.cookies.set(cookie);
    return res;
}
