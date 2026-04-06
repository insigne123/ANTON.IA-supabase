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

function normalizeDomain(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .replace(/:\d+$/, '');
}

function isMissingTableError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('excluded_domains') && message.includes('does not exist');
}

export async function GET(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['contacted:read']);
        const supabase = getSupabaseAdminClient();

        const q = String(req.nextUrl.searchParams.get('q') || '').trim();
        const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

        let query = supabase
            .from('excluded_domains')
            .select('id, organization_id, domain, created_at', { count: 'exact' })
            .eq('organization_id', claims.orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (q) {
            query = query.ilike('domain', `%${q.toLowerCase()}%`);
        }

        const { data, count, error } = await query;
        if (error) {
            if (isMissingTableError(error)) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: {
                            code: 'OPENCLAW_EXCLUDED_DOMAINS_TABLE_MISSING',
                            message: 'Table excluded_domains is missing in this environment',
                        },
                    },
                    { status: 500 }
                );
            }
            throw new Error(error.message || 'Failed to list blocked domains');
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
                    code: 'OPENCLAW_BLOCKED_DOMAINS_LIST_ERROR',
                    message: String(error?.message || 'Failed to list blocked domains'),
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

        const domain = normalizeDomain(String(body.domain || ''));
        if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
            return NextResponse.json(
                {
                    ok: false,
                    error: { code: 'OPENCLAW_INVALID_DOMAIN', message: 'A valid domain is required' },
                },
                { status: 400 }
            );
        }

        const { data, error } = await supabase
            .from('excluded_domains')
            .upsert(
                {
                    organization_id: claims.orgId,
                    domain,
                },
                { onConflict: 'organization_id,domain' } as any
            )
            .select('id, organization_id, domain, created_at')
            .single();

        if (error) {
            if (isMissingTableError(error)) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: {
                            code: 'OPENCLAW_EXCLUDED_DOMAINS_TABLE_MISSING',
                            message: 'Table excluded_domains is missing in this environment',
                        },
                    },
                    { status: 500 }
                );
            }
            throw new Error(error.message || 'Failed to add blocked domain');
        }

        return NextResponse.json({
            ok: true,
            data: {
                domain: data,
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
                    code: 'OPENCLAW_BLOCKED_DOMAINS_CREATE_ERROR',
                    message: String(error?.message || 'Failed to add blocked domain'),
                },
            },
            { status: 500 }
        );
    }
}
