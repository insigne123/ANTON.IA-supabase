import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { normalizeConnectedEmailProvider } from '@/lib/email-provider';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import { prepareOutboundEmail, stripHtmlToText, validateOutboundEmail } from '@/lib/email-outbound';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import {
    assertCanonicalEmailSendCompatibilityV1,
    createLegacyReadyEmailDraftV1,
    createMessagingSendMetadataV1,
    resolveApprovedEmailSendV1,
    type MessagingDraftV1,
} from '@/lib/messaging-contracts';
import {
    dispatchOutboundMessage,
    OutboundDispatchConflictError,
    OutboundPreProviderDeferredError,
} from '@/lib/server/outbound-dispatch';
import { ensureMessagingDraftV1, getCurrentMessagingDraftVersionV1 } from '@/lib/server/messaging-drafts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const {
            provider: rawProvider,
            to,
            subject,
            htmlBody,
            textBody,
            organizationId: bodyOrgId,
            leadId,
            researchSnapshotId,
            draftId: requestedDraftId,
            versionId: requestedVersionId,
            idempotencyKey: rawIdempotencyKey,
            requestReceipts,
            tracking,
        } = body;
        const provider = normalizeConnectedEmailProvider(rawProvider);
        const nativeDraftId = String(requestedDraftId || '').trim();
        const nativeVersionId = String(requestedVersionId || '').trim();
        const isCanonicalDraftSend = Boolean(nativeDraftId || nativeVersionId);

        if (!rawProvider) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (isCanonicalDraftSend && (!nativeDraftId || !nativeVersionId)) {
            return NextResponse.json({ error: 'draftId and versionId are required together' }, { status: 400 });
        }
        // Browser-owned content is never eligible for a production send. The
        // branch below remains only for isolated test fixtures, not runtime.
        const allowLegacyFixtureSend = process.env.NODE_ENV === 'test'
            && req.headers.get('x-anton-legacy-fixture') === '1';
        if (!isCanonicalDraftSend && !allowLegacyFixtureSend) {
            return NextResponse.json({
                error: 'APPROVED_DRAFT_REQUIRED',
                message: 'Selecciona un borrador aprobado antes de enviar. El contenido del navegador no se puede enviar directamente.',
            }, {
                status: 409,
                headers: {
                    'Cache-Control': 'no-store',
                    'Deprecation': 'true',
                    'X-Anton-Send-Boundary': 'approved-draft-required',
                },
            });
        }
        if (!isCanonicalDraftSend && (!to || !subject || !htmlBody)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (!provider) {
            return NextResponse.json({ error: `Unsupported provider: ${String(rawProvider)}` }, { status: 400 });
        }
        const dispatchProvider = provider === 'google' ? 'gmail' : 'outlook';

        // --- Unsubscribe / Blacklist Check --- //

        let membershipQuery = supabase
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', user.id);
        membershipQuery = bodyOrgId
            ? membershipQuery.eq('organization_id', bodyOrgId)
            : membershipQuery.order('created_at', { ascending: true }).limit(1);
        const { data: member, error: memberError } = await membershipQuery.maybeSingle();
        if (memberError) {
            console.error('[providers/send] Membership lookup failed:', memberError);
            return NextResponse.json({ error: 'Failed to verify organization membership' }, { status: 500 });
        }
        if (!member?.organization_id) {
            return NextResponse.json({ error: 'User does not belong to the requested organization' }, { status: 403 });
        }
        const orgId = member.organization_id;
        console.log('[providers/send] User:', user.id, 'OrgId:', orgId);

        const requestedIdempotencyKey = String(rawIdempotencyKey || '').trim();
        if (!requestedIdempotencyKey) {
            return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });
        }
        if (requestedIdempotencyKey.length > 200) {
            return NextResponse.json({ error: 'idempotencyKey must be at most 200 characters' }, { status: 400 });
        }
        const requestedResearchSnapshotId = String(researchSnapshotId || '').trim() || null;
        let draft: MessagingDraftV1 | null = null;
        let delivery: { to: string; subject: string; text: string | null; html: string | null } | null = null;
        let canonicalResearchSnapshotId: string | null = null;
        let recipientLeadRef: string | null = null;
        let shouldRequestReceipts = false;

        if (isCanonicalDraftSend) {
            const current = await getCurrentMessagingDraftVersionV1({
                organizationId: orgId,
                userId: user.id,
                draftId: nativeDraftId,
            });
            if (!current) {
                return NextResponse.json({ error: 'Native draft was not found in this organization' }, { status: 404 });
            }
            if (current.versionId !== nativeVersionId) {
                return NextResponse.json({ error: 'Native draft version is no longer current' }, { status: 409 });
            }
            try {
                const canonical = resolveApprovedEmailSendV1(current);
                assertCanonicalEmailSendCompatibilityV1(canonical, {
                    to,
                    subject,
                    text: textBody,
                    html: htmlBody,
                });
                draft = canonical.draft;
                delivery = {
                    to: canonical.to,
                    subject: canonical.subject,
                    text: canonical.text,
                    html: canonical.html,
                };
                canonicalResearchSnapshotId = draft.researchSnapshotId;
                recipientLeadRef = draft.recipient.leadRef;
                shouldRequestReceipts = canonical.deliveryOptions?.requestReceipts === true;
            } catch (error: any) {
                return NextResponse.json({
                    error: error?.message || 'Native draft is not ready to send',
                }, { status: 409 });
            }
        } else {
            const trackingRequestReceipts = tracking && typeof tracking === 'object'
                ? tracking.readReceipt
                : undefined;
            if (requestReceipts !== undefined && typeof requestReceipts !== 'boolean') {
                return NextResponse.json({ error: 'requestReceipts must be a boolean' }, { status: 400 });
            }
            if (trackingRequestReceipts !== undefined && typeof trackingRequestReceipts !== 'boolean') {
                return NextResponse.json({ error: 'tracking.readReceipt must be a boolean' }, { status: 400 });
            }
            if (
                requestReceipts !== undefined
                && trackingRequestReceipts !== undefined
                && requestReceipts !== trackingRequestReceipts
            ) {
                return NextResponse.json({ error: 'Conflicting receipt options were requested' }, { status: 400 });
            }
            shouldRequestReceipts = requestReceipts ?? trackingRequestReceipts ?? false;
            delivery = {
                to: String(to).trim(),
                subject: String(subject).trim(),
                text: textBody === undefined || textBody === null ? null : String(textBody),
                html: htmlBody === undefined || htmlBody === null ? null : String(htmlBody),
            };
            canonicalResearchSnapshotId = requestedResearchSnapshotId;
            recipientLeadRef = String(leadId || '').trim() || null;
        }

        if (!delivery) {
            return NextResponse.json({ error: 'Unable to resolve canonical email content' }, { status: 500 });
        }
        if (provider === 'google' && shouldRequestReceipts) {
            return NextResponse.json({ error: 'Receipt requests are not supported for Gmail' }, { status: 400 });
        }
        if (
            provider === 'google'
            && delivery.text !== null
            && delivery.html !== null
            && delivery.text.trim() !== stripHtmlToText(delivery.html).trim()
        ) {
            return NextResponse.json({
                error: 'Gmail does not support a text part that differs from the HTML body in this send route',
            }, { status: 400 });
        }

        if (canonicalResearchSnapshotId) {
            const { data: snapshot, error: snapshotError } = await supabase
                .from('research_snapshots')
                .select('id,lead_ref,payload')
                .eq('id', canonicalResearchSnapshotId)
                .eq('organization_id', orgId)
                .eq('user_id', user.id)
                .maybeSingle();
            if (snapshotError || !snapshot) {
                return NextResponse.json({ error: 'Research snapshot does not belong to this send scope' }, { status: 400 });
            }
            const snapshotLeadRef = String(snapshot.lead_ref || '').trim();
            const snapshotEmail = String(snapshot.payload?.subject?.email || '').trim().toLowerCase();
            const recipientEmail = delivery.to.trim().toLowerCase();
            const matchesLead = Boolean(recipientLeadRef && snapshotLeadRef === recipientLeadRef);
            const matchesEmail = Boolean(snapshotEmail && snapshotEmail === recipientEmail);
            if (!matchesLead && !matchesEmail) {
                return NextResponse.json({ error: 'Research snapshot does not match the recipient lead' }, { status: 400 });
            }
        }
        const blocked = await isEmailSuppressedForScope(delivery.to, { userId: user.id, organizationId: orgId });

        if (blocked) {
            console.warn(`Blocked email attempt to ${delivery.to} (User: ${user.id}, Org: ${orgId})`);
            // We return success to not break bulk flows, but with a warning or separate status?
            // Actually, usually we soft-fail or error. 
            // If we error, the frontend 'sendBulk' will count it as fail. That is appropriate.
            return NextResponse.json({ error: 'El destinatario se ha dado de baja de tus envíos.' }, { status: 403 });
        }

        // Check if domain is blacklisted
        const domain = delivery.to.split('@')[1]?.toLowerCase().trim();
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
                console.warn(`Blocked domain attempt to ${delivery.to} (Domain: ${domain}, User: ${user.id}, Org: ${orgId})`);
                return NextResponse.json({ error: `El dominio ${domain} está bloqueado por tu organización.` }, { status: 403 });
            }
        } else {
            console.log('[providers/send] Skipping domain check - domain:', domain, 'orgId:', orgId);
        }

        const unsubscribeUrl = generateUnsubscribeLink(delivery.to, user.id, orgId);

        const prepared = prepareOutboundEmail({
            html: delivery.html ?? undefined,
            text: delivery.text ?? undefined,
            unsubscribeUrl,
        });
        const preflight = validateOutboundEmail({
            to: delivery.to,
            subject: delivery.subject,
            html: prepared.html,
            text: prepared.text,
            requireUnsubscribe: true,
            unsubscribeUrl,
        });
        if (!preflight.ok) {
            return NextResponse.json({ error: preflight.errors.join(' ') }, { status: 400 });
        }

        const requestedAt = new Date().toISOString();
        const idempotencyKey = requestedIdempotencyKey;
        if (!draft) {
            draft = createLegacyReadyEmailDraftV1({
                organizationId: orgId,
                userId: user.id,
                idempotencyKey,
                requestedAt,
                researchSnapshotId: canonicalResearchSnapshotId,
                leadRef: recipientLeadRef,
                to: delivery.to,
                subject: delivery.subject,
                text: String(prepared.text || '').trim() || null,
                html: String(prepared.html).trim(),
                ...(shouldRequestReceipts ? { deliveryOptions: { requestReceipts: true } } : {}),
            });
            await ensureMessagingDraftV1(draft);
        }
        const sendDraft = draft;

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

        if (isCanonicalDraftSend) {
            const current = await getCurrentMessagingDraftVersionV1({
                organizationId: orgId,
                userId: user.id,
                draftId: nativeDraftId,
            });
            if (!current || current.versionId !== sendDraft.versionId) {
                return NextResponse.json({ error: 'Native draft version is no longer current' }, { status: 409 });
            }
        }

        const messagingMetadata = createMessagingSendMetadataV1(sendDraft, {
            idempotencyKey,
            provider: dispatchProvider,
            requestedAt,
        });

        const dispatchResult = await dispatchOutboundMessage({
            draft: sendDraft,
            metadata: messagingMetadata,
            provider: {
                async send({ dispatchId }) {
                    let quota;
                    try {
                        const quotaLimits = await getEffectiveDailyQuotaLimits({ userId: user.id, organizationId: orgId });
                        quota = await reserveOutboundContactQuota({
                            dispatchId,
                            userId: user.id,
                            organizationId: orgId,
                            limit: quotaLimits.contact,
                        });
                    } catch (error) {
                        throw new OutboundPreProviderDeferredError(
                            'Contact quota could not be reserved. The provider was not invoked.',
                            { code: 'quota_reservation_unavailable', cause: error },
                        );
                    }
                    const { allowed, count, limit } = quota;
                    if (!allowed) {
                        return {
                            outcome: 'deferred' as const,
                            code: 'daily_quota_exceeded',
                            message: `Daily quota exceeded for contact. Used ${count}/${limit}.`,
                        };
                    }

                    const providerReceipt = provider === 'google'
                        ? await sendGmail(accessToken, delivery.to, delivery.subject, prepared.html, { textBody: prepared.text, unsubscribeUrl, idempotencyKey })
                        : await sendOutlook(accessToken, delivery.to, delivery.subject, prepared.html, {
                            textBody: prepared.text,
                            unsubscribeUrl,
                            idempotencyKey,
                            requestReceipts: sendDraft.content.deliveryOptions?.requestReceipts === true,
                        });
                    const receipt = providerReceipt && typeof providerReceipt === 'object' ? providerReceipt as Record<string, unknown> : {};
                    const providerMessageId = String(receipt.id || receipt.messageId || receipt.internetMessageId || '').trim();
                    return { outcome: 'accepted' as const, providerMessageId, response: receipt };
                },
            },
        });

        const dispatch = dispatchResult.dispatch;
        if (!dispatch) {
            return NextResponse.json({
                success: false,
                status: 'unknown',
                error: 'No se pudo confirmar un registro durable para el envío.',
            }, { status: 502 });
        }
        const receipt = {
            dispatchId: dispatch.id,
            status: dispatchResult.status,
            replayed: dispatchResult.replayed,
            idempotencyKey: dispatch.idempotencyKey,
            providerMessageId: dispatch.providerMessageId,
            providerResponse: dispatch.providerResponse,
            errorCode: dispatch.errorCode,
            errorMessage: dispatch.errorMessage,
            retry: dispatchResult.retry,
        };
        const success = dispatchResult.status === 'sent';
        const status = dispatchResult.status === 'sent'
            ? 200
            : dispatchResult.status === 'pending' || dispatchResult.status === 'sending'
                ? 202
                : dispatchResult.status === 'deferred' && dispatch.errorCode === 'daily_quota_exceeded'
                    ? 429
                    : dispatchResult.status === 'deferred' ? 503 : 502;
        return NextResponse.json({
            success,
            status: dispatchResult.status,
            receipt,
            ...(!success ? {
                error: receipt.errorMessage || 'El proveedor no confirmó el envío.',
                code: receipt.errorCode || 'OUTBOUND_UNKNOWN',
            } : {}),
        }, { status });

    } catch (e: any) {
        console.error('Send proxy error:', e);
        if (e instanceof OutboundDispatchConflictError) {
            return NextResponse.json({ error: e.message, status: 'conflict' }, { status: 409 });
        }
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
