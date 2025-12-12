import { supabase } from '../supabase';
import type { ContactedLead } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { organizationService } from './organization-service';

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
        lastUpdateAt: row.last_update_at,
        replyPreview: row.reply_preview,
        followUpCount: row.follow_up_count,
        lastFollowUpAt: row.last_follow_up_at,
        lastStepIdx: row.last_step_idx,
    };
}

function mapContactedLeadToRow(item: ContactedLead, userId: string, organizationId: string | null) {
    const id = item.id || uuidv4();
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
        last_reply_text: item.lastReplyText,
    };
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
        const { error } = await supabase.from(TABLE).insert(row);
        if (error) console.error('Error adding contacted lead:', error);
    },

    upsertByThreadId: async (threadId: string, patch: Partial<ContactedLead>) => {
        // We need to find the record first to get its ID, or update by thread_id
        // Supabase update can filter by thread_id
        const updateData: any = {};
        if (patch.status) updateData.status = patch.status;
        if (patch.repliedAt) updateData.replied_at = patch.repliedAt;
        if (patch.replyPreview) updateData.reply_preview = patch.replyPreview;
        if (patch.openedAt) updateData.opened_at = patch.openedAt;
        if (patch.deliveredAt) updateData.delivered_at = patch.deliveredAt;
        if (patch.readReceiptMessageId) updateData.read_receipt_message_id = patch.readReceiptMessageId;
        if (patch.deliveryReceiptMessageId) updateData.delivery_receipt_message_id = patch.deliveryReceiptMessageId;
        if (patch.followUpCount !== undefined) updateData.follow_up_count = patch.followUpCount;
        if (patch.lastFollowUpAt) updateData.last_follow_up_at = patch.lastFollowUpAt;
        if (patch.lastStepIdx !== undefined) updateData.last_step_idx = patch.lastStepIdx;

        updateData.last_update_at = new Date().toISOString();

        const { error } = await supabase
            .from(TABLE)
            .update(updateData)
            .eq('thread_id', threadId);

        if (error) console.error('Error updating by threadId:', error);
    },

    upsertByMessageId: async (messageId: string, patch: Partial<ContactedLead>) => {
        const updateData: any = {};
        // Map fields similar to above... 
        // Ideally we should have a helper to map patch to row partial
        if (patch.status) updateData.status = patch.status;
        if (patch.repliedAt) updateData.replied_at = patch.repliedAt;
        if (patch.replyPreview) updateData.reply_preview = patch.replyPreview;
        if (patch.openedAt) updateData.opened_at = patch.openedAt;
        if (patch.deliveredAt) updateData.delivered_at = patch.deliveredAt;
        if (patch.readReceiptMessageId) updateData.read_receipt_message_id = patch.readReceiptMessageId;
        if (patch.deliveryReceiptMessageId) updateData.delivery_receipt_message_id = patch.deliveryReceiptMessageId;

        updateData.last_update_at = new Date().toISOString();

        const { error } = await supabase
            .from(TABLE)
            .update(updateData)
            .eq('message_id', messageId);

        if (error) console.error('Error updating by messageId:', error);
    },

    updateStatusByConversationId: async (conversationId: string, patch: Partial<ContactedLead>) => {
        const updateData: any = {};
        if (patch.status) updateData.status = patch.status;
        if (patch.repliedAt) updateData.replied_at = patch.repliedAt;
        if (patch.replyPreview) updateData.reply_preview = patch.replyPreview;
        if (patch.openedAt) updateData.opened_at = patch.openedAt;
        if (patch.deliveredAt) updateData.delivered_at = patch.deliveredAt;
        if (patch.readReceiptMessageId) updateData.read_receipt_message_id = patch.readReceiptMessageId;
        if (patch.deliveryReceiptMessageId) updateData.delivery_receipt_message_id = patch.deliveryReceiptMessageId;

        updateData.last_update_at = new Date().toISOString();

        const { error } = await supabase
            .from(TABLE)
            .update(updateData)
            .eq('conversation_id', conversationId);

        if (error) console.error('Error updating by conversationId:', error);
    },

    updateStatusByThreadId: async (threadId: string, patch: Partial<ContactedLead>) => {
        // Reuse upsertByThreadId logic or call it
        // But upsertByThreadId maps fields manually.
        // Let's just call the same logic.
        const updateData: any = {};
        if (patch.status) updateData.status = patch.status;
        if (patch.repliedAt) updateData.replied_at = patch.repliedAt;
        if (patch.replyPreview) updateData.reply_preview = patch.replyPreview;
        if (patch.openedAt) updateData.opened_at = patch.openedAt;
        if (patch.deliveredAt) updateData.delivered_at = patch.deliveredAt;
        if (patch.readReceiptMessageId) updateData.read_receipt_message_id = patch.readReceiptMessageId;
        if (patch.deliveryReceiptMessageId) updateData.delivery_receipt_message_id = patch.deliveryReceiptMessageId;

        updateData.last_update_at = new Date().toISOString();

        const { error } = await supabase
            .from(TABLE)
            .update(updateData)
            .eq('thread_id', threadId);

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
        await contactedLeadsStorage.updateStatusByConversationId(conversationId, { ...patch });
    },

    markReceiptsByThreadId: async (threadId: string, patch: {
        openedAt?: string;
        deliveredAt?: string;
        readReceiptMessageId?: string;
        deliveryReceiptMessageId?: string;
    }) => {
        await contactedLeadsStorage.updateStatusByThreadId(threadId, { ...patch });
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
