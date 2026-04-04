import { supabase } from '../supabase';
import type { ContactedLead } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { organizationService } from './organization-service';
import { buildThreadKey } from '../email-observability';

const TABLE = 'contacted_leads';

function mapRowToContactedLead(row: any): ContactedLead {
    return {
        id: row.id,
        organizationId: row.organization_id,
        leadId: row.lead_id,
        name: row.name,
        email: row.email,
        company: row.company,
        role: row.role,
        industry: row.industry,
        city: row.city,
        country: row.country,
        subject: row.subject,
        sentAt: row.sent_at,
        status: row.status,
        provider: row.provider,
        messageId: row.message_id,
        conversationId: row.conversation_id,
        internetMessageId: row.internet_message_id,
        threadId: row.thread_id,
        repliedAt: row.replied_at,
        lastReplyText: row.last_reply_text,
        openedAt: row.opened_at,
        clickedAt: row.clicked_at,
        clickCount: row.click_count,
        deliveredAt: row.delivered_at,
        readReceiptMessageId: row.read_receipt_message_id,
        deliveryReceiptMessageId: row.delivery_receipt_message_id,
        deliveryStatus: row.delivery_status,
        bouncedAt: row.bounced_at,
        bounceCategory: row.bounce_category,
        bounceReason: row.bounce_reason,
        threadKey: row.thread_key,
        lifecycleState: row.lifecycle_state,
        lastEventType: row.last_event_type,
        lastEventAt: row.last_event_at,
        preflightStatus: row.preflight_status,
        preflightReason: row.preflight_reason,
        lastUpdateAt: row.last_update_at,
        lastInteractionAt: row.last_interaction_at,
        engagementScore: row.engagement_score,
        evaluationStatus: row.evaluation_status,
        scheduledAt: row.scheduled_at,
        linkedinThreadUrl: row.linkedin_thread_url,
        linkedinMessageStatus: row.linkedin_message_status,
        replyPreview: row.reply_preview,
        replyMessageId: row.reply_message_id,
        replySubject: row.reply_subject,
        replySnippet: row.reply_snippet,
        followUpCount: row.follow_up_count,
        lastFollowUpAt: row.last_follow_up_at,
        lastStepIdx: row.last_step_idx,
        replyIntent: row.reply_intent,
        replySentiment: row.reply_sentiment,
        replyConfidence: row.reply_confidence,
        replySummary: row.reply_summary,
        campaignFollowupAllowed: row.campaign_followup_allowed,
        campaignFollowupReason: row.campaign_followup_reason,
    };
}

function mapContactedLeadToRow(item: ContactedLead, userId: string, organizationId: string | null) {
  const id = item.id || uuidv4();
    const threadKey = item.threadKey || buildThreadKey({
        provider: item.provider,
        threadId: item.threadId,
        conversationId: item.conversationId,
        internetMessageId: item.internetMessageId,
        messageId: item.messageId,
    });
    return {
        id,
        user_id: userId,
        organization_id: organizationId,
        lead_id: item.leadId,
        name: item.name,
        email: item.email,
        company: item.company,
        role: item.role,
        industry: item.industry,
        city: item.city,
        country: item.country,
        subject: item.subject,
        sent_at: item.sentAt,
        status: item.status,
        provider: item.provider,
        message_id: item.messageId,
        conversation_id: item.conversationId,
        internet_message_id: item.internetMessageId,
        thread_id: item.threadId,
        thread_key: threadKey,
        scheduled_at: item.scheduledAt,
        linkedin_thread_url: item.linkedinThreadUrl,
        linkedin_message_status: item.linkedinMessageStatus,
        lifecycle_state: item.lifecycleState || 'sent',
        last_event_type: item.lastEventType || 'sent',
        last_event_at: item.lastEventAt || item.sentAt || new Date().toISOString(),
        preflight_status: item.preflightStatus || 'ok',
        preflight_reason: item.preflightReason || null,
        last_reply_text: item.lastReplyText,
        reply_preview: item.replyPreview,
        ...(item.replyMessageId ? { reply_message_id: item.replyMessageId } : {}),
        ...(item.replySubject ? { reply_subject: item.replySubject } : {}),
        ...(item.replySnippet ? { reply_snippet: item.replySnippet } : {}),
        delivery_status: item.deliveryStatus || 'unknown',
        bounced_at: item.bouncedAt,
        bounce_category: item.bounceCategory,
        bounce_reason: item.bounceReason,
    };
}

