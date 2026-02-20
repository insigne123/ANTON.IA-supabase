import { NextRequest, NextResponse } from 'next/server';
import {
    issueOpenClawToken,
    OpenClawAuthError,
    validateOpenClawApiKey,
} from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ExchangeBody = {
    apiKey?: string;
    scopes?: string[];
    ttlSeconds?: number;
};

export async function POST(req: NextRequest) {
    try {
        let body: ExchangeBody = {};
        try {
            body = (await req.json()) as ExchangeBody;
        } catch {
            body = {};
        }

        const providedApiKey =
            String(req.headers.get('x-openclaw-key') || '').trim() ||
            String(body.apiKey || '').trim();

        if (!providedApiKey) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_API_KEY_MISSING', message: 'Missing API key' } },
                { status: 400 }
            );
        }

        if (!validateOpenClawApiKey(providedApiKey)) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_API_KEY_INVALID', message: 'Invalid API key' } },
                { status: 401 }
            );
        }

        const { token, claims, expiresIn } = issueOpenClawToken({
            scopes: Array.isArray(body.scopes) ? body.scopes : undefined,
            ttlSeconds: Number.isFinite(Number(body.ttlSeconds)) ? Number(body.ttlSeconds) : undefined,
        });

        return NextResponse.json({
            ok: true,
            data: {
                token,
                tokenType: 'Bearer',
                expiresIn,
                orgId: claims.orgId,
                scopes: claims.scopes,
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
                    code: 'OPENCLAW_EXCHANGE_ERROR',
                    message: String(error?.message || 'Failed to issue token'),
                },
            },
            { status: 500 }
        );
    }
}
