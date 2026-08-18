import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { evaluateLeadForReactivation, getLeadLastContactAt, normalizeCampaignSettings } from '@/lib/campaign-settings';
import { buildCampaignPersonalization } from '@/lib/server/campaign-reconnection';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { prepareOutboundEmail } from '@/lib/email-outbound';
import { findPriorReplyMatch, hasLeadReplied } from '@/lib/contact-history-guard';
import { buildThreadKey, deriveLifecycleState, safeInsertEmailEvent } from '@/lib/email-observability';
import { decryptTokenRecords, encryptStoredToken } from '@/lib/server/token-crypto';
import { syncRepliesForOrganization } from '@/lib/server/reply-sync';
import { createLegacyReadyEmailDraftV1, createMessagingSendMetadataV1 } from '@/lib/messaging-contracts';
import { ensureMessagingDraftV1 } from '@/lib/server/messaging-drafts';
import { dispatchOutboundMessage, OutboundPreProviderDeferredError } from '@/lib/server/outbound-dispatch';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import { prepareEmailTracking } from '@/lib/server/tracking-token';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CampaignAudienceInput = {
    campaignId: unknown;
    campaignType?: unknown;
    audienceKind?: unknown;
    lead: {
        campaign_id?: unknown;
        data?: {
            campaign_id?: unknown;
            campaignId?: unknown;
        } | null;
    };
};

