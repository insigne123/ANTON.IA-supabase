import { supabase } from '../supabase';
import { IntegrationToken } from '../types';

// Simple encryption helper (placeholder for real encryption)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-secret-key';

function encrypt(text: string): string {
    // In a real app, use crypto library (e.g. crypto-js or node crypto)
    // Here we just return base64 for 'obfuscation' to show intent
    return Buffer.from(text).toString('base64');
}

function decrypt(text: string): string {
    return Buffer.from(text, 'base64').toString('utf-8');
}

export const tokenManager = {
    /**
     * Store a refresh token securely
     */
    storeRefreshToken: async (userId: string, provider: 'google' | 'outlook', token: string) => {
        const encrypted = encrypt(token);

        const { error } = await supabase
            .from('integration_tokens')
            .upsert({
                user_id: userId,
                provider,
                refresh_token: encrypted,
                updated_at: new Date().toISOString()
            });

        if (error) throw error;
    },

    /**
     * Get a fresh access token for a user
     * This is intended to be called by the Worker (Server Side)
     */
    getFreshAccessToken: async (userId: string, provider: 'google' | 'outlook'): Promise<string | null> => {
        // 1. Get encrypted token from DB
        const { data, error } = await supabase
            .from('integration_tokens')
            .select('refresh_token')
            .eq('user_id', userId)
            .eq('provider', provider)
            .single();

        if (error || !data) {
            console.error('[TokenManager] No token found for user', userId, error);
            return null;
        }

        const refreshToken = decrypt(data.refresh_token);

        // 2. Refresh it with Provider
        if (provider === 'google') {
            return refreshGoogleToken(refreshToken);
        } else {
            // Outlook not implemented yet
            return null;
        }
    }
};

async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
    try {
        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET; // Must be in .env.local

        if (!clientId || !clientSecret) {
            console.error('[TokenManager] Missing Google Client ID/Secret');
            return null;
        }

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            })
        });

        const json = await response.json();

        if (!response.ok) {
            console.error('[TokenManager] Google Refresh Error', json);
            return null;
        }

        return json.access_token;
    } catch (e) {
        console.error('[TokenManager] Network error refreshing token', e);
        return null;
    }
}
