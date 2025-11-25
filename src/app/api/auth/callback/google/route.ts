import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');

    if (!code) {
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/gmail?error=no_code`);
    }

    try {
        const supabase = createRouteHandlerClient({ cookies });

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
                client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback/google`,
                grant_type: 'authorization_code',
            }),
        });

        const tokens = await tokenRes.json();

        if (!tokenRes.ok) {
            console.error('Google token exchange failed:', tokens);
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/gmail?error=token_exchange_failed&details=${tokens.error || 'unknown'}`);
        }

        if (!tokens.refresh_token) {
            console.warn('No refresh token returned from Google');
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/gmail?error=no_refresh_token`);
        }

        const saveErr = await tokenService.saveToken(supabase, 'google', tokens.refresh_token);
        if (saveErr) {
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/gmail?error=db_save_failed`);
        }

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        return NextResponse.redirect(`${baseUrl}/gmail?connected=true`);
    } catch (error) {
        console.error('Error exchanging Google code:', error);
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/gmail?error=exchange_failed`);
    }
}
