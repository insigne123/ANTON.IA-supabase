import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { encodeHeaderRFC2047, sanitizeHeaderText } from '@/lib/email-header-utils';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { createLegacyReadyEmailDraftV1, createMessagingSendMetadataV1, deterministicMessagingUuid } from '@/lib/messaging-contracts';
import { ensureMessagingDraftV1 } from '@/lib/server/messaging-drafts';
import { prepareEmailTracking } from '@/lib/server/tracking-token';
import {
    ConfirmedProviderRejectionError,
    dispatchOutboundMessage,
    OutboundDispatchConflictError,
    OutboundPreProviderDeferredError,
} from '@/lib/server/outbound-dispatch';
import { findLatestLeadResearchSnapshotId } from '@/lib/server/lead-research-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { to, subject, body: emailBody, userId: bodyUserId, isHtml } = body;

        const debug = process.env.CONTACT_DEBUG === 'true';
        const debugLog = (...args: any[]) => { if (debug) console.log(...args); };
        const debugError = (...args: any[]) => { if (debug) console.error(...args); };

        // 1. Authenticate (support both trusted internal requests and session callers)
        const headerUserId = String(req.headers.get('x-user-id') || '').trim();
        const headerOrganizationId = String(req.headers.get('x-organization-id') || '').trim();
        let userId = '';
        const isInternalAutomationRequest = Boolean(headerUserId);

        if (headerUserId && !isTrustedInternalRequest(req)) {
            return NextResponse.json({ error: 'Unauthorized internal request' }, { status: 401 });
        }

        debugLog(`[CONTACT_DEBUG] START Request`);
        debugLog(`[CONTACT_DEBUG] Header UserID: '${headerUserId}'`);
        debugLog(`[CONTACT_DEBUG] Body UserID: '${bodyUserId}'`);
        let supabase;

        if (isInternalAutomationRequest) {
            if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
                return NextResponse.json({ error: 'Internal outbound service is not configured', code: 'OUTBOUND_UNKNOWN' }, { status: 503 });
            }
            if (!headerOrganizationId) {
                return NextResponse.json({ error: 'x-organization-id is required for internal requests' }, { status: 400 });
            }
            if (bodyUserId && String(bodyUserId).trim() !== headerUserId) {
                return NextResponse.json({ error: 'Request user does not match authenticated internal user' }, { status: 403 });
            }
            userId = headerUserId;
            debugLog('[CONTACT_DEBUG] Using SERVICE ROLE client (Server-to-Server)');
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
            debugLog('[CONTACT_DEBUG] Using SESSION client (Browser/Cookie)');
            supabase = createRouteHandlerClient({ cookies });
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError || !user) {
                return NextResponse.json({ error: 'Unauthorized - Missing user session' }, { status: 401 });
            }
            if (bodyUserId && String(bodyUserId).trim() !== user.id) {
                return NextResponse.json({ error: 'Request user does not match authenticated session' }, { status: 403 });
            }
            userId = user.id;
        }

        debugLog(`[CONTACT_DEBUG] Final UserID: '${userId}'`);

        // 2. Resolve and authorize organization context before any outbound checks or provider access.
        let finalBody = emailBody;
        let effectiveIsHtml = Boolean(isHtml);
        const { missionId, leadId, tracking } = body;
        let missionOrgId: string | null = null;

        if (missionId) {
            const { data, error } = await supabase
                .from('antonia_missions')
                .select('organization_id, user_id')
                .eq('id', missionId)
                .maybeSingle();
            if (error) throw error;
            if (!data) {
                return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
            }
            missionOrgId = String(data.organization_id || '').trim() || null;
            if (!missionOrgId) {
                return NextResponse.json({ error: 'Mission organization is required' }, { status: 403 });
            }
            if (isInternalAutomationRequest && headerOrganizationId !== missionOrgId) {
                return NextResponse.json({ error: 'Internal organization does not match mission organization' }, { status: 403 });
            }
            if (isInternalAutomationRequest && data.user_id && String(data.user_id) !== userId) {
                return NextResponse.json({ error: 'Internal user does not match mission user' }, { status: 403 });
            }
        } else if (isInternalAutomationRequest) {
            missionOrgId = headerOrganizationId;
        }

        if (!isInternalAutomationRequest) {
            let membershipQuery = supabase
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', userId);
            if (missionOrgId || headerOrganizationId) {
                membershipQuery = membershipQuery.eq('organization_id', missionOrgId || headerOrganizationId);
            }
            const { data: member, error: memberError } = await membershipQuery
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();
            if (memberError) {
                return NextResponse.json({ error: 'Unable to verify organization membership', code: 'OUTBOUND_UNKNOWN' }, { status: 503 });
            }
            if (!member) {
                return NextResponse.json({ error: 'Organization membership is required' }, { status: 403 });
            }
            missionOrgId = String(member.organization_id || '').trim() || null;
        }

        if (!missionOrgId) {
            return NextResponse.json({ error: 'Organization is required for durable outbound sending' }, { status: 403 });
        }

        // 3. Apply suppression and domain policy to every outbound send. Lookup errors fail closed.
        const toEmail = String(to || '').trim().toLowerCase();
        if (!toEmail) {
            return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
        }
        try {
            if (await isEmailSuppressedForScope(toEmail, { userId, organizationId: missionOrgId })) {
                return NextResponse.json({ error: 'Recipient unsubscribed', code: 'RECIPIENT_UNSUBSCRIBED' }, { status: 409 });
            }
        } catch (error) {
            debugError('[CONTACT_DEBUG] Failed unsubscribe check:', error);
            return NextResponse.json({ error: 'Unable to verify recipient suppression status', code: 'OUTBOUND_UNKNOWN' }, { status: 503 });
        }

        const domain = toEmail.split('@')[1]?.trim() || '';
        if (domain) {
            const { data: blockedDomains, error: blockedDomainError } = await supabase
                .from('excluded_domains')
                .select('domain')
                .eq('organization_id', missionOrgId);
            if (blockedDomainError) {
                debugError('[CONTACT_DEBUG] Failed domain blacklist check:', blockedDomainError);
                return NextResponse.json({ error: 'Unable to verify recipient domain policy', code: 'OUTBOUND_UNKNOWN' }, { status: 503 });
            }
            const isDomainBlocked = (blockedDomains || []).some((row: any) => (
                String(row.domain || '').trim().toLowerCase().replace(/^@/, '') === domain
            ));
            if (isDomainBlocked) {
                return NextResponse.json({ error: `Domain blocked: ${domain}`, code: 'DOMAIN_BLOCKED' }, { status: 403 });
            }
        }

        let trackLinks = false;
        let trackPixel = false;
        if (missionId && leadId) {
            if (isInternalAutomationRequest) {
                const { data: leadRow, error: leadError } = await supabase
                    .from('leads')
                    .select('id, last_investigated_at, investigation_error')
                    .eq('id', leadId)
                    .eq('organization_id', missionOrgId)
                    .maybeSingle();
                if (leadError) throw leadError;
                if (!leadRow) {
                    return NextResponse.json({ error: 'Lead not found for automatic contact', code: 'LEAD_NOT_FOUND' }, { status: 412 });
                }
                const investigationError = String(leadRow.investigation_error || '').trim();
                if (!leadRow.last_investigated_at || investigationError) {
                    return NextResponse.json({
                        error: 'Lead research incomplete for automatic contact',
                        code: 'LEAD_RESEARCH_INCOMPLETE',
                        researchError: investigationError || null,
                    }, { status: 412 });
                }
            }

            try {
                    const { data: config } = await supabase
                        .from('antonia_config')
                        .select('tracking_enabled')
                        .eq('organization_id', missionOrgId)
                        .single();

                    const trackingEnabled = typeof tracking?.enabled === 'boolean'
                        ? tracking.enabled
                        : Boolean(config?.tracking_enabled);
                    trackPixel = trackingEnabled && (tracking?.pixel ?? true);
                    trackLinks = trackingEnabled && (tracking?.linkTracking ?? true);

            } catch (e) {
                debugError('[CONTACT_DEBUG] Error checking tracking config:', e);
            }
        }

        const unsubscribeUrl = generateUnsubscribeLink(String(to || '').trim(), userId, missionOrgId);
        const prepared = prepareOutboundEmail({
            html: effectiveIsHtml ? finalBody : undefined,
            text: effectiveIsHtml ? undefined : finalBody,
            unsubscribeUrl,
        });
        const preflight = validateOutboundEmail({
            to,
            subject,
            html: prepared.html,
            text: prepared.text,
            requireUnsubscribe: true,
            unsubscribeUrl,
        });
        if (!preflight.ok) {
            return NextResponse.json({ error: preflight.errors.join(' ') }, { status: 400 });
        }
        finalBody = prepared.html;
        effectiveIsHtml = true;

        const requestedAt = new Date().toISOString();
        const idempotencyKey = String(body.idempotencyKey || '').trim();
        if (!idempotencyKey) {
            return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });
        }

        const trackingId = trackLinks || trackPixel
            ? deterministicMessagingUuid(`tracking:${missionOrgId}:${userId}:${idempotencyKey}`)
            : null;
        if (trackingId) {
            const trackingHtml = effectiveIsHtml
                ? String(finalBody || '')
                : `<div>${String(finalBody || '').replace(/\n/g, '<br>')}</div>`;
            try {
                finalBody = prepareEmailTracking({
                    html: trackingHtml,
                    contactedId: trackingId,
                    organizationId: missionOrgId,
                    trackLinks,
                    trackPixel,
                });
                effectiveIsHtml = true;
            } catch (error) {
                debugError('[CONTACT_DEBUG] Unable to prepare secure tracking:', error);
                return NextResponse.json({ error: 'Secure tracking is not configured', code: 'TRACKING_UNAVAILABLE' }, { status: 503 });
            }
        }

        // 4. Access the exact authenticated user's provider token only after policy checks pass.
        debugLog(`[CONTACT_DEBUG] Checking tokens for UserID: '${userId}' in provider_tokens table`);
        let provider = 'google';
        let tokenData = await tokenService.getToken(supabase, userId, 'google');
        if (!tokenData?.refresh_token) {
            provider = 'outlook';
            tokenData = await tokenService.getToken(supabase, userId, 'outlook');
        }
        if (!tokenData?.refresh_token) {
            return NextResponse.json({ error: 'No connected email provider found for user' }, { status: 400 });
        }

        const accessToken = provider === 'google'
            ? await refreshGoogleToken(tokenData.refresh_token)
            : await refreshOutlookToken(tokenData.refresh_token);
        if (!accessToken) {
            return NextResponse.json({ error: 'Failed to refresh access token calling provider', code: 'OUTBOUND_UNKNOWN' }, { status: 503 });
        }

        const providerLabel = provider === 'google' ? 'gmail' : 'outlook';
        const researchSnapshotId = leadId
            ? await findLatestLeadResearchSnapshotId({
                userId,
                organizationId: missionOrgId,
                scopeKey: missionOrgId,
            }, leadId)
            : null;
        const draft = createLegacyReadyEmailDraftV1({
            organizationId: missionOrgId,
            userId,
            idempotencyKey,
            requestedAt,
            researchSnapshotId,
            leadRef: leadId || String(to).trim().toLowerCase(),
            to,
            subject,
            text: prepared.text,
            html: prepared.html,
        });
        await ensureMessagingDraftV1(draft);
        const metadata = createMessagingSendMetadataV1(draft, {
            idempotencyKey,
            provider: providerLabel,
            requestedAt,
        });
        const dispatchResult = await dispatchOutboundMessage({
            draft,
            metadata,
            provider: {
                async send({ dispatchId }) {
                    let quota;
                    try {
                        const quotaLimits = await getEffectiveDailyQuotaLimits({ userId, organizationId: missionOrgId || undefined });
                        quota = await reserveOutboundContactQuota({
                            dispatchId,
                            userId,
                            organizationId: missionOrgId || undefined,
                            limit: quotaLimits.contact,
                        });
                    } catch (error) {
                        throw new OutboundPreProviderDeferredError(
                            'Contact quota could not be reserved. The provider was not invoked.',
                            { code: 'quota_reservation_unavailable', cause: error },
                        );
                    }
                    if (!quota.allowed) {
                        return {
                            outcome: 'deferred' as const,
                            code: 'daily_quota_exceeded',
                            message: `Daily quota exceeded for contact. Used ${quota.count}/${quota.limit}.`,
                        };
                    }

                    const result = provider === 'google'
                        ? await sendGmail(accessToken, to, subject, finalBody, effectiveIsHtml, idempotencyKey)
                        : await sendOutlook(accessToken, to, subject, finalBody, effectiveIsHtml, idempotencyKey);
                    const providerMessageId = String((result as any).messageId || (result as any).internetMessageId || '').trim();
                    return { outcome: 'accepted' as const, providerMessageId, response: result };
                },
            },
        });
        const result = dispatchResult.dispatch.providerResponse || {};
        if (dispatchResult.status !== 'sent') {
            const dispatchErrorCode = String(dispatchResult.dispatch.errorCode || '').trim();
            const isConfirmedProvider4xx = /_(4\d\d)$/.test(dispatchErrorCode);
            const isDailyQuotaDeferred = dispatchResult.status === 'deferred' && dispatchErrorCode === 'daily_quota_exceeded';
            const responseStatus = isDailyQuotaDeferred
                ? 429
                : dispatchResult.status === 'failed'
                ? isConfirmedProvider4xx ? 422 : 502
                : dispatchResult.status === 'pending' || dispatchResult.status === 'sending' ? 202 : 503;
            return NextResponse.json({
                error: dispatchResult.dispatch.errorMessage || 'Provider outcome is not confirmed.',
                code: isDailyQuotaDeferred
                    ? 'daily_quota_exceeded'
                    : dispatchResult.status === 'deferred'
                        ? dispatchErrorCode || 'OUTBOUND_DEFERRED'
                        : dispatchResult.status === 'failed' ? dispatchErrorCode || 'OUTBOUND_REJECTED' : 'OUTBOUND_UNKNOWN',
                status: dispatchResult.status,
                dispatchId: dispatchResult.dispatch.id,
                retry: dispatchResult.retry,
            }, { status: responseStatus });
        }

        debugLog(`[CONTACT_DEBUG] Email sent successfully via ${provider}`);
        return NextResponse.json({
            success: true,
            provider: providerLabel,
            messageId: (result as any).messageId || null,
            threadId: (result as any).threadId || null,
            conversationId: (result as any).conversationId || null,
            internetMessageId: (result as any).internetMessageId || null,
            dispatchId: dispatchResult.dispatch.id,
            draftId: draft.draftId,
            draftVersionId: draft.versionId,
            contentHash: metadata.contentHash,
            replayed: dispatchResult.replayed,
            trackingId,
        });

    } catch (error: any) {
        console.error('[CONTACT_API] Error:', error);
        if (error instanceof OutboundDispatchConflictError) {
            return NextResponse.json({ error: error.message, code: 'OUTBOUND_CONFLICT', status: 'conflict' }, { status: 409 });
        }
        return NextResponse.json({ error: error.message, code: 'OUTBOUND_UNKNOWN' }, { status: 500 });
    }
}

