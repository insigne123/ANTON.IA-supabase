import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    if (aa.length !== bb.length) return false;
    return timingSafeEqual(aa, bb);
}

export function hasConfiguredInternalApiSecret(): boolean {
    return String(process.env.INTERNAL_API_SECRET || '').trim().length > 0;
}

export function matchesConfiguredSecret(expectedValue: string | null | undefined, providedValue: string | null | undefined): boolean {
    const expected = String(expectedValue || '').trim();
    const provided = String(providedValue || '').trim();
    if (!expected || !provided) return false;
    return safeEqual(expected, provided);
}

export function isTrustedInternalRequest(req: Request): boolean {
    const expected = String(process.env.INTERNAL_API_SECRET || '').trim();
    if (!expected) return false;

    const provided = String(req.headers.get('x-internal-api-secret') || '').trim();
    return matchesConfiguredSecret(expected, provided);
}