function doesLeadBelongToCampaignAudience(input: CampaignAudienceInput) {
    const campaignId = String(input.campaignId || '').trim();
    if (!campaignId) return false;

    const campaignType = String(input.campaignType || '').trim().toLowerCase();
    const audienceKind = String(input.audienceKind || '').trim().toLowerCase();
    if (campaignType === 'reconnection') {
        return audienceKind === 'reactivation';
    }

    const lineageIds = [
        input.lead.campaign_id,
        input.lead.data?.campaign_id,
        input.lead.data?.campaignId,
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

    return lineageIds.length > 0 && lineageIds.every((lineageId) => lineageId === campaignId);
}

export async function GET(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization');
        const cronSecret = String(process.env.CRON_SECRET || '').trim();
        const providedBearer = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
        const providedCronSecret = String(req.headers.get('x-cron-secret') || '').trim();

        if (!cronSecret || (providedBearer !== cronSecret && providedCronSecret !== cronSecret)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const dryRunParam = String(req.nextUrl.searchParams.get('dryRun') || '').toLowerCase();
        const dryRun = dryRunParam === '1' || dryRunParam === 'true' || dryRunParam === 'yes';
        const includeDetailsParam = String(req.nextUrl.searchParams.get('includeDetails') || '').toLowerCase();
        const includeDetails = includeDetailsParam === '1' || includeDetailsParam === 'true' || includeDetailsParam === 'yes';
        const organizationIdParam = req.nextUrl.searchParams.get('organizationId');
        const organizationIdFilter = organizationIdParam === null ? null : organizationIdParam.trim();
        if (organizationIdParam !== null && (!organizationIdFilter || !UUID_PATTERN.test(organizationIdFilter))) {
            return NextResponse.json({ error: 'organizationId must be a UUID when provided' }, { status: 400 });
        }

        // 1. Init Supabase Admin
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseServiceKey) {
            return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false },
        });

        // 2. Get all users with tokens
        const { data: tokenOwners, error: tokenOwnersError } = await supabase.from('provider_tokens').select('user_id');
        if (tokenOwnersError) throw tokenOwnersError;
        if (!tokenOwners || tokenOwners.length === 0) {
            return NextResponse.json({ message: 'No tokens found' });
        }

        const results: any[] = [];
        const deferredCodes = new Set<string>();
        const summary = {
            sent: 0,
            failed: 0,
            deferred: 0,
            eligibleDryRun: 0,
            blockedUnsubscribed: 0,
            blockedDomain: 0,
        };
        const unsubCache = new Map<string, Set<string>>();
        const domainCache = new Map<string, Set<string>>();

        // 3. Process each user
        const users = [...new Set(tokenOwners.map((token) => token.user_id))];

        for (const userId of users) {
            const { data: rawUserTokens, error: userTokensError } = await supabase
                .from('provider_tokens')
                .select('*')
                .eq('user_id', userId);
            if (userTokensError) throw userTokensError;
            const tokens = decryptTokenRecords(rawUserTokens);

            // Get user's active campaigns
            let campaignsQuery = supabase
                .from('campaigns')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'active');
            if (organizationIdFilter) {
                campaignsQuery = campaignsQuery.eq('organization_id', organizationIdFilter);
            }
            const { data: campaigns, error: campaignsError } = await campaignsQuery;
            if (campaignsError) throw campaignsError;

            if (!campaigns || campaigns.length === 0) continue;

            if (!dryRun) {
                const campaignOrganizationIds = Array.from(new Set<string>(campaigns.map((campaign: any) => String(campaign.organization_id || '').trim()).filter(Boolean)));
                for (const organizationId of campaignOrganizationIds) {
                    await syncRepliesForOrganization(supabase, { organizationId, userId, limit: 300 }).catch((error) => {
                        console.warn('[process-campaigns] reply sync skipped:', error?.message || error);
                    });
                }
            }

            const campaignIds = campaigns
                .filter((campaign: any) => String(campaign.organization_id || '').trim())
                .map((campaign: any) => campaign.id)
                .filter(Boolean);
            const stepsByCampaign: Record<string, any[]> = {};

            if (campaignIds.length > 0) {
                const { data: stepsRows, error: stepsError } = await supabase
                    .from('campaign_steps')
                    .select('*')
                    .in('campaign_id', campaignIds)
                    .order('order_index', { ascending: true });
                if (stepsError) throw stepsError;

                (stepsRows || []).forEach((s: any) => {
                    if (!stepsByCampaign[s.campaign_id]) stepsByCampaign[s.campaign_id] = [];
                    stepsByCampaign[s.campaign_id].push(s);
                });
            }

            // Process campaigns
            const isWithinSmartWindow = (settings?: any) => {
                if (!settings?.smartScheduling?.enabled) return true;
                const tz = settings.smartScheduling.timezone || 'UTC';
                const startHour = Number(settings.smartScheduling.startHour ?? 9);
                const endHour = Number(settings.smartScheduling.endHour ?? 17);
                try {
                    const now = new Date();
                    const parts = new Intl.DateTimeFormat('en-US', {
                        timeZone: tz,
                        hour: '2-digit',
                        hour12: false,
                    }).formatToParts(now);
                    const hourStr = parts.find(p => p.type === 'hour')?.value || '0';
                    const hour = Number(hourStr);
                    if (Number.isNaN(hour)) return true;
                    if (startHour <= endHour) {
                        return hour >= startHour && hour < endHour;
                    }
                    return hour >= startHour || hour < endHour; // overnight window
                } catch (e) {
                    console.warn('[process-campaigns] Invalid timezone, skipping smartScheduling:', tz, e);
                    return true;
                }
            };

            for (const campaign of campaigns) {
                const organizationId = String(campaign.organization_id || '').trim();
                if (!organizationId) {
                    results.push({
                        campaignId: campaign.id,
                        status: 'skipped',
                        reason: 'missing_organization_id',
                    });
                    continue;
                }

                const settings = normalizeCampaignSettings(campaign.settings);
                const steps = stepsByCampaign[campaign.id] || [];
                const excluded: string[] = campaign.excluded_lead_ids || [];
                const sentRecords: Record<string, any> = { ...(campaign.sent_records || {}) };
                const campaignSummary = {
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    campaignType: campaign.campaign_type || (settings.audience?.kind === 'reactivation' ? 'reconnection' : 'follow_up'),
                    eligibleCount: 0,
                    sentCount: 0,
                    replayedCount: 0,
                    failedCount: 0,
                    deferredCount: 0,
                    blockedUnsubscribed: 0,
                    blockedDomain: 0,
                    skippedMissingToken: 0,
                    skippedUnsupportedProvider: 0,
                };

                const tracking = settings.tracking;
                const trackingEnabled = Boolean(tracking?.enabled);
                const trackLinks = trackingEnabled && (tracking?.linkTracking ?? true);
                const trackPixel = trackingEnabled && (tracking?.pixel ?? true);

                const { data: leads, error: leadsError } = await supabase
                    .from('contacted_leads')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('organization_id', organizationId);
                if (leadsError) throw leadsError;
                const priorReplyRows = (leads || []).filter((lead: any) => hasLeadReplied({
                    repliedAt: lead.replied_at,
                    status: lead.status,
                    replyIntent: lead.reply_intent,
                    lastReplyText: lead.last_reply_text,
                } as any));

                if (!steps.length) {
                    if (!dryRun) {
                        await supabase
                            .from('campaigns')
                            .update({
                                last_run_at: new Date().toISOString(),
                                last_run_status: 'skipped',
                                last_run_summary: { ...campaignSummary, reason: 'missing_steps' },
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', campaign.id)
                            .eq('user_id', userId)
                            .eq('organization_id', organizationId);
                    }
                    continue;
                }
                if (!isWithinSmartWindow(settings)) {
                    if (!dryRun) {
                        await supabase
                            .from('campaigns')
                            .update({
                                last_run_at: new Date().toISOString(),
                                last_run_status: 'skipped',
                                last_run_summary: { ...campaignSummary, reason: 'outside_smart_window' },
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', campaign.id)
                            .eq('user_id', userId)
                            .eq('organization_id', organizationId);
                    }
                    continue;
                }

                const getUnsubscribedSet = async (orgId?: string | null) => {
                    const key = `${orgId || 'none'}:${userId}`;
                    if (unsubCache.has(key)) return unsubCache.get(key)!;

                    const query = orgId
                        ? supabase
                            .from('unsubscribed_emails')
                            .select('email, user_id, organization_id')
                            .or(`user_id.eq.${userId},organization_id.eq.${orgId},and(user_id.is.null,organization_id.is.null)`)
                        : supabase
                            .from('unsubscribed_emails')
                            .select('email, user_id, organization_id')
                            .or(`user_id.eq.${userId},and(user_id.is.null,organization_id.is.null)`);

                    const { data, error } = await query;
                    if (error) throw error;
                    const set = new Set((data || []).map((r: any) => String(r.email || '').toLowerCase()));
                    unsubCache.set(key, set);
                    return set;
                };

                const getBlockedDomains = async (orgId?: string | null) => {
                    const key = orgId || 'none';
                    if (domainCache.has(key)) return domainCache.get(key)!;
                    if (!orgId) {
                        const empty = new Set<string>();
                        domainCache.set(key, empty);
                        return empty;
                    }

                    const { data, error } = await supabase
                        .from('excluded_domains')
                        .select('domain')
                        .eq('organization_id', orgId);
                    if (error) throw error;
                    const set = new Set((data || []).map((r: any) => String(r.domain || '').toLowerCase()));
                    domainCache.set(key, set);
                    return set;
                };

                // Check eligibility
                for (const lead of leads || []) {
                    const currentNow = new Date();
                    let audienceMatchReason: string | undefined;
                    const leadKey = String(lead.lead_id || lead.id || '').trim();
                    if (!leadKey) continue;

                    if (!doesLeadBelongToCampaignAudience({
                        campaignId: campaign.id,
                        campaignType: campaign.campaign_type,
                        audienceKind: settings.audience?.kind,
                        lead,
                    })) continue;

                    // Skip if excluded or replied
                    if (excluded.includes(leadKey)) continue;
                    if (lead.campaign_followup_allowed === false) continue;
                    if (findPriorReplyMatch({ id: lead.lead_id || lead.id, email: lead.email }, priorReplyRows as any[])) continue;
                    if (lead.status === 'replied' && lead.campaign_followup_allowed !== true) continue;
                    if (lead.status === 'replied' && !lead.reply_intent) continue;
                    if (!lead.email) continue;

                    const email = String(lead.email || '').trim().toLowerCase();
                    const domain = email.split('@')[1] || '';
                    const unsubscribed = await getUnsubscribedSet(organizationId);
                    const blockedDomains = await getBlockedDomains(organizationId);

                    if (email && unsubscribed.has(email)) {
                        summary.blockedUnsubscribed += 1;
                        campaignSummary.blockedUnsubscribed += 1;
                        if (!dryRun) {
                            await supabase
                                .from('contacted_leads')
                                .update({
                                    campaign_followup_allowed: false,
                                    campaign_followup_reason: 'unsubscribed',
                                    evaluation_status: 'do_not_contact',
                                    last_update_at: new Date().toISOString(),
                                } as any)
                                .eq('id', lead.id)
                                .eq('user_id', userId)
                                .eq('organization_id', organizationId);
                        }
                        continue;
                    }

                    if (domain && blockedDomains.has(domain)) {
                        summary.blockedDomain += 1;
                        campaignSummary.blockedDomain += 1;
                        if (!dryRun) {
                            await supabase
                                .from('contacted_leads')
                                .update({
                                    campaign_followup_allowed: false,
                                    campaign_followup_reason: 'domain_blocked',
                                    last_update_at: new Date().toISOString(),
                                } as any)
                                .eq('id', lead.id)
                                .eq('user_id', userId)
                                .eq('organization_id', organizationId);
                        }
                        continue;
                    }

                    if (settings.audience?.kind === 'reactivation') {
                        const audience = evaluateLeadForReactivation(
                            {
                                status: lead.status,
                                sentAt: lead.sent_at,
                                lastFollowUpAt: lead.last_follow_up_at,
                                lastInteractionAt: lead.last_interaction_at,
                                repliedAt: lead.replied_at,
                                openedAt: lead.opened_at,
                                clickedAt: lead.clicked_at,
                                clickCount: lead.click_count,
                                deliveredAt: lead.delivered_at,
                                readReceiptMessageId: lead.read_receipt_message_id,
                                deliveryReceiptMessageId: lead.delivery_receipt_message_id,
                                replyIntent: lead.reply_intent,
                                campaignFollowupAllowed: lead.campaign_followup_allowed,
                                evaluationStatus: lead.evaluation_status,
                            },
                            settings.audience.reactivation,
                            currentNow,
                        );

                        if (!audience.matched) continue;
                        audienceMatchReason = audience.primaryLabel || undefined;
                    }

                    // Determine next step
                    const record = sentRecords[leadKey];
                    let nextStepIdx = 0;
                    if (record) {
                        nextStepIdx = record.lastStepIdx + 1;
                    }

                    if (nextStepIdx >= steps.length) continue; // Finished

                    const step = steps[nextStepIdx];
                    const offsetDays = Number(step.offset_days ?? step.offsetDays ?? 0);

                    // Check timing
                    const lastAtStr = record?.lastSentAt || getLeadLastContactAt({
                        sentAt: lead.sent_at,
                        lastFollowUpAt: lead.last_follow_up_at,
                        lastInteractionAt: lead.last_interaction_at,
                        repliedAt: lead.replied_at,
                        openedAt: lead.opened_at,
                        clickedAt: lead.clicked_at,
                        deliveredAt: lead.delivered_at,
                    }) || lead.sent_at;
                    if (!lastAtStr) continue;

                    const lastAt = new Date(lastAtStr);
                    const diffTime = Math.abs(currentNow.getTime() - lastAt.getTime());
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays < offsetDays) continue;

                    // ELIGIBLE! Send email.
                    campaignSummary.eligibleCount += 1;

                    // Get provider token
                    // contacted_leads.provider can be 'gmail'|'outlook' (UI) or legacy 'google'|'outlook'
                    const leadProvider = lead.provider;
                    const tokenProvider = leadProvider === 'gmail' ? 'google' : leadProvider;

                    if (dryRun) {
                        summary.eligibleDryRun += 1;
                        results.push({
                            lead: lead.email,
                            status: 'eligible_dry_run',
                            campaignId: campaign.id,
                            step: nextStepIdx,
                            provider: tokenProvider,
                        });
                        continue;
                    }

                    if (tokenProvider !== 'google' && tokenProvider !== 'outlook') {
                        console.log(`Unsupported provider for follow-up: ${leadProvider}`);
                        campaignSummary.skippedUnsupportedProvider += 1;
                        continue;
                    }

                    const userToken = tokens.find((token: any) => {
                        if (token.user_id !== userId || token.provider !== tokenProvider) return false;
                        return !Object.prototype.hasOwnProperty.call(token, 'organization_id')
                            || String(token.organization_id || '').trim() === organizationId;
                    });

                    if (!userToken) {
                        console.log(`No token for user ${userId} provider ${tokenProvider}`);
                        campaignSummary.skippedMissingToken += 1;
                        continue;
                    }

                    if (!userToken.refresh_token) {
                        console.log(`Token for user ${userId} provider ${tokenProvider} could not be decrypted`);
                        campaignSummary.skippedMissingToken += 1;
                        continue;
                    }

                    // Refresh token
                    let accessToken = '';
                    try {
                        if (tokenProvider === 'google') {
                            const refreshed = await refreshGoogleToken(userToken.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
                            accessToken = refreshed.access_token;
                        } else if (tokenProvider === 'outlook') {
                            const refreshed = await refreshMicrosoftToken(userToken.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
                            accessToken = refreshed.access_token;
                            if (refreshed.refresh_token) {
                                let tokenUpdate = supabase
                                    .from('provider_tokens')
                                    .update({ refresh_token: encryptStoredToken(refreshed.refresh_token), updated_at: new Date().toISOString() })
                                    .eq('user_id', userId)
                                    .eq('provider', 'outlook');
                                if (Object.prototype.hasOwnProperty.call(userToken, 'organization_id')) {
                                    tokenUpdate = tokenUpdate.eq('organization_id', organizationId);
                                }
                                await tokenUpdate;
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to refresh token for user ${userId}:`, e);
                        continue;
                    }

                    // Send Email
                    try {
                        // REWRITE LINKS & INJECT PIXEL
                        const trackingId = lead.id;

                        const personalized = await buildCampaignPersonalization({
                            campaign: {
                                id: campaign.id,
                                name: campaign.name,
                                settings,
                            },
                            step: {
                                name: step.name,
                                offsetDays: step.offset_days,
                                subject: step.subject_template,
                                bodyHtml: step.body_template,
                            },
                            stepIndex: nextStepIdx,
                            totalSteps: steps.length,
                            contactedLead: {
                                id: lead.id,
                                leadId: lead.lead_id,
                                name: lead.name,
                                email: lead.email,
                                company: lead.company,
                                role: lead.role,
                                industry: lead.industry,
                                city: lead.city,
                                country: lead.country,
                                provider: lead.provider,
                                subject: lead.subject,
                                sentAt: lead.sent_at,
                                status: lead.status,
                                conversationId: lead.conversation_id,
                                threadId: lead.thread_id,
                                internetMessageId: lead.internet_message_id,
                                openedAt: lead.opened_at,
                                clickedAt: lead.clicked_at,
                                clickCount: lead.click_count,
                                deliveredAt: lead.delivered_at,
                                deliveryStatus: lead.delivery_status,
                                repliedAt: lead.replied_at,
                                lastFollowUpAt: lead.last_follow_up_at,
                                lastInteractionAt: lead.last_interaction_at,
                                campaignFollowupAllowed: lead.campaign_followup_allowed,
                                replyIntent: lead.reply_intent,
                                evaluationStatus: lead.evaluation_status,
                                bounceCategory: lead.bounce_category,
                                bounceReason: lead.bounce_reason,
                                bouncedAt: lead.bounced_at,
                            } as any,
                            userId,
                            organizationId,
                            matchReason: audienceMatchReason,
                            daysSinceLastContact: diffDays,
                        });

                        let subject = personalized.subject;
                        let body = personalized.bodyHtml;

                        if (trackLinks || trackPixel) {
                            body = prepareEmailTracking({
                                html: body,
                                contactedId: trackingId,
                                organizationId,
                                trackLinks,
                                trackPixel,
                            });
                        }

                        const unsubscribeUrl = generateUnsubscribeLink(lead.email, userId, organizationId);
                        const prepared = prepareOutboundEmail({ html: body, unsubscribeUrl });
                        body = prepared.html;

                        const providerLabel = tokenProvider === 'google' ? 'gmail' : 'outlook';
                        const requestedAt = new Date().toISOString();
                        const idempotencyKey = `campaign:${campaign.id}:${lead.id}:step:${nextStepIdx}`;
                        const draft = createLegacyReadyEmailDraftV1({
                            organizationId,
                            userId,
                            idempotencyKey,
                            requestedAt,
                            leadRef: lead.lead_id || lead.id,
                            displayName: lead.name,
                            to: lead.email,
                            subject,
                            text: prepared.text,
                            html: body,
                        });
                        await ensureMessagingDraftV1(draft);
                        const messagingMetadata = createMessagingSendMetadataV1(draft, {
                            idempotencyKey,
                            provider: providerLabel,
                            requestedAt,
                        });
                        const dispatchResult = await dispatchOutboundMessage({
                            draft,
                            metadata: messagingMetadata,
                            provider: {
                                async send({ dispatchId }) {
                                    let quota;
                                    try {
                                        const quotaLimits = await getEffectiveDailyQuotaLimits({
                                            userId,
                                            organizationId,
                                        });
                                        quota = await reserveOutboundContactQuota({
                                            dispatchId,
                                            userId,
                                            organizationId,
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
                                    const result = tokenProvider === 'google'
                                        ? await sendGmail(accessToken, lead.email, subject, body, { textBody: prepared.text, unsubscribeUrl, idempotencyKey })
                                        : await sendOutlook(accessToken, lead.email, subject, body, { textBody: prepared.text, unsubscribeUrl, idempotencyKey });
                                    const providerMessageId = String(result?.id || result?.messageId || result?.internetMessageId || '').trim();
                                    return { outcome: 'accepted' as const, providerMessageId, response: result };
                                },
                            },
                        });
                        if (dispatchResult.status === 'deferred') {
                            const deferredCode = dispatchResult.dispatch.errorCode || 'OUTBOUND_DEFERRED';
                            deferredCodes.add(deferredCode);
                            summary.deferred += 1;
                            campaignSummary.deferredCount += 1;
                            results.push({
                                lead: lead.email,
                                status: 'deferred',
                                code: deferredCode,
                                error: dispatchResult.dispatch.errorMessage,
                                retry: dispatchResult.retry,
                            });
                            continue;
                        }
                        if (dispatchResult.status !== 'sent') {
                            throw new Error(dispatchResult.dispatch.errorMessage || `Dispatch ${dispatchResult.status}`);
                        }
                        const sentAt = new Date().toISOString();
                        sentRecords[leadKey] = { lastStepIdx: nextStepIdx, lastSentAt: sentAt };
                        if (dispatchResult.replayed) {
                            campaignSummary.replayedCount += 1;
                            results.push({ lead: lead.email, status: 'replayed' });
                            continue;
                        }
                        const sendResult: any = dispatchResult.dispatch.providerResponse || {};

                        const threadKey = buildThreadKey({
                            provider: tokenProvider === 'google' ? 'gmail' : 'outlook',
                            threadId: sendResult?.threadId,
                            conversationId: sendResult?.conversationId,
                            internetMessageId: sendResult?.internetMessageId,
                            messageId: sendResult?.id || sendResult?.messageId,
                        });

                        // Update lead
                        await supabase.from('contacted_leads').update({
                            last_follow_up_at: sentAt,
                            last_step_idx: nextStepIdx,
                            follow_up_count: (lead.follow_up_count || 0) + 1,
                            message_id: sendResult?.id || sendResult?.messageId || lead.message_id || null,
                            thread_id: sendResult?.threadId || lead.thread_id || null,
                            conversation_id: sendResult?.conversationId || lead.conversation_id || null,
                            internet_message_id: sendResult?.internetMessageId || lead.internet_message_id || null,
                            thread_key: threadKey,
                            lifecycle_state: deriveLifecycleState(lead.lifecycle_state || lead.status, 'sent'),
                            last_event_type: 'sent',
                            last_event_at: sentAt,
                        })
                            .eq('id', lead.id)
                            .eq('user_id', userId)
                            .eq('organization_id', organizationId);

                        await safeInsertEmailEvent(supabase, {
                            organization_id: organizationId,
                            contacted_id: lead.id,
                            lead_id: lead.lead_id || null,
                            provider: tokenProvider === 'google' ? 'gmail' : 'outlook',
                            event_type: 'sent',
                            event_source: 'campaign_cron',
                            event_at: sentAt,
                            thread_key: threadKey,
                            message_id: sendResult?.id || sendResult?.messageId || null,
                            internet_message_id: sendResult?.internetMessageId || null,
                             meta: {
                                 subject,
                                 stepIndex: nextStepIdx,
                                 campaignId: campaign.id,
                                 draftId: draft.draftId,
                                 draftVersionId: draft.versionId,
                                 contentHash: messagingMetadata.contentHash,
                                 dispatchId: dispatchResult.dispatch.id,
                             },
                        });

                        summary.sent += 1;
                        campaignSummary.sentCount += 1;
                        results.push({ lead: lead.email, status: 'sent' });

                    } catch (e) {
                        console.error(`Failed to send to ${lead.email}:`, e);
                        summary.failed += 1;
                        campaignSummary.failedCount += 1;
                        results.push({ lead: lead.email, status: 'failed', error: e });
                    }
                }

                if (!dryRun) {
                    const successfulCount = campaignSummary.sentCount + campaignSummary.replayedCount;
                    const lastRunStatus = successfulCount > 0 && campaignSummary.failedCount > 0
                        ? 'partial'
                        : successfulCount > 0
                            ? 'success'
                             : campaignSummary.failedCount > 0
                                 ? 'failed'
                                 : campaignSummary.deferredCount > 0
                                     ? 'skipped'
                                 : (campaignSummary.skippedMissingToken > 0 || campaignSummary.skippedUnsupportedProvider > 0)
                                    ? 'skipped'
                                    : 'idle';
                    await supabase
                        .from('campaigns')
                        .update({
                            sent_records: sentRecords,
                            last_run_at: dryRun ? campaign.last_run_at || null : new Date().toISOString(),
                            last_run_status: dryRun ? campaign.last_run_status || null : lastRunStatus,
                            last_run_summary: dryRun ? campaign.last_run_summary || {} : campaignSummary,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', campaign.id)
                        .eq('user_id', userId)
                        .eq('organization_id', organizationId);
                }
            }
        }

        const deferredCode = deferredCodes.size === 1
            ? deferredCodes.values().next().value
            : 'OUTBOUND_DEFERRED';
        const deferredStatus = deferredCodes.size === 1 && deferredCodes.has('daily_quota_exceeded') ? 429 : 503;
        return NextResponse.json({
            dryRun,
            processed: results.length,
            summary,
            resultCount: results.length,
            results: includeDetails ? results.slice(0, 200) : [],
            ...(summary.deferred > 0 ? { code: deferredCode } : {}),
        }, { status: summary.deferred > 0 ? deferredStatus : 200 });

    } catch (e: any) {
        console.error('Cron error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
