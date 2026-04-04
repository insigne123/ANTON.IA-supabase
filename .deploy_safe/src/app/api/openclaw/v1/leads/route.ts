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
        const claims = authenticateOpenClawRequest(req, ['leads:read']);
        const supabase = getSupabaseAdminClient();

        const status = String(req.nextUrl.searchParams.get('status') || '').trim();
        const missionId = String(req.nextUrl.searchParams.get('missionId') || '').trim();
        const q = String(req.nextUrl.searchParams.get('q') || '').trim();
        const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

        let listQuery = supabase
            .from('leads')
            .select(
                'id, organization_id, mission_id, user_id, name, title, company, email, status, apollo_id, industry, linkedin_url, location, country, city, created_at, last_enriched_at, last_enrichment_attempt_at, enrichment_error',
                { count: 'exact' }
            )
            .eq('organization_id', claims.orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            listQuery = listQuery.eq('status', status);
        }

        if (missionId) {
            listQuery = listQuery.eq('mission_id', missionId);
        }

        if (q) {
            listQuery = listQuery.or(
                `name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%,title.ilike.%${q}%`
            );
        }

        const [listRes, statusRes] = await Promise.all([
            listQuery,
            supabase
                .from('leads')
                .select('status')
                .eq('organization_id', claims.orgId)
                .limit(5000),
        ]);

        if (listRes.error) {
            throw new Error(listRes.error.message || 'Failed to list leads');
        }

        if (statusRes.error) {
            throw new Error(statusRes.error.message || 'Failed to aggregate lead statuses');
        }

        const countsByStatus: Record<string, number> = {};
        for (const row of statusRes.data || []) {
            const key = String((row as any).status || 'unknown');
            countsByStatus[key] = (countsByStatus[key] || 0) + 1;
        }

        return NextResponse.json({
            ok: true,
            data: {
                organizationId: claims.orgId,
                total: listRes.count || 0,
                limit,
                countsByStatus,
                items: listRes.data || [],
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
                    code: 'OPENCLAW_LEADS_LIST_ERROR',
                    message: String(error?.message || 'Failed to list leads'),
                },
            },
            { status: 500 }
        );
    }
}
