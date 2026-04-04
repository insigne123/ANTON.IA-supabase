import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_PATCH_FIELDS = new Set([
    'name',
    'title',
    'company',
    'email',
    'status',
    'industry',
    'company_website',
    'company_linkedin',
    'linkedin_url',
    'location',
    'country',
    'city',
    'apollo_id',
    'mission_id',
]);

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ leadId: string }> }
) {
    try {
        const claims = authenticateOpenClawRequest(req, ['leads:write']);
        const supabase = getSupabaseAdminClient();
        const { leadId } = await context.params;

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

        const { data: existing, error: existingError } = await supabase
            .from('leads')
            .select('id, organization_id, status')
            .eq('id', leadId)
            .eq('organization_id', claims.orgId)
            .maybeSingle();

        if (existingError) {
            throw new Error(existingError.message || 'Failed to query lead');
        }

        if (!existing) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_LEAD_NOT_FOUND', message: 'Lead not found' } },
                { status: 404 }
            );
        }

        const { data: updated, error: updateError } = await supabase
            .from('leads')
            .update(updateData)
            .eq('id', leadId)
            .eq('organization_id', claims.orgId)
            .select(
                'id, organization_id, mission_id, user_id, name, title, company, email, status, apollo_id, industry, linkedin_url, location, country, city, created_at, last_enriched_at, last_enrichment_attempt_at, enrichment_error'
            )
            .single();

        if (updateError) {
            throw new Error(updateError.message || 'Failed to update lead');
        }

        return NextResponse.json({
            ok: true,
            data: {
                lead: updated,
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
                    code: 'OPENCLAW_LEAD_PATCH_ERROR',
                    message: String(error?.message || 'Failed to patch lead'),
                },
            },
            { status: 500 }
        );
    }
}
