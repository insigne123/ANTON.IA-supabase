import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_PATCH_FIELDS = new Set([
    'name',
    'status',
    'excluded_lead_ids',
    'settings',
    'sent_records',
]);

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ campaignId: string }> }
) {
    try {
        const claims = authenticateOpenClawRequest(req, ['campaigns:write']);
        const supabase = getSupabaseAdminClient();
        const { campaignId } = await context.params;

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

        updateData.updated_at = new Date().toISOString();

        const { data: campaign, error: campaignError } = await supabase
            .from('campaigns')
            .select('id, organization_id')
            .eq('id', campaignId)
            .eq('organization_id', claims.orgId)
            .maybeSingle();

        if (campaignError) {
            throw new Error(campaignError.message || 'Failed to query campaign');
        }

        if (!campaign) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_CAMPAIGN_NOT_FOUND', message: 'Campaign not found' } },
                { status: 404 }
            );
        }

        const { data: updated, error: updateError } = await supabase
            .from('campaigns')
            .update(updateData)
            .eq('id', campaignId)
            .eq('organization_id', claims.orgId)
            .select('id, organization_id, user_id, name, status, excluded_lead_ids, settings, sent_records, created_at, updated_at')
            .single();

        if (updateError) {
            throw new Error(updateError.message || 'Failed to update campaign');
        }

        return NextResponse.json({
            ok: true,
            data: {
                campaign: updated,
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
                    code: 'OPENCLAW_CAMPAIGN_PATCH_ERROR',
                    message: String(error?.message || 'Failed to patch campaign'),
                },
            },
            { status: 500 }
        );
    }
}
