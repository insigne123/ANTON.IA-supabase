import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export type OpenClawClaims = {
    v: 1;
    sub: 'openclaw';
    orgId: string;
    scopes: string[];
    iat: number;
    exp: number;
    jti: string;
};

export class OpenClawAuthError extends Error {
    status: number;
    code: string;

    constructor(message: string, status = 401, code = 'OPENCLAW_AUTH_ERROR') {
        super(message);
        this.name = 'OpenClawAuthError';
        this.status = status;
        this.code = code;
    }
}

function safeEqual(a: string, b: string): boolean {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    if (aa.length !== bb.length) return false;
    return timingSafeEqual(aa, bb);
}

function b64urlEncode(value: string | Buffer): string {
    return Buffer.from(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function b64urlDecode(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = pad === 0 ? normalized : normalized + '='.repeat(4 - pad);
    return Buffer.from(padded, 'base64').toString('utf8');
}

function parseCsv(raw: string): string[] {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function normalizeScopes(scopes: string[]): string[] {
    const unique = new Set<string>();
    for (const scope of scopes) {
        const normalized = String(scope || '').trim();
        if (!normalized) continue;
        unique.add(normalized);
    }
    return Array.from(unique.values());
}

function scopeMatches(granted: string, required: string): boolean {
    if (granted === '*') return true;
    if (granted === required) return true;

    if (granted.endsWith(':*')) {
        const prefix = granted.slice(0, -2);
        return required === prefix || required.startsWith(`${prefix}:`);
    }

    if (granted.endsWith('*')) {
        const prefix = granted.slice(0, -1);
        return required.startsWith(prefix);
    }

    return false;
}

function assertConfig(name: string, value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        throw new OpenClawAuthError(`Missing ${name} configuration`, 500, 'OPENCLAW_CONFIG_ERROR');
    }
    return trimmed;
}

function getTokenSecret(): string {
    return assertConfig('OPENCLAW_TOKEN_SECRET', process.env.OPENCLAW_TOKEN_SECRET || '');
}

function getOrgId(): string {
    return assertConfig('OPENCLAW_ORG_ID', process.env.OPENCLAW_ORG_ID || '');
}

function getAllowedApiKeys(): string[] {
    const fromList = parseCsv(String(process.env.OPENCLAW_API_KEYS || ''));
    const fromSingle = String(process.env.OPENCLAW_API_KEY || '').trim();

    const keys = fromSingle ? [...fromList, fromSingle] : fromList;
    const normalized = normalizeScopes(keys);

    if (!normalized.length) {
        throw new OpenClawAuthError(
            'Missing OPENCLAW_API_KEY/OPENCLAW_API_KEYS configuration',
            500,
            'OPENCLAW_CONFIG_ERROR'
        );
    }

    return normalized;
}

function getDefaultScopes(): string[] {
    const configured = parseCsv(String(process.env.OPENCLAW_SCOPES || ''));
    if (configured.length) return normalizeScopes(configured);

    return [
        'system:read',
        'missions:read',
        'missions:write',
        'tasks:read',
        'tasks:admin',
        'leads:read',
        'leads:write',
        'campaigns:read',
        'campaigns:write',
        'campaigns:run',
        'contacted:read',
        'contacted:write',
    ];
}

function getTtlSeconds(): number {
    const raw = Number(process.env.OPENCLAW_TOKEN_TTL_SECONDS || 1800);
    if (!Number.isFinite(raw)) return 1800;
    const rounded = Math.floor(raw);
    return Math.min(Math.max(rounded, 60), 86400);
}

function signRaw(raw: string, secret: string): string {
    return b64urlEncode(createHmac('sha256', secret).update(raw).digest());
}

export function validateOpenClawApiKey(providedKey: string): boolean {
    const candidate = String(providedKey || '').trim();
    if (!candidate) return false;

    const keys = getAllowedApiKeys();
    for (const key of keys) {
        if (safeEqual(candidate, key)) return true;
    }
    return false;
}

export function issueOpenClawToken(input?: {
    scopes?: string[];
    ttlSeconds?: number;
}): {
    token: string;
    claims: OpenClawClaims;
    expiresIn: number;
} {
    const tokenSecret = getTokenSecret();
    const orgId = getOrgId();
    const now = Math.floor(Date.now() / 1000);
    const baseTtl = getTtlSeconds();
    const requestedTtl = Number(input?.ttlSeconds);
    const ttlSeconds = Number.isFinite(requestedTtl)
        ? Math.min(Math.max(Math.floor(requestedTtl), 60), baseTtl)
        : baseTtl;

    const defaultScopes = getDefaultScopes();
    const requestedScopes = Array.isArray(input?.scopes) ? normalizeScopes(input.scopes) : [];

    let scopes = defaultScopes;
    if (requestedScopes.length > 0) {
        if (defaultScopes.includes('*')) {
            scopes = requestedScopes;
        } else {
            scopes = requestedScopes.filter((scope) =>
                defaultScopes.some((granted) => scopeMatches(granted, scope))
            );
        }
    }

    scopes = normalizeScopes(scopes);
    if (!scopes.length) {
        throw new OpenClawAuthError('No scopes granted for token', 403, 'OPENCLAW_SCOPE_DENIED');
    }

    const claims: OpenClawClaims = {
        v: 1,
        sub: 'openclaw',
        orgId,
        scopes,
        iat: now,
        exp: now + ttlSeconds,
        jti: randomUUID(),
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = b64urlEncode(JSON.stringify(header));
    const encodedPayload = b64urlEncode(JSON.stringify(claims));
    const signature = signRaw(`${encodedHeader}.${encodedPayload}`, tokenSecret);
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;

    return { token, claims, expiresIn: ttlSeconds };
}

export function verifyOpenClawToken(token: string): OpenClawClaims {
    const value = String(token || '').trim();
    if (!value) {
        throw new OpenClawAuthError('Missing token', 401, 'OPENCLAW_TOKEN_MISSING');
    }

    const parts = value.split('.');
    if (parts.length !== 3) {
        throw new OpenClawAuthError('Malformed token', 401, 'OPENCLAW_TOKEN_MALFORMED');
    }

    const [headerPart, payloadPart, signaturePart] = parts;
    const secret = getTokenSecret();
    const expectedSignature = signRaw(`${headerPart}.${payloadPart}`, secret);
    if (!safeEqual(signaturePart, expectedSignature)) {
        throw new OpenClawAuthError('Invalid token signature', 401, 'OPENCLAW_TOKEN_INVALID');
    }

    let parsed: OpenClawClaims;
    try {
        parsed = JSON.parse(b64urlDecode(payloadPart));
    } catch {
        throw new OpenClawAuthError('Invalid token payload', 401, 'OPENCLAW_TOKEN_PAYLOAD_INVALID');
    }

    if (!parsed || parsed.sub !== 'openclaw' || parsed.v !== 1) {
        throw new OpenClawAuthError('Invalid token claims', 401, 'OPENCLAW_TOKEN_CLAIMS_INVALID');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!parsed.exp || parsed.exp <= now) {
        throw new OpenClawAuthError('Token expired', 401, 'OPENCLAW_TOKEN_EXPIRED');
    }

    const configuredOrg = getOrgId();
    if (parsed.orgId !== configuredOrg) {
        throw new OpenClawAuthError('Token organization mismatch', 403, 'OPENCLAW_ORG_MISMATCH');
    }

    return parsed;
}

export function assertScopes(claims: OpenClawClaims, requiredScopes: string[] = []) {
    if (!requiredScopes.length) return;
    const granted = claims.scopes || [];

    const missing = requiredScopes.filter((required) =>
        !granted.some((scope) => scopeMatches(scope, required))
    );

    if (missing.length > 0) {
        throw new OpenClawAuthError(
            `Missing required scope(s): ${missing.join(', ')}`,
            403,
            'OPENCLAW_SCOPE_MISSING'
        );
    }
}

export function authenticateOpenClawRequest(req: Request, requiredScopes: string[] = []): OpenClawClaims {
    const authHeader = String(req.headers.get('authorization') || '').trim();
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
        throw new OpenClawAuthError('Missing bearer token', 401, 'OPENCLAW_BEARER_MISSING');
    }

    const claims = verifyOpenClawToken(token);
    assertScopes(claims, requiredScopes);
    return claims;
}
