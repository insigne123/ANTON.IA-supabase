import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isMailProvider } from '@/lib/mail-sender';
import { disconnectMailProvider } from '@/lib/server/mail-disconnect';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { provider, userId } = await request.json();

        if (!provider || !userId) {
            return NextResponse.json({ error: 'Missing provider or userId' }, { status: 400 });
        }

        // Verify the userId matches the authenticated user
        if (userId !== user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        if (!['google', 'outlook'].includes(provider)) {
            return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
        }

        // Refresh tokens are server-only; expose only connection state after auth.
        const { data, error } = await getSupabaseAdminClient()
            .from('provider_tokens')
            .select('provider')
            .eq('user_id', userId)
            .eq('provider', provider)
            .maybeSingle();

        if (error) {
            console.error('[store-token] Database error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: !!data, connected: !!data });
    } catch (error: any) {
        console.error('[store-token] Unexpected error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get connection status for all providers
        const admin = getSupabaseAdminClient();
        const [{ data, error }, approved] = await Promise.all([
            admin.from('provider_tokens').select('provider, updated_at').eq('user_id', user.id),
            // Conexiones warns before disconnecting the last mailbox: approved campaigns would wait for a new one.
            admin.from('bulk_campaigns').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'approved'),
        ]);

        if (error) {
            console.error('[store-token] Database error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const connections = {
            google: false,
            outlook: false,
            updatedAt: { google: null as string | null, outlook: null as string | null },
            approvedCampaigns: approved.error ? 0 : approved.count || 0,
        };

        if (data) {
            (data as Array<{ provider?: unknown; updated_at?: string | null }>).forEach((row) => {
                const provider = row.provider;
                if (!isMailProvider(provider)) return;
                connections[provider] = true;
                connections.updatedAt[provider] = row.updated_at || null;
            });
        }

        return NextResponse.json(connections, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error: any) {
        console.error('[store-token] Unexpected error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

/**
 * Disconnects one mailbox: removes its stored token (revoked at Google), and moves the default sender to the other
 * connected mailbox or clears it. Answers only the new state, never a token.
 */
export async function DELETE(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const provider = new URL(request.url).searchParams.get('provider');
        if (!isMailProvider(provider)) {
            return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
        }

        const result = await disconnectMailProvider(getSupabaseAdminClient(), user.id, provider);
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error: any) {
        console.error('[store-token] Disconnect failed:', error?.message || error);
        return NextResponse.json({ error: 'No pudimos desconectar la cuenta. Intenta de nuevo.' }, { status: 500 });
    }
}
