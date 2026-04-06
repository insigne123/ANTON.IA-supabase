import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { normalizeConnectedEmailProvider } from '@/lib/email-provider';
import { checkAndConsumeDailyQuota } from '@/lib/server/daily-quota-store';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { provider: rawProvider, to, subject, htmlBody, organizationId: bodyOrgId } = await req.json();
        const provider = normalizeConnectedEmailProvider(rawProvider);

        if (!rawProvider || !to || !subject || !htmlBody) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (!provider) {
            return NextResponse.json({ error: `Unsupported provider: ${String(rawProvider)}` }, { status: 400 });
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
                .maybeSingle();
            if (member) orgId = member.organization_id;
        }
        console.log('[providers/send] User:', user.id, 'OrgId:', orgId);

        const blocked = await isEmailSuppressedForScope(to, { userId: user.id, organizationId: orgId });

        if (blocked) {
            console.warn(`Blocked email attempt to ${to} (User: ${user.id}, Org: ${orgId})`);
            // We return success to not break bulk flows, but with a warning or separate status?
            // Actually, usually we soft-fail or error. 
            // If we error, the frontend 'sendBulk' will count it as fail. That is appropriate.
            return NextResponse.json({ error: 'El destinatario se ha dado de baja de tus envíos.' }, { status: 403 });
        }

        // Check if domain is blacklisted
        const domain = to.split('@')[1]?.toLowerCase().trim();
        console.log('[providers/send] Checking domain block for:', domain, 'OrgId:', orgId);
        if (domain && orgId) {
            const { data: blockedDomain, error: domainError } = await supabase
                .from('excluded_domains')
                .select('id')
                .eq('organization_id', orgId)
                .eq('domain', domain)
                .maybeSingle();

            console.log('[providers/send] Domain check result:', { blockedDomain, domainError });

            if (blockedDomain) {
                console.warn(`Blocked domain attempt to ${to} (Domain: ${domain}, User: ${user.id}, Org: ${orgId})`);
                return NextResponse.json({ error: `El dominio ${domain} está bloqueado por tu organización.` }, { status: 403 });
            }
        } else {
            console.log('[providers/send] Skipping domain check - domain:', domain, 'orgId:', orgId);
        }

        // Append Unsubscribe Link
        const unsubscribeUrl = generateUnsubscribeLink(to, user.id, orgId);
        const footerHtml = `
            <br/><br/>
            <div style="font-family: sans-serif; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 10px; margin-top: 20px; display: block;">
                <p style="margin: 0;">Si no deseas recibir más correos de nosotros, puedes <a href="${unsubscribeUrl}" target="_blank" style="color: #666; text-decoration: underline;">darte de baja aquí</a>.</p>
            </div>
        `;

        let finalBody = htmlBody;
        // Case insensitive check for closing body tag
        const bodyTagRegex = /<\/body>/i;
        if (bodyTagRegex.test(finalBody)) {
            finalBody = finalBody.replace(bodyTagRegex, `${footerHtml}</body>`);
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

        const prepared = prepareOutboundEmail({ html: finalBody, unsubscribeUrl });
        const preflight = validateOutboundEmail({ to, subject, html: prepared.html, text: prepared.text, requireUnsubscribe: true, unsubscribeUrl });
        if (!preflight.ok) {
            return NextResponse.json({ error: preflight.errors.join(' ') }, { status: 400 });
        }

        const { allowed, count, limit } = await checkAndConsumeDailyQuota({
            userId: user.id,
            resource: 'contact',
            limit: 50,
        });
        if (!allowed) {
            return NextResponse.json({ error: `Daily quota exceeded for contact. Used ${count}/${limit}.` }, { status: 429 });
        }

        // 3. Send Email
        if (provider === 'google') {
            await sendGmail(accessToken, to, subject, prepared.html, { textBody: prepared.text, unsubscribeUrl });
        } else {
            await sendOutlook(accessToken, to, subject, prepared.html, { textBody: prepared.text, unsubscribeUrl });
        }

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error('Send proxy error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