// --- Helper Functions ---

function escapeODataLiteral(s: string) {
    return s.replace(/'/g, "''");
}

function toGraphIso(dt: Date) {
    return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function findRecentlySentOutlookMessage(token: string, params: { to: string; subject: string; idempotencyKey?: string; lookbackMinutes?: number }) {
    const { to, subject, idempotencyKey, lookbackMinutes = 15 } = params;
    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
    const select = '$select=id,subject,conversationId,internetMessageId,internetMessageHeaders,toRecipients,sentDateTime';
    const order = '$orderby=sentDateTime desc';
    const top = '$top=25';
    const filter = `$filter=sentDateTime ge ${escapeODataLiteral(toGraphIso(since))}`;

    const res = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders('SentItems')/messages?${filter}&${order}&${top}&${select}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ConsistencyLevel: 'eventual',
        },
        cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.value) ? data.value : [];
    const wantedTo = to.trim().toLowerCase();
    const wantedSubject = subject.trim();

    return list.find((message: any) => {
        const subjectMatches = String(message.subject || '').trim() === wantedSubject;
        const recipientMatches = (message.toRecipients || []).some((recipient: any) => String(recipient?.emailAddress?.address || '').trim().toLowerCase() === wantedTo);
        const dispatchMatches = !idempotencyKey || (message.internetMessageHeaders || []).some((header: any) => (
            String(header?.name || '').trim().toLowerCase() === 'x-anton-dispatch'
            && String(header?.value || '').trim() === idempotencyKey
        ));
        return subjectMatches && recipientMatches && dispatchMatches;
    }) || null;
}

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
            scope: 'offline_access User.Read Mail.Send Mail.Read'
        })
    });

    const data = await res.json();
    return data.access_token;
}

