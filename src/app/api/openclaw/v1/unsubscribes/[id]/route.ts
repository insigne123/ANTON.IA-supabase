import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const claims = authenticateOpenClawRequest(req, ['contacted:write']);
        const supabase = getSupabaseAdminClient();
        const { id } = await context.params;

        const { data: existing, error: existingError } = await supabase
            .from('unsubscribed_emails')
            .select('id, organization_id')
            .eq('id', id)
            .eq('organization_id', claims.orgId)
            .maybeSingle();

        if (existingError) {
            throw new Error(existingError.message || 'Failed to query unsubscribe record');
        }

        if (!existing) {
            return NextResponse.json(
                {
                    ok: false,
                    error: { code: 'OPENCLAW_UNSUBSCRIBE_NOT_FOUND', message: 'Unsubscribe not found' },
                },
                { status: 404 }
            );
        }

        const { error } = await supabase
            .from('unsubscribed_emails')
            .delete()
            .eq('id', id)
            .eq('organization_id', claims.orgId);

        if (error) {
            throw new Error(error.message || 'Failed to delete unsubscribe');
        }

        return NextResponse.json({
            ok: true,
            data: { id },
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
                    code: 'OPENCLAW_UNSUBSCRIBES_DELETE_ERROR',
                    message: String(error?.message || 'Failed to delete unsubscribe'),
                },
            },
            { status: 500 }
        );
    }
}
