import { NextRequest, NextResponse } from 'next/server';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req);

        return NextResponse.json({
            ok: true,
            data: {
                subject: claims.sub,
                orgId: claims.orgId,
                scopes: claims.scopes,
                issuedAt: claims.iat,
                expiresAt: claims.exp,
                tokenId: claims.jti,
            },
        });
    } catch (error: any) {
        if (error instanceof OpenClawAuthError) {
            return NextResponse.json(
                { ok: false, error: { code: error.code, message: error.message } },
                { status: error.status }
            );
        }

        return NextResponse.json(
            {
                ok: false,
                error: {
                    code: 'OPENCLAW_WHOAMI_ERROR',
                    message: String(error?.message || 'Failed to resolve identity'),
                },
            },
            { status: 500 }
        );
    }
}
