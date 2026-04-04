import { NextRequest, NextResponse } from 'next/server';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseBool(value: string | null): boolean {
    const normalized = String(value || '').toLowerCase().trim();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function POST(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['campaigns:run']);
        const cronSecret = String(process.env.CRON_SECRET || '').trim();

        if (!cronSecret) {
            return NextResponse.json(
                {
                    ok: false,
                    error: {
                        code: 'OPENCLAW_CRON_SECRET_MISSING',
                        message: 'CRON_SECRET is required to run campaigns',
                    },
                },
                { status: 500 }
            );
        }

        let body: Record<string, unknown> = {};
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            body = {};
        }

        const dryRun =
            (typeof body.dryRun === 'boolean' ? body.dryRun : undefined) ??
            parseBool(req.nextUrl.searchParams.get('dryRun'));
        const includeDetails =
            (typeof body.includeDetails === 'boolean' ? body.includeDetails : undefined) ??
            parseBool(req.nextUrl.searchParams.get('includeDetails'));

        const targetUrl = new URL('/api/cron/process-campaigns', req.nextUrl.origin);
        if (dryRun) targetUrl.searchParams.set('dryRun', 'true');
        if (includeDetails) targetUrl.searchParams.set('includeDetails', 'true');

        const response = await fetch(targetUrl.toString(), {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${cronSecret}`,
                'x-cron-secret': cronSecret,
                'content-type': 'application/json',
            },
            cache: 'no-store',
        });

        const responseText = await response.text();
        let parsed: any = null;
        try {
            parsed = responseText ? JSON.parse(responseText) : null;
        } catch {
            parsed = { raw: responseText };
        }

        return NextResponse.json(
            {
                ok: response.ok,
                data: {
                    organizationId: claims.orgId,
                    proxiedStatus: response.status,
                    dryRun,
                    includeDetails,
                    result: parsed,
                },
            },
            { status: response.ok ? 200 : response.status }
        );
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
                    code: 'OPENCLAW_CAMPAIGN_RUN_ERROR',
                    message: String(error?.message || 'Failed to run campaign cron'),
                },
            },
            { status: 500 }
        );
    }
}