function mapPatchToRow(patch: Partial<ContactedLead>) {
    const updateData: any = {};

    if (patch.status) updateData.status = patch.status;
    if (patch.repliedAt) updateData.replied_at = patch.repliedAt;
    if (patch.replyPreview) updateData.reply_preview = patch.replyPreview;
    if (patch.lastReplyText) updateData.last_reply_text = patch.lastReplyText;
    if (patch.replyMessageId) updateData.reply_message_id = patch.replyMessageId;
    if (patch.replySubject) updateData.reply_subject = patch.replySubject;
    if (patch.replySnippet) updateData.reply_snippet = patch.replySnippet;
    if (patch.openedAt) updateData.opened_at = patch.openedAt;
    if (patch.deliveredAt) updateData.delivered_at = patch.deliveredAt;
    if (patch.readReceiptMessageId) updateData.read_receipt_message_id = patch.readReceiptMessageId;
    if (patch.deliveryReceiptMessageId) updateData.delivery_receipt_message_id = patch.deliveryReceiptMessageId;
    if (patch.deliveryStatus) updateData.delivery_status = patch.deliveryStatus;
    if (patch.bouncedAt) updateData.bounced_at = patch.bouncedAt;
    if (patch.bounceCategory) updateData.bounce_category = patch.bounceCategory;
    if (patch.bounceReason) updateData.bounce_reason = patch.bounceReason;
    if (patch.threadKey) updateData.thread_key = patch.threadKey;
    if (patch.lifecycleState) updateData.lifecycle_state = patch.lifecycleState;
    if (patch.lastEventType) updateData.last_event_type = patch.lastEventType;
    if (patch.lastEventAt) updateData.last_event_at = patch.lastEventAt;
    if (patch.preflightStatus) updateData.preflight_status = patch.preflightStatus;
    if (patch.preflightReason) updateData.preflight_reason = patch.preflightReason;
    if (patch.followUpCount !== undefined) updateData.follow_up_count = patch.followUpCount;
    if (patch.lastFollowUpAt) updateData.last_follow_up_at = patch.lastFollowUpAt;
    if (patch.lastStepIdx !== undefined) updateData.last_step_idx = patch.lastStepIdx;
    if (patch.replyIntent) updateData.reply_intent = patch.replyIntent;
    if (patch.replySentiment) updateData.reply_sentiment = patch.replySentiment;
    if (patch.replyConfidence !== undefined) updateData.reply_confidence = patch.replyConfidence;
    if (patch.replySummary) updateData.reply_summary = patch.replySummary;
    if (patch.campaignFollowupAllowed !== undefined) updateData.campaign_followup_allowed = patch.campaignFollowupAllowed;
    if (patch.campaignFollowupReason) updateData.campaign_followup_reason = patch.campaignFollowupReason;
    if (patch.evaluationStatus) updateData.evaluation_status = patch.evaluationStatus;
    if (patch.engagementScore !== undefined) updateData.engagement_score = patch.engagementScore;
    if (patch.lastInteractionAt) updateData.last_interaction_at = patch.lastInteractionAt;
    if (patch.clickedAt) updateData.clicked_at = patch.clickedAt;
    if (patch.clickCount !== undefined) updateData.click_count = patch.clickCount;
    if (patch.scheduledAt) updateData.scheduled_at = patch.scheduledAt;
    if (patch.linkedinMessageStatus) updateData.linkedin_message_status = patch.linkedinMessageStatus;
    if (patch.linkedinThreadUrl) updateData.linkedin_thread_url = patch.linkedinThreadUrl;

    updateData.last_update_at = new Date().toISOString();
    return updateData;
}

function stripReplyTraceColumns(updateData: any) {
    if (!updateData || typeof updateData !== 'object') return updateData;
    const copy = { ...updateData };
    delete copy.reply_message_id;
    delete copy.reply_subject;
    delete copy.reply_snippet;
    return copy;
}

function stripObservabilityColumns(updateData: any) {
    if (!updateData || typeof updateData !== 'object') return updateData;
    const copy = { ...updateData };
    delete copy.thread_key;
    delete copy.lifecycle_state;
    delete copy.last_event_type;
    delete copy.last_event_at;
    delete copy.preflight_status;
    delete copy.preflight_reason;
    return copy;
}

function isReplyTraceColumnError(error: any) {
    const text = String(error?.message || error?.details || '').toLowerCase();
    return text.includes('reply_message_id') || text.includes('reply_subject') || text.includes('reply_snippet');
}

function isObservabilityColumnError(error: any) {
    const text = String(error?.message || error?.details || '').toLowerCase();
    return text.includes('thread_key') || text.includes('lifecycle_state') || text.includes('last_event_type') || text.includes('last_event_at') || text.includes('preflight_status') || text.includes('preflight_reason');
}

