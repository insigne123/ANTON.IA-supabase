import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { to, subject, body: emailBody, userId: bodyUserId } = body;

        // 1. Authenticate (support both x-user-id header and session)
        const headerUserId = req.headers.get('x-user-id');
        let userId = headerUserId || bodyUserId;

        const supabase = createRouteHandlerClient({ cookies });

        if (!userId) {
            const { data: { user } } = await supabase.auth.getUser();
            userId = user?.id;
        }

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized - Missing user ID' }, { status: 401 });
        }

        // 2. Get User's Token (Check Google first, then Outlook)
        let provider = 'google';
        let tokenData = await tokenService.getToken(supabase, userId, 'google');

        if (!tokenData?.refresh_token) {
            provider = 'outlook';
            tokenData = await tokenService.getToken(supabase, userId, 'outlook');
        }

        if (!tokenData?.refresh_token) {
            return NextResponse.json({ error: 'No connected email provider found for user' }, { status: 400 });
        }

        // 3. Refresh Access Token
        let accessToken = '';

        if (provider === 'google') {
            accessToken = await refreshGoogleToken(tokenData.refresh_token);
        } else {
            accessToken = await refreshOutlookToken(tokenData.refresh_token);
        }

        if (!accessToken) {
            return NextResponse.json({ error: 'Failed to refresh access token calling provider' }, { status: 401 });
        }

        // 4. Send Email
        let result;
        if (provider === 'google') {
            result = await sendGmail(accessToken, to, subject, emailBody);
        } else {
            result = await sendOutlook(accessToken, to, subject, emailBody);
        }

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, provider });

    } catch (error: any) {
        console.error('[CONTACT_API] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// --- Helper Functions ---

async function refreshGoogleToken(refreshToken: string) {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) throw new Error('Missing Google credentials');

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });

    const data = await res.json();
    return data.access_token;
}

async function refreshOutlookToken(refreshToken: string) {
    const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
    const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
    const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common';

    if (!clientId || !clientSecret) throw new Error('Missing Outlook credentials');

    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'Mail.Send'
        })
    });

    const data = await res.json();
    return data.access_token;
}

async function sendGmail(accessToken: string, to: string, subject: string, body: string) {
    // Construct raw email
    const str = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        body
    ].join('\n');

    const raw = Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
    });

    if (!res.ok) {
        const err = await res.text();
        return { success: false, error: err };
    }
    return { success: true };
}

async function sendOutlook(accessToken: string, to: string, subject: string, body: string) {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: {
                subject: subject,
                body: {
                    contentType: 'Text',
                    content: body
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: to
                        }
                    }
                ]
            },
            saveToSentItems: true
        })
    });

    if (!res.ok) {
        const err = await res.text();
        return { success: false, error: err };
    }
    return { success: true };
}
