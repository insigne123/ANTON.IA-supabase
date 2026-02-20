import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_PATCH_FIELDS = new Set([
    'status',
    'evaluation_status',
    'engagement_score',
    'campaign_followup_allowed',
    'campaign_followup_reason',
    'last_reply_text',
    'reply_preview',
    'reply_intent',
    'reply_sentiment',
    'reply_confidence',
    'reply_summary',
    'reply_message_id',
    'reply_subject',
    'reply_snippet',
]);

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const claims = authenticateOpenClawRequest(req, ['contacted:write']);
        const supabase = getSupabaseAdminClient();
        const { id } = await context.params;

        let body: Record<string, unknown> = {};
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_BAD_JSON', message: 'Invalid JSON body' } },
                { status: 400 }
            );
        }

        const updateData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body || {})) {
            if (ALLOWED_PATCH_FIELDS.has(key)) {
                updateData[key] = value;
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json(
                {
                    ok: false,
                    error: {
                        code: 'OPENCLAW_NO_VALID_FIELDS',
                        message: 'No allowed fields in patch body',
                    },
                },
                { status: 400 }
            );
        }

        updateData.last_update_at = new Date().toISOString();

        const { data: existing, error: existingError } = await supabase
            .from('contacted_leads')
            .select('id, organization_id')
            .eq('id', id)
            .eq('organization_id', claims.orgId)
            .maybeSingle();

        if (existingError) {
            throw new Error(existingError.message || 'Failed to query contacted lead');
        }

        if (!existing) {
            return NextResponse.json(
                {
                    ok: false,
                    error: {
                        code: 'OPENCLAW_CONTACTED_NOT_FOUND',
                        message: 'Contacted lead not found',
                    },
                },
                { status: 404 }
            );
        }

        const { data: updated, error: updateError } = await supabase
            .from('contacted_leads')
            .update(updateData)
            .eq('id', id)
            .eq('organization_id', claims.orgId)
            .select(
                'id, organization_id, mission_id, user_id, lead_id, name, email, company, role, status, subject, provider, sent_at, clicked_at, click_count, opened_at, replied_at, evaluation_status, engagement_score, last_interaction_at, last_update_at, reply_preview, last_reply_text, reply_intent, reply_sentiment, reply_confidence, reply_summary, campaign_followup_allowed, campaign_followup_reason, reply_message_id, reply_subject, reply_snippet, created_at'
            )
            .single();

        if (updateError) {
            throw new Error(updateError.message || 'Failed to patch contacted lead');
        }

        return NextResponse.json({
            ok: true,
            data: {
                contactedLead: updated,
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
                    code: 'OPENCLAW_CONTACTED_PATCH_ERROR',
                    message: String(error?.message || 'Failed to patch contacted lead'),
                },
            },
            { status: 500 }
        );
    }
}
