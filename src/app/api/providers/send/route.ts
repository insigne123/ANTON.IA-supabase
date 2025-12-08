import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { provider, to, subject, htmlBody, organizationId: bodyOrgId } = await req.json();

        if (!provider || !to || !subject || !htmlBody) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // --- Unsubscribe / Blacklist Check --- //

        let orgId = bodyOrgId;
        if (!orgId) {
            // Try to resolve implicit organization
            const { data: member } = await supabase
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', user.id)
                .limit(1)
                .single();
            if (member) orgId = member.organization_id;
        }

        // Check if blacklisted
        let blacklistQuery = supabase
            .from('unsubscribed_emails')
            .select('id')
            .eq('email', to);

        if (orgId) {
            blacklistQuery = blacklistQuery.or(`user_id.eq.${user.id},organization_id.eq.${orgId}`);
        } else {
            blacklistQuery = blacklistQuery.eq('user_id', user.id);
        }

        const { data: blocked } = await blacklistQuery.maybeSingle();

        if (blocked) {
            console.warn(`Blocked email attempt to ${to} (User: ${user.id}, Org: ${orgId})`);
            // We return success to not break bulk flows, but with a warning or separate status?
            // Actually, usually we soft-fail or error. 
            // If we error, the frontend 'sendBulk' will count it as fail. That is appropriate.
            return NextResponse.json({ error: 'El destinatario se ha dado de baja de tus envíos.' }, { status: 403 });
        }

        // Append Unsubscribe Link
        const unsubscribeUrl = generateUnsubscribeLink(to, user.id, orgId);
        const footerHtml = `
            <br/><br/>
            <div style="font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 10px; margin-top: 20px;">
                <p>Si no deseas recibir más correos de nosotros, puedes <a href="${unsubscribeUrl}" target="_blank" style="color: #666; text-decoration: underline;">darte de baja aquí</a>.</p>
            </div>
        `;

        let finalBody = htmlBody;
        if (finalBody.includes('</body>')) {
            finalBody = finalBody.replace('</body>', `${footerHtml}</body>`);
        } else {
            finalBody += footerHtml;
        }

        console.log('[Email] Generated Unsubscribe Link:', unsubscribeUrl);

        // --- End Unsubscribe Logic --- //

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
            await sendGmail(accessToken, to, subject, finalBody);
        } else {
            await sendOutlook(accessToken, to, subject, finalBody);
        }

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error('Send proxy error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
