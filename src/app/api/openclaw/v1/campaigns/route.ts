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
        const claims = authenticateOpenClawRequest(req, ['campaigns:read']);
        const supabase = getSupabaseAdminClient();

        const status = String(req.nextUrl.searchParams.get('status') || '').trim();
        const q = String(req.nextUrl.searchParams.get('q') || '').trim();
        const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
        const includeSteps = String(req.nextUrl.searchParams.get('includeSteps') || '').toLowerCase() === 'true';

        let query = supabase
            .from('campaigns')
            .select('id, organization_id, user_id, name, status, excluded_lead_ids, settings, sent_records, created_at, updated_at', {
                count: 'exact',
            })
            .eq('organization_id', claims.orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            query = query.eq('status', status);
        }

        if (q) {
            query = query.ilike('name', `%${q}%`);
        }

        const { data, count, error } = await query;
        if (error) {
            throw new Error(error.message || 'Failed to list campaigns');
        }

        let stepsByCampaign: Record<string, any[]> = {};
        if (includeSteps) {
            const campaignIds = (data || []).map((item: any) => item.id).filter(Boolean);
            if (campaignIds.length > 0) {
                const { data: stepRows, error: stepError } = await supabase
                    .from('campaign_steps')
                    .select('id, campaign_id, name, order_index, offset_days, subject_template, body_template, variant_b, attachments, created_at')
                    .in('campaign_id', campaignIds)
                    .order('order_index', { ascending: true });

                if (stepError) {
                    throw new Error(stepError.message || 'Failed to list campaign steps');
                }

                for (const step of stepRows || []) {
                    const key = String((step as any).campaign_id);
                    if (!stepsByCampaign[key]) stepsByCampaign[key] = [];
                    stepsByCampaign[key].push(step);
                }
            }
        }

        const items = (data || []).map((campaign: any) => {
            if (!includeSteps) return campaign;
            return {
                ...campaign,
                steps: stepsByCampaign[String(campaign.id)] || [],
            };
        });

        return NextResponse.json({
            ok: true,
            data: {
                organizationId: claims.orgId,
                total: count || 0,
                limit,
                items,
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
                    code: 'OPENCLAW_CAMPAIGNS_LIST_ERROR',
                    message: String(error?.message || 'Failed to list campaigns'),
                },
            },
            { status: 500 }
        );
    }
}
