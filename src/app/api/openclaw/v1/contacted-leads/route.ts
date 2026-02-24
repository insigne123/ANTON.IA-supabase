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

const CONTACTED_FULL_SELECT =
    'id, organization_id, mission_id, user_id, lead_id, name, email, company, role, status, subject, provider, sent_at, clicked_at, click_count, opened_at, replied_at, evaluation_status, engagement_score, last_interaction_at, last_update_at, reply_preview, last_reply_text, reply_intent, reply_sentiment, reply_confidence, reply_summary, campaign_followup_allowed, campaign_followup_reason, reply_message_id, reply_subject, reply_snippet, created_at';

const CONTACTED_LEGACY_SELECT =
    'id, organization_id, mission_id, user_id, lead_id, name, email, company, role, status, subject, provider, sent_at, clicked_at, click_count, opened_at, replied_at, evaluation_status, engagement_score, last_interaction_at, last_update_at, reply_preview, last_reply_text, reply_intent, reply_sentiment, reply_confidence, reply_summary, campaign_followup_allowed, campaign_followup_reason, created_at';

function isMissingColumnError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('column') && message.includes('contacted_leads') && message.includes('does not exist');
}

export async function GET(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['contacted:read']);
        const supabase = getSupabaseAdminClient();

        const status = String(req.nextUrl.searchParams.get('status') || '').trim();
        const evaluationStatus = String(req.nextUrl.searchParams.get('evaluation_status') || '').trim();
        const missionId = String(req.nextUrl.searchParams.get('missionId') || '').trim();
        const q = String(req.nextUrl.searchParams.get('q') || '').trim();
        const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

        let query = supabase
            .from('contacted_leads')
            .select(CONTACTED_FULL_SELECT, { count: 'exact' })
            .eq('organization_id', claims.orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            query = query.eq('status', status);
        }

        if (evaluationStatus) {
            query = query.eq('evaluation_status', evaluationStatus);
        }

        if (missionId) {
            query = query.eq('mission_id', missionId);
        }

        if (q) {
            query = query.or(
                `name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%,subject.ilike.%${q}%`
            );
        }

        const firstRes = await query;
        let data: any = firstRes.data;
        let count: number | null = firstRes.count;
        let error: any = firstRes.error;
        if (error && isMissingColumnError(error)) {
            let legacyQuery = supabase
                .from('contacted_leads')
                .select(CONTACTED_LEGACY_SELECT, { count: 'exact' })
                .eq('organization_id', claims.orgId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (status) {
                legacyQuery = legacyQuery.eq('status', status);
            }

            if (evaluationStatus) {
                legacyQuery = legacyQuery.eq('evaluation_status', evaluationStatus);
            }

            if (missionId) {
                legacyQuery = legacyQuery.eq('mission_id', missionId);
            }

            if (q) {
                legacyQuery = legacyQuery.or(
                    `name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%,subject.ilike.%${q}%`
                );
            }

            const legacyRes = await legacyQuery;
            data = legacyRes.data;
            count = legacyRes.count;
            error = legacyRes.error;
        }

        if (error) {
            throw new Error(error.message || 'Failed to list contacted leads');
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
                    code: 'OPENCLAW_CONTACTED_LIST_ERROR',
                    message: String(error?.message || 'Failed to list contacted leads'),
                },
            },
            { status: 500 }
        );
    }
}
