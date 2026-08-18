type ContactHistoryLike = {
    lead_id?: string | null;
    email?: string | null;
    status?: string | null;
    replied_at?: string | null;
    repliedAt?: string | null;
    reply_intent?: string | null;
    replyIntent?: string | null;
    last_reply_text?: string | null;
    lastReplyText?: string | null;
    delivery_status?: string | null;
    deliveryStatus?: string | null;
    bounce_category?: string | null;
    bounceCategory?: string | null;
    evaluation_status?: string | null;
    evaluationStatus?: string | null;
    campaign_followup_reason?: string | null;
    campaignFollowupReason?: string | null;
};

const REPLY_INTENTS = new Set([
    'meeting_request',
    'positive',
    'negative',
    'unsubscribe',
    'auto_reply',
    'neutral',
    'delivery_failure',
]);

const OPT_OUT_REASONS = new Set(['unsubscribe', 'unsubscribed', 'opt_out', 'opt-out']);
const TEMPORARY_DELIVERY_REASONS = new Set(['mailbox_full', 'policy_block', 'temporary_failure']);
const PERMANENT_DELIVERY_REASONS = new Set(['left_company', 'mailbox_not_found', 'domain_error']);

function normalize(value: unknown) {
    return String(value || '').trim().toLowerCase();
}

function hasExplicitOptOutText(row: ContactHistoryLike) {
    const text = String(row.last_reply_text || row.lastReplyText || '').trim();
    return /\b(?:do\s+not\s+contact|stop\s+(?:emailing|contacting)|remove\s+me|no\s+(?:contactarme|me\s+(?:contacten|escriban)|nos\s+contacten)|dar(?:me|te|se)\s+de\s+baja)\b/i.test(text);
}

export function hasPriorReplyHistory(row: ContactHistoryLike) {
    const intent = normalize(row.reply_intent || row.replyIntent);
    const deliveryStatus = normalize(row.delivery_status || row.deliveryStatus);
    return Boolean(
        row.replied_at ||
        row.repliedAt ||
        row.status === 'replied' ||
        row.last_reply_text ||
        row.lastReplyText ||
        REPLY_INTENTS.has(intent) ||
        deliveryStatus === 'bounced' ||
        deliveryStatus === 'soft_bounced'
    );
}

export function shouldPermanentlySuppressContact(row: ContactHistoryLike) {
    const intent = normalize(row.reply_intent || row.replyIntent);
    const followupReason = normalize(row.campaign_followup_reason || row.campaignFollowupReason);

    if (intent === 'unsubscribe' || OPT_OUT_REASONS.has(followupReason) || hasExplicitOptOutText(row)) return true;

    const evaluationStatus = normalize(row.evaluation_status || row.evaluationStatus);
    const deliveryStatus = normalize(row.delivery_status || row.deliveryStatus);
    const bounceCategory = normalize(row.bounce_category || row.bounceCategory);
    const deliveryReason = bounceCategory || followupReason;
    const isDeliveryFailure = intent === 'delivery_failure' ||
        deliveryStatus === 'bounced' ||
        deliveryStatus === 'soft_bounced' ||
        Boolean(bounceCategory);

    if (!isDeliveryFailure) return false;

    if (
        evaluationStatus === 'action_required' ||
        deliveryStatus === 'soft_bounced' ||
        TEMPORARY_DELIVERY_REASONS.has(deliveryReason)
    ) {
        return false;
    }

    return evaluationStatus === 'do_not_contact' ||
        deliveryStatus === 'bounced' ||
        PERMANENT_DELIVERY_REASONS.has(deliveryReason);
}

export function findPriorReplyMatchForLead(lead: any, rows: ContactHistoryLike[]) {
    const leadId = normalize(lead?.id);
    const email = normalize(lead?.email);
    for (const row of rows || []) {
        if (!hasPriorReplyHistory(row)) continue;
        const rowLeadId = normalize(row.lead_id);
        const rowEmail = normalize(row.email);
        if (leadId && rowLeadId && leadId === rowLeadId) return row;
        if (email && rowEmail && email === rowEmail) return row;
    }
    return null;
}
