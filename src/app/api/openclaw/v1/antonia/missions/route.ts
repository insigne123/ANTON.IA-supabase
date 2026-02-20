import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clampLimit(raw: string | null, fallback = 50, max = 200): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    const rounded = Math.floor(value);
    return Math.min(Math.max(rounded, 1), max);
}

export async function GET(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['missions:read']);
        const supabase = getSupabaseAdminClient();

        const status = String(req.nextUrl.searchParams.get('status') || '').trim();
        const q = String(req.nextUrl.searchParams.get('q') || '').trim();
        const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

        let query = supabase
            .from('antonia_missions')
            .select(
                'id, organization_id, user_id, title, status, goal_summary, params, daily_search_limit, daily_enrich_limit, daily_investigate_limit, daily_contact_limit, created_at, updated_at',
                { count: 'exact' }
            )
            .eq('organization_id', claims.orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            query = query.eq('status', status);
        }

        if (q) {
            query = query.ilike('title', `%${q}%`);
        }

        const { data, count, error } = await query;

        if (error) {
            throw new Error(error.message || 'Failed to query missions');
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
                    code: 'OPENCLAW_MISSIONS_LIST_ERROR',
                    message: String(error?.message || 'Failed to list missions'),
                },
            },
            { status: 500 }
        );
    }
}
