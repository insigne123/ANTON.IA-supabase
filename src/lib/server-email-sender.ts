
import { encodeHeaderRFC2047, sanitizeHeaderText } from '@/lib/email-header-utils';

export async function sendGmail(accessToken: string, to: string, subject: string, htmlBody: string) {
    // Construct raw email
    const utf8Subject = encodeHeaderRFC2047(subject);
    const messageParts = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        htmlBody,
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
        const err = await res.text();
        throw new Error(`Failed to send Gmail: ${err}`);
    }
    return res.json();
}

export async function sendOutlook(accessToken: string, to: string, subject: string, htmlBody: string) {
    const safeSubject = sanitizeHeaderText(subject);
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
                    content: htmlBody,
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: to,
                        },
                    },
                ],
            },
            saveToSentItems: 'true',
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to send Outlook email: ${err}`);
    }
    return true;
}
