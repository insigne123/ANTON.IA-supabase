import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');

    if (!code) {
        return NextResponse.redirect(new URL('/campaigns?error=no_code', req.url));
    }

    try {
        const supabase = createRouteHandlerClient({ cookies });
        const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common';

        const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!,
                client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
                redirect_uri: process.env.NEXT_PUBLIC_AZURE_AD_REDIRECT_URI!,
                grant_type: 'authorization_code',
                scope: 'offline_access User.Read Mail.Send',
            }),
        });

        const tokens = await tokenRes.json();

        if (!tokens.refresh_token) {
            console.warn('No refresh token returned from Azure');
        } else {
            await tokenService.saveToken(supabase, 'outlook', tokens.refresh_token);
        }

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        return NextResponse.redirect(`${baseUrl}/outlook?connected=true`);
    } catch (error) {
        console.error('Error exchanging Azure code:', error);
        return NextResponse.redirect(new URL('/campaigns?error=exchange_failed', req.url));
    }
}
