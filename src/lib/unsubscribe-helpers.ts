import crypto from 'crypto';

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'default_secret';

export function generateUnsubscribeSignature(email: string, userId: string, orgId?: string | null): string {
    const data = `${email}:${userId}:${orgId || ''}`;
    return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

export function verifyUnsubscribeSignature(email: string, userId: string, orgId: string | null | undefined, signature: string): boolean {
    if (!signature) return false;
    const expected = generateUnsubscribeSignature(email, userId, orgId);
    return expected === signature;
}

export function generateUnsubscribeLink(email: string, userId: string, orgId?: string | null): string {
    // Determine base URL (in Vercel/Next it's tricky, we usually use an ENV or window location on client)
    // Server-side generation needs an explicit base URL.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const sig = generateUnsubscribeSignature(email, userId, orgId);

    const params = new URLSearchParams();
    params.set('email', email);
    params.set('u', userId);
    if (orgId) params.set('o', orgId);
    params.set('sig', sig);

    return `${baseUrl}/api/tracking/unsubscribe?${params.toString()}`;
}
