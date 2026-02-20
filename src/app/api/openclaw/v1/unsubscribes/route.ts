import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clampLimit(raw: string | null, fallback = 100, max = 500): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    const rounded = Math.floor(value);
    return Math.min(Math.max(rounded, 1), max);
}

export async function GET(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['contacted:read']);
        const supabase = getSupabaseAdminClient();

        const q = String(req.nextUrl.searchParams.get('q') || '').trim();
        const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

        let query = supabase
            .from('unsubscribed_emails')
            .select('id, email, user_id, organization_id, reason, created_at', { count: 'exact' })
            .eq('organization_id', claims.orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (q) {
            query = query.ilike('email', `%${q}%`);
        }

        const { data, count, error } = await query;
        if (error) {
            throw new Error(error.message || 'Failed to list unsubscribes');
        }

        return NextResponse.json({
            ok: true,
            data: {
                organizationId: claims.orgId,
                total: count || 0,
                limit,
                items: data || [],
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
                    code: 'OPENCLAW_UNSUBSCRIBES_LIST_ERROR',
                    message: String(error?.message || 'Failed to list unsubscribes'),
                },
            },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['contacted:write']);
        const supabase = getSupabaseAdminClient();

        let body: Record<string, unknown> = {};
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_BAD_JSON', message: 'Invalid JSON body' } },
                { status: 400 }
            );
        }

        const email = String(body.email || '').trim().toLowerCase();
        const reason = String(body.reason || 'manual_openclaw').trim();

        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return NextResponse.json(
                {
                    ok: false,
                    error: { code: 'OPENCLAW_INVALID_EMAIL', message: 'A valid email is required' },
                },
                { status: 400 }
            );
        }

        const { data, error } = await supabase
            .from('unsubscribed_emails')
            .upsert(
                {
                    email,
                    organization_id: claims.orgId,
                    reason,
                },
                { onConflict: 'email,user_id,organization_id' } as any
            )
            .select('id, email, user_id, organization_id, reason, created_at')
            .single();

        if (error) {
            throw new Error(error.message || 'Failed to add unsubscribe');
        }

        return NextResponse.json({
            ok: true,
            data: {
                unsubscribe: data,
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
                    code: 'OPENCLAW_UNSUBSCRIBES_CREATE_ERROR',
                    message: String(error?.message || 'Failed to add unsubscribe'),
                },
            },
            { status: 500 }
        );
    }
}
