import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

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

        // provider_tokens is the source of truth for connectivity
        const { data, error } = await supabase
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
        const { data, error } = await supabase
            .from('provider_tokens')
            .select('provider')
            .eq('user_id', user.id);

        if (error) {
            console.error('[store-token] Database error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const connections = {
            google: false,
            outlook: false
        };

        if (data) {
            data.forEach((row: any) => {
                if (row.provider === 'google') connections.google = true;
                if (row.provider === 'outlook') connections.outlook = true;
            });
        }

        return NextResponse.json(connections);
    } catch (error: any) {
        console.error('[store-token] Unexpected error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
