
import { encodeHeaderRFC2047, sanitizeHeaderText } from '@/lib/email-header-utils';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { addMessageTracking } from '@/lib/email-tracking';
import { ConfirmedProviderRejectionError } from '@/lib/server/outbound-dispatch';
import type { EmailReplyTarget } from '@/lib/server/reply-target';

type ServerEmailSendOptions = {
    unsubscribeUrl?: string | null;
    oneClickUnsubscribeUrl?: string | null;
    textBody?: string;
    idempotencyKey?: string;
    trackingDispatchId?: string;
    requestReceipts?: boolean;
    replyTarget?: EmailReplyTarget;
};

function escapeODataLiteral(s: string) {
    return s.replace(/'/g, "''");
}

function toGraphIso(dt: Date) {
    return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function oneClickUrl(options: ServerEmailSendOptions) {
    if (options.oneClickUnsubscribeUrl) return options.oneClickUnsubscribeUrl;
    if (!options.unsubscribeUrl) return null;
    try { const url = new URL(options.unsubscribeUrl); url.pathname = '/api/tracking/unsubscribe'; return url.toString(); }
    catch { return null; }
}

async function findRecentlySentOutlookMessage(token: string, params: { to: string; subject: string; idempotencyKey?: string; sentAfter: Date }) {
    const { to, subject, idempotencyKey, sentAfter } = params;
    const since = new Date(sentAfter.getTime() - 5_000);
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
    const matches = list.filter((message: any) => {
        const stripReplyPrefix = (value: string) => value.replace(/^(?:(?:re|rv|aw):\s*)+/i, '').trim().toLowerCase();
        const subjectMatches = String(message.subject || '').trim() === wantedSubject
            || stripReplyPrefix(String(message.subject || '')) === stripReplyPrefix(wantedSubject);
        const recipientMatches = (message.toRecipients || []).some((recipient: any) => String(recipient?.emailAddress?.address || '').trim().toLowerCase() === wantedTo);
        const dispatchMatches = !idempotencyKey || (message.internetMessageHeaders || []).some((header: any) => (
            String(header?.name || '').trim().toLowerCase() === 'x-anton-dispatch'
            && String(header?.value || '').trim() === idempotencyKey
        ));
        return subjectMatches && recipientMatches && dispatchMatches;
    });
    return matches.length === 1 ? matches[0] : null;
}

function rejectBeforeSend(error: unknown): never {
    throw new ConfirmedProviderRejectionError(error instanceof Error ? error.message : String(error), {
        code: 'pre_send_validation_failed', response: { providerInvoked: false, phase: 'pre_send' },
    });
}

async function confirmedProviderRejection(provider: string, response: Response) {
    const body = await response.text();
    if (response.status >= 400 && response.status < 500 && ![408, 409, 425, 429].includes(response.status)) {
        throw new ConfirmedProviderRejectionError(`${provider} rejected the message (${response.status}): ${body}`, {
            code: `${provider.toLowerCase()}_${response.status}`,
            response: { status: response.status, body },
        });
    }
    throw new Error(`Failed to send ${provider}: ${body}`);
}

export async function sendGmail(accessToken: string, to: string, subject: string, htmlBody: string, options: ServerEmailSendOptions = {}) {
    const prepared = prepareOutboundEmail({ html: htmlBody, text: options.textBody, unsubscribeUrl: options.unsubscribeUrl });
    const preflight = validateOutboundEmail({ to, subject, html: prepared.html, text: prepared.text, requireUnsubscribe: true, unsubscribeUrl: options.unsubscribeUrl });
    if (!preflight.ok) {
        rejectBeforeSend(preflight.errors.join(' '));
    }
    const tracking = addMessageTracking({ html: prepared.html, baseUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai', trackingKey: options.trackingDispatchId });
    let replyHeaders: string[] = [];
    const listUnsubscribeUrl = oneClickUrl(options);
    if (listUnsubscribeUrl) replyHeaders.push(`List-Unsubscribe: <${sanitizeHeaderText(listUnsubscribeUrl)}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    if (options.replyTarget) {
        try {
            const target = options.replyTarget;
            if (target.provider !== 'gmail') throw new Error('Reply provider mismatch');
            const parentResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(target.messageId)}?format=metadata`, {
                headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
            });
            if (!parentResponse.ok) throw new Error(`Gmail reply parent lookup failed (${parentResponse.status})`);
            const parent = await parentResponse.json();
            const header = (name: string) => {
                const matches = (parent.payload?.headers || []).filter((item: any) => String(item.name).toLowerCase() === name.toLowerCase());
                return matches.length === 1 ? String(matches[0].value || '').trim() : '';
            };
            const messageId = header('Message-ID');
            const recipients = header('To').split(',').map((value: string) => (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase());
            const baseSubject = (value: string) => value.replace(/^(?:re:\s*)+/i, '').trim();
            if (parent.id !== target.messageId || parent.threadId !== target.threadId
                || !parent.labelIds?.includes('SENT') || recipients.length !== 1 || recipients[0] !== to.trim().toLowerCase()
                || !/^<[^<>\s]+@[^<>\s]+>$/.test(messageId)
                || !header('Subject') || baseSubject(header('Subject')) !== baseSubject(subject)) {
                throw new Error('Gmail reply parent could not be verified; no message was sent');
            }
            const references = header('References');
            if (references && !/^(?:<[^<>\s]+@[^<>\s]+>\s*)+$/.test(references)) throw new Error('Invalid Gmail parent References');
            replyHeaders.push(`In-Reply-To: ${messageId}`, `References: ${references ? `${references} ` : ''}${messageId}`);
        } catch (error) {
            rejectBeforeSend(error);
        }
    }
    // The approved subject is never rewritten to force threading.
    const utf8Subject = encodeHeaderRFC2047(subject);
    const messageParts = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        ...replyHeaders,
        ...(options.idempotencyKey ? [`X-ANTON-Dispatch: ${sanitizeHeaderText(options.idempotencyKey)}`] : []),
        '',
        tracking.html,
    ];
    const message = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(message, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            raw: encodedMessage,
            ...(options.replyTarget?.provider === 'gmail' ? { threadId: options.replyTarget.threadId } : {}),
        }),
    });

    if (!res.ok) {
        await confirmedProviderRejection('Gmail', res);
    }
    const receipt = await res.json();
    return { ...receipt, outboundSnapshot: { subject, to, html: tracking.html, text: prepared.text, capturedAt: new Date().toISOString(), source: 'submitted_to_provider', tracking: { pixelEnabled: tracking.pixelEnabled, trackedLinks: tracking.trackedLinks } } };
}

