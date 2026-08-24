import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';

function getBaseUrl(req: NextRequest) {
    const forwardedHost = req.headers.get('x-forwarded-host');
    const forwardedProto = req.headers.get('x-forwarded-proto');

    if (forwardedHost && forwardedProto) {
        return `${forwardedProto}://${forwardedHost}`;
    }

    return req.nextUrl.origin || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

function buildOutlookRedirect(baseUrl: string, params: Record<string, string>) {
    const url = new URL('/outlook', baseUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');
    const baseUrl = getBaseUrl(req);

    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
        return buildOutlookRedirect(baseUrl, {
            error,
            ...(errorDescription ? { details: errorDescription } : {}),
        });
    }

    if (!code) {
        return buildOutlookRedirect(baseUrl, { error: 'no_code' });
    }

    try {
        const supabase = createRouteHandlerClient({ cookies });
        const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common';
        const redirectUri = `${baseUrl}/api/auth/callback/azure`;

        const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!,
                client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                scope: 'offline_access User.Read Mail.Send Mail.Read',
            }),
        });

        const tokens = await tokenRes.json();

        if (!tokenRes.ok) {
            console.error('Azure token exchange failed:', tokens);
            return buildOutlookRedirect(baseUrl, {
                error: 'token_exchange_failed',
                details: String(tokens.error || 'unknown'),
            });
        }

        if (!tokens.refresh_token) {
            console.warn('No refresh token returned from Azure');
            return buildOutlookRedirect(baseUrl, { error: 'no_refresh_token' });
        }

        const saveErr = await tokenService.saveToken(supabase, 'outlook', tokens.refresh_token);
        if (saveErr) {
            return buildOutlookRedirect(baseUrl, {
                error: 'db_save_failed',
                details: String((saveErr as any)?.message || 'no_session'),
            });
        }

        return buildOutlookRedirect(baseUrl, { connected: 'true' });
    } catch (error) {
        console.error('Error exchanging Azure code:', error);
        return buildOutlookRedirect(baseUrl, { error: 'exchange_failed' });
    }
}
