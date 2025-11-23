import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { provider, to, subject, htmlBody } = await req.json();

        if (!provider || !to || !subject || !htmlBody) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 1. Get Refresh Token
        const token = await tokenService.getToken(supabase, user.id, provider);
        if (!token) {
            return NextResponse.json({ error: `Not connected to ${provider}` }, { status: 400 });
        }

        // 2. Refresh Access Token
        let accessToken = '';
        try {
            if (provider === 'google') {
                const refreshed = await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
                accessToken = refreshed.access_token;
            } else if (provider === 'outlook') {
                const refreshed = await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
                accessToken = refreshed.access_token;
                if (refreshed.refresh_token) {
                    await tokenService.saveToken(supabase, 'outlook', refreshed.refresh_token);
                }
            }
        } catch (e: any) {
            console.error(`Failed to refresh token for user ${user.id}:`, e);
            return NextResponse.json({ error: 'Failed to refresh token. Please reconnect.' }, { status: 401 });
        }

        // 3. Send Email
        if (provider === 'google') {
            await sendGmail(accessToken, to, subject, htmlBody);
        } else {
            await sendOutlook(accessToken, to, subject, htmlBody);
        }

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error('Send proxy error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
