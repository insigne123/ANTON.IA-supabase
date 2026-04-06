import crypto from 'crypto';

const SECRET_CANDIDATES = Array.from(new Set([
    String(process.env.UNSUBSCRIBE_TOKEN_SECRET || '').trim(),
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    String(process.env.INTERNAL_API_SECRET || '').trim(),
    String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim(),
    'anton-ia-unsubscribe-secret',
].filter(Boolean)));
const SECRET = SECRET_CANDIDATES[0];

const TOKEN_VERSION = 'v1';
const TOKEN_TTL_DAYS = Number(process.env.UNSUBSCRIBE_TOKEN_TTL_DAYS || 3650);

function normalizeEmail(email: string) {
    return String(email || '').trim().toLowerCase();
}

function toBase64Url(buffer: Buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return Buffer.from(padded, 'base64');
}

function getKey(secret = SECRET) {
    return crypto.createHash('sha256').update(secret).digest();
}

export type ResolvedUnsubscribeRequest = {
    email: string;
    userId: string;
    orgId: string | null;
};

export function generateUnsubscribeSignature(email: string, userId: string, orgId?: string | null): string {
    const data = `${email}:${userId}:${orgId || ''}`;
    return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

export function verifyUnsubscribeSignature(email: string, userId: string, orgId: string | null | undefined, signature: string): boolean {
    if (!signature) return false;
    for (const secret of SECRET_CANDIDATES) {
        const expected = crypto.createHmac('sha256', secret).update(`${email}:${userId}:${orgId || ''}`).digest('hex');
        try {
            if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
                return true;
            }
        } catch {
            return false;
        }
    }
    return false;
}

export function generateUnsubscribeToken(email: string, userId: string, orgId?: string | null): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const expiresAt = TOKEN_TTL_DAYS > 0 ? Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 : null;
    const payload = JSON.stringify({
        ver: TOKEN_VERSION,
        email: normalizeEmail(email),
        u: String(userId || '').trim(),
        o: orgId ? String(orgId).trim() : null,
        iat: Date.now(),
        exp: expiresAt,
    });
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [TOKEN_VERSION, toBase64Url(iv), toBase64Url(tag), toBase64Url(encrypted)].join('.');
}

export function parseUnsubscribeToken(token: string | null | undefined): ResolvedUnsubscribeRequest | null {
    const raw = String(token || '').trim();
    if (!raw) return null;

    const parts = raw.split('.');
    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;

    try {
        const iv = fromBase64Url(parts[1]);
        const tag = fromBase64Url(parts[2]);
        const encrypted = fromBase64Url(parts[3]);

        for (const secret of SECRET_CANDIDATES) {
            try {
                const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(secret), iv);
                decipher.setAuthTag(tag);
                const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
                const data = JSON.parse(decrypted) as { email?: string; u?: string; o?: string | null; exp?: number | null; ver?: string };

                if (data.ver !== TOKEN_VERSION) return null;
                if (data.exp && Date.now() > data.exp) return null;

                const email = normalizeEmail(data.email || '');
                const userId = String(data.u || '').trim();
                const orgId = data.o ? String(data.o).trim() : null;

                if (!email || !userId) return null;
                return { email, userId, orgId };
            } catch {
                // try next secret candidate
            }
        }

        return null;
    } catch {
        return null;
    }
}

export function resolveUnsubscribeRequest(input: {
    t?: string | null;
    email?: string | null;
    u?: string | null;
    o?: string | null;
    sig?: string | null;
}): ResolvedUnsubscribeRequest | null {
    const tokenResolved = parseUnsubscribeToken(input.t);
    if (tokenResolved) return tokenResolved;

    const email = String(input.email || '').trim();
    const userId = String(input.u || '').trim();
    const orgId = input.o ? String(input.o).trim() : null;
    const sig = String(input.sig || '').trim();

    if (!email || !userId || !sig) return null;
    if (!verifyUnsubscribeSignature(email, userId, orgId, sig)) return null;

    return {
        email: normalizeEmail(email),
        userId,
        orgId,
    };
}

export function generateUnsubscribeLink(email: string, userId: string, orgId?: string | null): string {
    // Determine base URL (in Vercel/Next it's tricky, we usually use an ENV or window location on client)
    // Server-side generation needs an explicit base URL.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const params = new URLSearchParams();
    params.set('t', generateUnsubscribeToken(email, userId, orgId));

    // Point to the frontend page, not the API directly
    return `${baseUrl}/unsubscribe?${params.toString()}`;
}
