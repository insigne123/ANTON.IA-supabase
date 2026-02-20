import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isMissingTableError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('excluded_domains') && message.includes('does not exist');
}

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const claims = authenticateOpenClawRequest(req, ['contacted:write']);
        const supabase = getSupabaseAdminClient();
        const { id } = await context.params;

        const { data: existing, error: existingError } = await supabase
            .from('excluded_domains')
            .select('id, organization_id')
            .eq('id', id)
            .eq('organization_id', claims.orgId)
            .maybeSingle();

        if (existingError) {
            if (isMissingTableError(existingError)) {
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
            throw new Error(existingError.message || 'Failed to query blocked domain');
        }

        if (!existing) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_BLOCKED_DOMAIN_NOT_FOUND', message: 'Blocked domain not found' } },
                { status: 404 }
            );
        }

        const { error } = await supabase
            .from('excluded_domains')
            .delete()
            .eq('id', id)
            .eq('organization_id', claims.orgId);

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
            throw new Error(error.message || 'Failed to delete blocked domain');
        }

        return NextResponse.json({
            ok: true,
            data: {
                id,
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
                    code: 'OPENCLAW_BLOCKED_DOMAINS_DELETE_ERROR',
                    message: String(error?.message || 'Failed to delete blocked domain'),
                },
            },
            { status: 500 }
        );
    }
}
