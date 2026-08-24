export type ContactSendResponseBody = Record<string, unknown>;

export type ContactSendFailureClassification = {
    code: string | null;
    shouldMarkDoNotContact: boolean;
    complianceReason: 'unsubscribed' | 'domain_blocked' | null;
    retryable: boolean;
    outcomeUnknown: boolean;
    dailyQuotaExceeded: boolean;
    outboundConflict: boolean;
};

const RETRYABLE_CONTACT_STATUSES = new Set([202, 408, 425, 429, 500, 502, 503, 504]);

export function parseContactSendResponseBody(raw: string): ContactSendResponseBody {
    try {
        const parsed = JSON.parse(String(raw || ''));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as ContactSendResponseBody
            : {};
    } catch {
        return {};
    }
}

export function classifyContactSendFailure(
    status: number,
    body: ContactSendResponseBody
): ContactSendFailureClassification {
    const rawCode = typeof body.code === 'string' ? body.code : null;
    const code = rawCode?.trim() || null;
    const dispatchStatus = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
    const complianceReason = rawCode === 'RECIPIENT_UNSUBSCRIBED'
        ? 'unsubscribed'
        : rawCode === 'DOMAIN_BLOCKED'
            ? 'domain_blocked'
            : null;
    const outcomeUnknown = rawCode === 'OUTBOUND_UNKNOWN'
        || ['pending', 'sending', 'unknown'].includes(dispatchStatus);
    const dailyQuotaExceeded = rawCode === 'daily_quota_exceeded';

    return {
        code,
        shouldMarkDoNotContact: complianceReason !== null,
        complianceReason,
        retryable: outcomeUnknown || dailyQuotaExceeded || RETRYABLE_CONTACT_STATUSES.has(status),
        outcomeUnknown,
        dailyQuotaExceeded,
        outboundConflict: rawCode === 'OUTBOUND_CONFLICT',
    };
}

export function isReplayedContactSend(body: ContactSendResponseBody) {
    return body.replayed === true;
}

export function isSuccessfulContactSend(status: number, body: ContactSendResponseBody) {
    return status >= 200 && status < 300 && body.success === true;
}

export function shouldAppendContactedLead(status: number, body: ContactSendResponseBody) {
    return isSuccessfulContactSend(status, body) && !isReplayedContactSend(body);
}

export function isRetryableContactSendException(error: unknown) {
    const candidate = error as { retryable?: unknown; message?: unknown; code?: unknown } | null;
    if (candidate?.retryable === true) return true;
    const details = `${String(candidate?.message || '')} ${String(candidate?.code || '')}`.toLowerCase();
    return ['econnreset', 'etimedout', 'enotfound', 'econnrefused', 'timeout', 'network', 'fetch failed']
        .some((pattern) => details.includes(pattern));
}
