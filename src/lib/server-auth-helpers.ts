
export async function refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to refresh Google token: ${err}`);
    }
    return res.json();
}

export async function refreshMicrosoftToken(refreshToken: string, clientId: string, clientSecret: string, tenantId: string) {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'offline_access User.Read Mail.Send',
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to refresh Microsoft token: ${err}`);
    }
    return res.json();
}
