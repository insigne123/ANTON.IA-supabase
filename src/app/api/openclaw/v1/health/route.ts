import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
    const nowIso = new Date().toISOString();

    return NextResponse.json({
        ok: true,
        data: {
            service: 'openclaw-control-api',
            status: 'healthy',
            timestamp: nowIso,
        },
    });
}