async function updateWithReplyTraceFallback(run: (data: any) => any, updateData: any) {
    let { error } = await run(updateData);
    if (error && isReplyTraceColumnError(error)) {
        const { error: retryError } = await run(stripReplyTraceColumns(updateData));
        error = retryError;
    }
    if (error && isObservabilityColumnError(error)) {
        const { error: retryError } = await run(stripObservabilityColumns(updateData));
        error = retryError;
    }
    return { error };
}

export async function getContactedLeads(): Promise<ContactedLead[]> {
    const orgId = await organizationService.getCurrentOrganizationId();

    let query = supabase
        .from(TABLE)
        .select('*')
        .order('sent_at', { ascending: false });

    if (orgId) {
        // Allow seeing contacted leads for the current org OR personal (null org_id)
        query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching contacted leads:', error);
        return [];
    }
    return (data || []).map(mapRowToContactedLead);
}

export const contactedLeadsStorage = {
    get: getContactedLeads,

    findByLeadId: async (leadId: string) => {
        const { data } = await supabase
            .from(TABLE)
            .select('*')
            .eq('lead_id', leadId)
            .maybeSingle();
        return data ? mapRowToContactedLead(data) : null;
    },

    findAllByLeadId: async (leadId: string) => {
        const { data } = await supabase
            .from(TABLE)
            .select('*')
            .eq('lead_id', leadId)
            .order('sent_at', { ascending: false });
        return (data || []).map(mapRowToContactedLead);
    },

    findAllByEmail: async (email: string) => {
        const { data } = await supabase
            .from(TABLE)
            .select('*')
            .ilike('email', email)
            .order('sent_at', { ascending: false });
        return (data || []).map(mapRowToContactedLead);
    },

    add: async (item: ContactedLead) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const orgId = await organizationService.getCurrentOrganizationId();

        // Check for duplicates based on messageId or email+subject+sentAt
        // This is harder to do efficiently in one query without a unique constraint, 
        // but we can check if messageId exists if present.
        if (item.messageId) {
            const { count } = await supabase.from(TABLE).select('*', { count: 'exact', head: true }).eq('message_id', item.messageId);
            if (count && count > 0) return;
        }

        const row = mapContactedLeadToRow({ ...item, followUpCount: 0, lastStepIdx: -1 }, user.id, orgId);
        let { error } = await supabase.from(TABLE).insert(row);
        if (error && isObservabilityColumnError(error)) {
            ({ error } = await supabase.from(TABLE).insert(stripObservabilityColumns(row)));
        }
        if (error) console.error('Error adding contacted lead:', error);

        if (!error) {
            await supabase.from('email_events').insert({
                organization_id: orgId,
                contacted_id: row.id,
                lead_id: row.lead_id || null,
                provider: row.provider || null,
                event_type: 'sent',
                event_source: 'client_storage',
                event_at: row.sent_at || new Date().toISOString(),
                thread_key: row.thread_key || null,
                message_id: row.message_id || null,
                internet_message_id: row.internet_message_id || null,
                meta: {
                    email: row.email,
                    subject: row.subject,
                },
            }).then(({ error: eventError }) => {
                if (eventError) console.warn('email_events insert skipped:', eventError.message || eventError);
            });
        }
    },

    upsertByThreadId: async (threadId: string, patch: Partial<ContactedLead>) => {
        const updateData = mapPatchToRow(patch);

        const { error } = await updateWithReplyTraceFallback(
            (data) => supabase.from(TABLE).update(data).eq('thread_id', threadId),
            updateData
        );

        if (error) console.error('Error updating by threadId:', error);
    },

    upsertByMessageId: async (messageId: string, patch: Partial<ContactedLead>) => {
        const updateData = mapPatchToRow(patch);

        const { error } = await updateWithReplyTraceFallback(
            (data) => supabase.from(TABLE).update(data).eq('message_id', messageId),
            updateData
        );

        if (error) console.error('Error updating by messageId:', error);
    },

    updateStatusByConversationId: async (conversationId: string, patch: Partial<ContactedLead>) => {
        const updateData = mapPatchToRow(patch);

        const { error } = await updateWithReplyTraceFallback(
            (data) => supabase.from(TABLE).update(data).eq('conversation_id', conversationId),
            updateData
        );

        if (error) console.error('Error updating by conversationId:', error);
    },

    updateStatusByThreadId: async (threadId: string, patch: Partial<ContactedLead>) => {
        const updateData = mapPatchToRow(patch);

        const { error } = await updateWithReplyTraceFallback(
            (data) => supabase.from(TABLE).update(data).eq('thread_id', threadId),
            updateData
        );

        if (error) console.error('Error updating by threadId:', error);
    },

    markRepliedByConversationId: async (conversationId: string, replySnippet?: string) => {
        await contactedLeadsStorage.updateStatusByConversationId(conversationId, {
            status: 'replied',
            replyPreview: replySnippet,
            repliedAt: new Date().toISOString(),
        });
    },

    markRepliedByThreadId: async (threadId: string, replySnippet?: string) => {
        await contactedLeadsStorage.updateStatusByThreadId(threadId, {
            status: 'replied',
            replyPreview: replySnippet,
            repliedAt: new Date().toISOString(),
        });
    },

    markReceiptsByConversationId: async (conversationId: string, patch: {
        openedAt?: string;
        deliveredAt?: string;
        readReceiptMessageId?: string;
        deliveryReceiptMessageId?: string;
    }) => {
        await contactedLeadsStorage.updateStatusByConversationId(conversationId, {
            ...patch,
            deliveryStatus: patch.openedAt ? 'opened' : patch.deliveredAt ? 'delivered' : undefined,
        });
    },

    markReceiptsByThreadId: async (threadId: string, patch: {
        openedAt?: string;
        deliveredAt?: string;
        readReceiptMessageId?: string;
        deliveryReceiptMessageId?: string;
    }) => {
        await contactedLeadsStorage.updateStatusByThreadId(threadId, {
            ...patch,
            deliveryStatus: patch.openedAt ? 'opened' : patch.deliveredAt ? 'delivered' : undefined,
        });
    },

    bumpFollowupByConversationId: async (conversationId: string, stepIdx: number) => {
        // Need to fetch current count first to increment it
        const { data } = await supabase.from(TABLE).select('follow_up_count').eq('conversation_id', conversationId).maybeSingle();
        if (!data) return;

        const currentCount = data.follow_up_count || 0;
        const { error } = await supabase.from(TABLE).update({
            follow_up_count: currentCount + 1,
            last_follow_up_at: new Date().toISOString(),
            last_step_idx: stepIdx,
            last_update_at: new Date().toISOString(),
        }).eq('conversation_id', conversationId);

        if (error) console.error('Error bumping followup:', error);
    },

    bumpFollowupByThreadId: async (threadId: string, stepIdx: number) => {
        const { data } = await supabase.from(TABLE).select('follow_up_count').eq('thread_id', threadId).maybeSingle();
        if (!data) return;

        const currentCount = data.follow_up_count || 0;
        const { error } = await supabase.from(TABLE).update({
            follow_up_count: currentCount + 1,
            last_follow_up_at: new Date().toISOString(),
            last_step_idx: stepIdx,
            last_update_at: new Date().toISOString(),
        }).eq('thread_id', threadId);

        if (error) console.error('Error bumping followup:', error);
    },

    isContacted: async (email?: string, leadId?: string): Promise<boolean> => {
        if (!email && !leadId) return false;

        const orgId = await organizationService.getCurrentOrganizationId();

        let query = supabase.from(TABLE).select('id', { count: 'exact', head: true });

        if (orgId) {
            // Check in org OR personal
            query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
        }

        if (email && leadId) {
            query = query.or(`email.ilike.${email},lead_id.eq.${leadId}`);
        } else if (email) {
            query = query.ilike('email', email);
        } else if (leadId) {
            query = query.eq('lead_id', leadId);
        }

        const { count } = await query;
        return (count || 0) > 0;
    },

    removeWhere: async (pred: (x: ContactedLead) => boolean): Promise<number> => {
        const all = await getContactedLeads();
        const toRemove = all.filter(pred);
        if (toRemove.length === 0) return 0;

        const ids = toRemove.map(x => x.id);
        const { error } = await supabase.from(TABLE).delete().in('id', ids);

        if (error) {
            console.error('Error removing contacted leads:', error);
            return 0;
        }
        return toRemove.length;
    },

    markOpenedById: async (id: string) => {
        // Only update if not already opened (optional optimization, but good for first-open accuracy)
        // Or just update always to "last opened". Let's update typically.
        const { error } = await supabase
            .from(TABLE)
            .update({
                status: 'opened',
                opened_at: new Date().toISOString(),
                last_update_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (error) console.error('Error marking lead as opened:', error);
    },

    markClickedById: async (id: string) => {
        // Fetch current count to increment safely (or use a DB function/rpc if concurrency is high, but simple read-modify-write is okay here)
        const { data } = await supabase.from(TABLE).select('click_count, clicked_at').eq('id', id).single();
        const currentCount = (data?.click_count || 0) + 1;

        // If it's the first click, set clicked_at. If already clicked, keep original or update? 
        // Usually we want "first clicked" or "last clicked". Let's update "clicked_at" to NOW (last click).
        const updates: any = {
            click_count: currentCount,
            clicked_at: new Date().toISOString(),
            last_update_at: new Date().toISOString(),
        };

        const { error } = await supabase
            .from(TABLE)
            .update(updates)
            .eq('id', id);

        if (error) console.error('Error marking lead as clicked:', error);
    },
};