async function sendGmail(accessToken: string, to: string, subject: string, body: string, isHtml: boolean = false, idempotencyKey?: string) {
    // Construct raw email
    const contentType = isHtml ? 'text/html' : 'text/plain';
    const safeSubject = encodeHeaderRFC2047(subject);
    const str = [
        `To: ${to}`,
        `Subject: ${safeSubject}`,
        ...(idempotencyKey ? [`X-ANTON-Dispatch: ${sanitizeHeaderText(idempotencyKey)}`] : []),
        `Content-Type: ${contentType}; charset=utf-8`,
        'MIME-Version: 1.0',
        '',
        body
    ].join('\r\n');

    const raw = Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
        if (res.status >= 400 && res.status < 500 && ![408, 409, 425, 429].includes(res.status)) {
            throw new ConfirmedProviderRejectionError(`Gmail rejected the message (${res.status}): ${err}`, {
                code: `gmail_${res.status}`,
                response: { status: res.status, body: err },
            });
        }
        throw new Error(`Gmail outcome is unknown (${res.status}): ${err}`);
    }
    const data = await res.json().catch(() => ({}));
    return { success: true, messageId: data?.id || null, threadId: data?.threadId || null };
}

async function sendOutlook(accessToken: string, to: string, subject: string, body: string, isHtml: boolean = false, idempotencyKey?: string) {
    const safeSubject = sanitizeHeaderText(subject);
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: {
                subject: safeSubject,
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
                ],
                ...(idempotencyKey ? {
                    internetMessageHeaders: [{ name: 'X-ANTON-Dispatch', value: sanitizeHeaderText(idempotencyKey) }],
                } : {})
            },
            saveToSentItems: true
        })
    });

    if (!res.ok) {
        const err = await res.text();
        if (res.status >= 400 && res.status < 500 && ![408, 409, 425, 429].includes(res.status)) {
            throw new ConfirmedProviderRejectionError(`Outlook rejected the message (${res.status}): ${err}`, {
                code: `outlook_${res.status}`,
                response: { status: res.status, body: err },
            });
        }
        throw new Error(`Outlook outcome is unknown (${res.status}): ${err}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const sentMeta = await findRecentlySentOutlookMessage(accessToken, { to, subject: safeSubject, idempotencyKey }).catch(() => null);
    return {
        success: true,
        messageId: sentMeta?.id || null,
        conversationId: sentMeta?.conversationId || null,
        internetMessageId: sentMeta?.internetMessageId || null,
    };
}
