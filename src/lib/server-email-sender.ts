
import { encodeHeaderRFC2047, sanitizeHeaderText } from '@/lib/email-header-utils';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { ConfirmedProviderRejectionError } from '@/lib/server/outbound-dispatch';

type ServerEmailSendOptions = {
    unsubscribeUrl?: string | null;
    textBody?: string;
    idempotencyKey?: string;
    requestReceipts?: boolean;
};

function escapeODataLiteral(s: string) {
    return s.replace(/'/g, "''");
}

function toGraphIso(dt: Date) {
    return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
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
        const subjectMatches = String(message.subject || '').trim() === wantedSubject;
        const recipientMatches = (message.toRecipients || []).some((recipient: any) => String(recipient?.emailAddress?.address || '').trim().toLowerCase() === wantedTo);
        const dispatchMatches = !idempotencyKey || (message.internetMessageHeaders || []).some((header: any) => (
            String(header?.name || '').trim().toLowerCase() === 'x-anton-dispatch'
            && String(header?.value || '').trim() === idempotencyKey
        ));
        return subjectMatches && recipientMatches && dispatchMatches;
    });
    return matches.length === 1 ? matches[0] : null;
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
        throw new Error(preflight.errors.join(' '));
    }
    // Construct raw email
    const utf8Subject = encodeHeaderRFC2047(subject);
    const messageParts = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        ...(options.idempotencyKey ? [`X-ANTON-Dispatch: ${sanitizeHeaderText(options.idempotencyKey)}`] : []),
        '',
        prepared.html,
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
        }),
    });

    if (!res.ok) {
        await confirmedProviderRejection('Gmail', res);
    }
    return res.json();
}

export async function sendOutlook(accessToken: string, to: string, subject: string, htmlBody: string, options: ServerEmailSendOptions = {}) {
    const prepared = prepareOutboundEmail({ html: htmlBody, text: options.textBody, unsubscribeUrl: options.unsubscribeUrl });
    const preflight = validateOutboundEmail({ to, subject, html: prepared.html, text: prepared.text, requireUnsubscribe: true, unsubscribeUrl: options.unsubscribeUrl });
    if (!preflight.ok) {
        throw new Error(preflight.errors.join(' '));
    }
    const safeSubject = sanitizeHeaderText(subject);
    const sentAfter = new Date();
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: {
                subject: safeSubject,
                body: {
                    contentType: 'HTML',
                    content: prepared.html,
                },
                isDeliveryReceiptRequested: Boolean(options.requestReceipts),
                isReadReceiptRequested: Boolean(options.requestReceipts),
                toRecipients: [
                    {
                        emailAddress: {
                            address: to,
                        },
                    },
                ],
                ...(options.idempotencyKey ? {
                    internetMessageHeaders: [{
                        name: 'X-ANTON-Dispatch',
                        value: sanitizeHeaderText(options.idempotencyKey),
                    }],
                } : {}),
            },
            saveToSentItems: true,
        }),
    });

    if (!res.ok) {
        await confirmedProviderRejection('Outlook', res);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
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
    };
}
