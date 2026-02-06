import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { to, subject, body: emailBody, userId: bodyUserId, isHtml } = body;

        // 1. Authenticate (support both x-user-id header and session)
        const headerUserId = req.headers.get('x-user-id');
        let userId = headerUserId || bodyUserId;

        console.log(`[CONTACT_DEBUG] START Request`);
        console.log(`[CONTACT_DEBUG] Header UserID: '${headerUserId}'`);
        console.log(`[CONTACT_DEBUG] Body UserID: '${bodyUserId}'`);
        console.log(`[CONTACT_DEBUG] Final UserID: '${userId}'`);

        let supabase;

        // CRITICAL FIX: If call comes from Cloud Functions (headerUserId exists), 
        // we must use SERVICE ROLE to bypass RLS, because there are no cookies.
        if (headerUserId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            console.log('[CONTACT_DEBUG] Using SERVICE ROLE client (Server-to-Server)');
            supabase = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                {
                    auth: {
                        autoRefreshToken: false,
                        persistSession: false
                    }
                }
            );
        } else {
            console.log('[CONTACT_DEBUG] Using SESSION client (Browser/Cookie)');
            supabase = createRouteHandlerClient({ cookies });

            // If no explicit userId, try to get from session
            if (!userId) {
                const { data: { user } } = await supabase.auth.getUser();
                userId = user?.id;
                console.log(`[CONTACT_DEBUG] Session UserID lookup result: '${userId}'`);
            }
        }

        if (!userId) {
            console.error('[CONTACT_DEBUG] Unauthorized - Missing user ID');
            return NextResponse.json({ error: 'Unauthorized - Missing user ID' }, { status: 401 });
        }

        // 2. Get User's Token (Check Google first, then Outlook)
        console.log(`[CONTACT_DEBUG] Checking tokens for UserID: '${userId}' in provider_tokens table`);
        let provider = 'google';
        let tokenData = await tokenService.getToken(supabase, userId, 'google');

        if (!tokenData?.refresh_token) {
            console.log(`[CONTACT_DEBUG] No Google token found, checking Outlook...`);
            provider = 'outlook';
            tokenData = await tokenService.getToken(supabase, userId, 'outlook');
        } else {
            console.log(`[CONTACT_DEBUG] Found Google token`);
        }

        if (!tokenData?.refresh_token) {
            console.error(`[CONTACT_DEBUG] NO TOKEN FOUND for UserID: '${userId}'. Returning 400.`);
            console.error(`[CONTACT_DEBUG] Potential causes: RLS blocking read (if not using service role), or user truly has no tokens.`);
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
            console.error('[CONTACT_DEBUG] Failed to refresh access token');
            return NextResponse.json({ error: 'Failed to refresh access token calling provider' }, { status: 401 });
        }

        // 3.1. CHECK TRACKING CONFIG
        let finalBody = emailBody;
        let effectiveIsHtml = Boolean(isHtml);
        const { missionId, leadId, tracking } = body;

        let missionOrgId: string | null = null;

        if (missionId && leadId) {
            try {
                // Get OrgID from Mission
                const { data: mission } = await supabase
                    .from('antonia_missions')
                    .select('organization_id')
                    .eq('id', missionId)
                    .single();

                if (mission) {
                    missionOrgId = mission.organization_id;

                    // Block if unsubscribed (user-level or org-level)
                    try {
                        const toEmail = String(to || '').trim().toLowerCase();
                        if (toEmail) {
                            const { data: unsubUser } = await supabase
                                .from('unsubscribed_emails')
                                .select('id')
                                .ilike('email', toEmail)
                                .eq('user_id', userId)
                                .maybeSingle();

                            const { data: unsubOrg } = missionOrgId
                                ? await supabase
                                    .from('unsubscribed_emails')
                                    .select('id')
                                    .ilike('email', toEmail)
                                    .eq('organization_id', missionOrgId)
                                    .maybeSingle()
                                : { data: null } as any;

                            if (unsubUser || unsubOrg) {
                                console.warn('[CONTACT_DEBUG] Recipient is unsubscribed:', toEmail);
                                return NextResponse.json({ error: 'Recipient unsubscribed' }, { status: 409 });
                            }
                        }
                    } catch (e) {
                        console.error('[CONTACT_DEBUG] Failed unsubscribe check:', e);
                    }

                    // Block if org domain is excluded
                    try {
                        const toEmail = String(to || '').trim().toLowerCase();
                        const domain = toEmail.split('@')[1]?.trim() || '';
                        if (domain && missionOrgId) {
                            const { data: blockedDomain } = await supabase
                                .from('excluded_domains')
                                .select('id')
                                .eq('organization_id', missionOrgId)
                                .eq('domain', domain)
                                .maybeSingle();

                            if (blockedDomain) {
                                console.warn('[CONTACT_DEBUG] Recipient domain is blocked:', domain);
                                return NextResponse.json({ error: `Domain blocked: ${domain}` }, { status: 403 });
                            }
                        }
                    } catch (e) {
                        console.error('[CONTACT_DEBUG] Failed domain blacklist check:', e);
                    }

                    const { data: config } = await supabase
                        .from('antonia_config')
                        .select('tracking_enabled')
                        .eq('organization_id', mission.organization_id)
                        .single();

                    const trackingEnabled = typeof tracking?.enabled === 'boolean'
                        ? tracking.enabled
                        : Boolean(config?.tracking_enabled);
                    const trackPixel = trackingEnabled && (tracking?.pixel ?? true);
                    const trackLinks = trackingEnabled && (tracking?.linkTracking ?? true);

                    if (trackingEnabled && effectiveIsHtml) {
                        // Link tracking (optional)
                        if (trackLinks && !finalBody.includes('/api/tracking/click')) {
                            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
                            finalBody = finalBody.replace(/href=("|')(http[^"']+)("|')/gi, (match: string, quote: string, url: string) => {
                                if (String(url).includes('/api/tracking/click')) return match;
                                if (String(url).includes('/unsubscribe?')) return match;
                                if (String(url).startsWith('mailto:')) return match;
                                const trackingUrl = `${appUrl}/api/tracking/click?id=${leadId}&url=${encodeURIComponent(url)}`;
                                return `href=${quote}${trackingUrl}${quote}`;
                            });
                        }

                        // Pixel tracking (optional)
                        if (trackPixel && !finalBody.includes('/api/tracking/open?id=')) {
                            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
                            const pixelUrl = `${appUrl}/api/tracking/open?id=${leadId}`;
                            const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="" />`;
                            finalBody = finalBody + pixelHtml;
                        }
                    } else if (trackingEnabled && !effectiveIsHtml && trackPixel) {
                        // If text/plain, wrap into HTML to allow pixel (links tracking skipped)
                        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
                        const pixelUrl = `${appUrl}/api/tracking/open?id=${leadId}`;
                        const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="" />`;
                        finalBody = `<div>${emailBody.replace(/\n/g, '<br>')}</div>${pixelHtml}`;
                        effectiveIsHtml = true;
                    }

                    // Append signed unsubscribe link (only for outbound lead emails)
                    try {
                        const toEmail = String(to || '').trim();
                        if (toEmail) {
                            const unsubLink = generateUnsubscribeLink(toEmail, userId, missionOrgId);
                            const hasUnsub = String(finalBody || '').includes('/unsubscribe?') || String(finalBody || '').toLowerCase().includes('darte de baja');
                            if (!hasUnsub) {
                                if (effectiveIsHtml) {
                                    finalBody += `
<br><hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;">
<p style="font-size:12px;color:#6b7280;line-height:1.4;">Si no deseas recibir más correos, puedes <a href="${unsubLink}" style="color:#2563eb;text-decoration:underline;">darte de baja aquí</a>.</p>`;
                                } else {
                                    finalBody += `\n\n---\nSi no deseas recibir más correos, puedes darte de baja aquí: ${unsubLink}`;
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[CONTACT_DEBUG] Failed to append unsubscribe link:', e);
                    }
                }
            } catch (e) {
                console.error('[CONTACT_DEBUG] Error checking tracking config:', e);
            }
        }

        // 4. Send Email
        let result;
        if (provider === 'google') {
            result = await sendGmail(accessToken, to, subject, finalBody, effectiveIsHtml);
        } else {
            result = await sendOutlook(accessToken, to, subject, finalBody, effectiveIsHtml);
        }

        if (!result.success) {
            console.error(`[CONTACT_DEBUG] Send failed: ${result.error}`);
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        console.log(`[CONTACT_DEBUG] Email sent successfully via ${provider}`);
        return NextResponse.json({ success: true, provider: provider === 'google' ? 'gmail' : 'outlook' });

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

async function sendGmail(accessToken: string, to: string, subject: string, body: string, isHtml: boolean = false) {
    // Construct raw email
    const contentType = isHtml ? 'text/html' : 'text/plain';
    const str = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: ${contentType}; charset=utf-8`,
        'MIME-Version: 1.0',
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

async function sendOutlook(accessToken: string, to: string, subject: string, body: string, isHtml: boolean = false) {
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
                    contentType: isHtml ? 'HTML' : 'Text',
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