export async function sendOutlook(accessToken: string, to: string, subject: string, htmlBody: string, options: ServerEmailSendOptions = {}) {
    if (options.replyTarget && options.replyTarget.provider !== 'outlook') rejectBeforeSend('OUTLOOK_REPLY_PROVIDER_MISMATCH');
    const prepared = prepareOutboundEmail({ html: htmlBody, text: options.textBody, unsubscribeUrl: options.unsubscribeUrl });
    const preflight = validateOutboundEmail({ to, subject, html: prepared.html, text: prepared.text, requireUnsubscribe: true, unsubscribeUrl: options.unsubscribeUrl });
    if (!preflight.ok) {
        rejectBeforeSend(preflight.errors.join(' '));
    }
    const tracking = addMessageTracking({ html: prepared.html, baseUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai', trackingKey: options.trackingDispatchId });
    const safeSubject = sanitizeHeaderText(subject);
    const sentAfter = new Date();
    const dispatchHeader = options.idempotencyKey ? [{ name: 'X-ANTON-Dispatch', value: sanitizeHeaderText(options.idempotencyKey) }] : [];
    let sendUrl = 'https://graph.microsoft.com/v1.0/me/sendMail';
    let sendBody: Record<string, unknown>;
    if (options.replyTarget?.provider === 'outlook') {
        const target = options.replyTarget;
        const [parentResponse, profileResponse] = await Promise.all([
            fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(target.messageId)}?$select=id,conversationId,subject,from,toRecipients,isDraft`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }),
            fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }),
        ]);
        if (!parentResponse.ok || !profileResponse.ok) rejectBeforeSend('Outlook reply parent could not be verified; no message was sent');
        const [parent, profile] = await Promise.all([parentResponse.json(), profileResponse.json()]);
        const own = [profile.mail, profile.userPrincipalName].filter(Boolean).map((value: string) => value.toLowerCase());
        const parentRecipient = (parent.toRecipients || []).some((recipient: any) => String(recipient.emailAddress?.address || '').toLowerCase() === to.trim().toLowerCase());
        const stripRe = (value: string) => value.replace(/^(?:(?:re|rv|aw):\s*)+/i, '').trim().toLowerCase();
        if (parent.id !== target.messageId || parent.conversationId !== target.conversationId || parent.isDraft
            || !own.includes(String(parent.from?.emailAddress?.address || '').toLowerCase()) || !parentRecipient
            || !parent.subject || stripRe(parent.subject) !== stripRe(subject)) rejectBeforeSend('Outlook reply parent does not match this recipient and conversation');
        const create = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(target.messageId)}/createReply`, {
            method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment: '' }),
        });
        if (!create.ok) await confirmedProviderRejection('Outlook createReply', create);
        const replyDraft = await create.json();
        if (!replyDraft?.id || replyDraft.conversationId !== target.conversationId) rejectBeforeSend('Outlook reply draft could not be verified');
        const patched = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(replyDraft.id)}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: safeSubject, toRecipients: [{ emailAddress: { address: to } }], ccRecipients: [], bccRecipients: [], body: { contentType: 'HTML', content: tracking.html }, ...(dispatchHeader.length ? { internetMessageHeaders: dispatchHeader } : {}) }),
        });
        if (!patched.ok) await confirmedProviderRejection('Outlook reply draft update', patched);
        const verification = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(replyDraft.id)}?$select=id,isDraft,conversationId,subject,toRecipients,ccRecipients,bccRecipients,body,internetMessageHeaders`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
        if (!verification.ok) rejectBeforeSend('Outlook reply draft verification failed');
        const finalDraft = await verification.json();
        if (finalDraft.id !== replyDraft.id || finalDraft.isDraft !== true || finalDraft.conversationId !== target.conversationId
            || finalDraft.toRecipients?.length !== 1 || String(finalDraft.toRecipients[0]?.emailAddress?.address || '').trim().toLowerCase() !== to.trim().toLowerCase()
            || finalDraft.ccRecipients?.length || finalDraft.bccRecipients?.length
            || finalDraft.subject !== safeSubject || finalDraft.body?.content !== tracking.html
            || !options.idempotencyKey || !finalDraft.internetMessageHeaders?.some((header: any) => String(header.name).toLowerCase() === 'x-anton-dispatch' && header.value === options.idempotencyKey)) {
            rejectBeforeSend('Outlook reply recipient, content or correlation could not be verified');
        }
        sendUrl = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(replyDraft.id)}/send`;
        sendBody = {};
    } else {
        sendBody = { message: {
            subject: safeSubject,
            body: { contentType: 'HTML', content: tracking.html },
            isDeliveryReceiptRequested: Boolean(options.requestReceipts),
            isReadReceiptRequested: Boolean(options.requestReceipts),
            toRecipients: [{ emailAddress: { address: to } }],
            ...(dispatchHeader.length ? { internetMessageHeaders: dispatchHeader } : {}),
        }, saveToSentItems: true };
    }
    const res = await fetch(sendUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
    });

    if (!res.ok) {
        await confirmedProviderRejection('Outlook', res);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // A 202 has no ID. Missing/stripped correlation headers or delayed Sent Items
    // visibility must remain unknown; never infer success from the parent or subject alone.
    const sentMeta = await findRecentlySentOutlookMessage(accessToken, {
        to,
        subject: safeSubject,
        idempotencyKey: options.idempotencyKey,
        sentAfter,
    }).catch(() => null);
    return {
        id: sentMeta?.id || null,
        messageId: sentMeta?.id || null,
        conversationId: sentMeta?.conversationId || null,
        internetMessageId: sentMeta?.internetMessageId || null,
        outboundSnapshot: { subject: safeSubject, to, html: tracking.html, text: prepared.text, capturedAt: new Date().toISOString(), source: 'submitted_to_provider', tracking: { pixelEnabled: tracking.pixelEnabled, trackedLinks: tracking.trackedLinks } },
    };
}
