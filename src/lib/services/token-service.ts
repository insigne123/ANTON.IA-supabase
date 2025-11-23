import { supabase } from '@/lib/supabase';
import { SupabaseClient } from '@supabase/supabase-js';

export const tokenService = {
    async saveToken(supabase: SupabaseClient, provider: 'google' | 'outlook', refreshToken: string, expiresAt?: Date) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase
            .from('provider_tokens')
            .upsert({
                user_id: user.id,
                provider,
                refresh_token: refreshToken,
                expires_at: expiresAt?.toISOString(),
                updated_at: new Date().toISOString()
            });

        if (error) console.error('Error saving token:', error);
    },

    async getToken(supabase: SupabaseClient, userId: string, provider: 'google' | 'outlook') {
        const { data, error } = await supabase
            .from('provider_tokens')
            .select('refresh_token, expires_at')
            .eq('user_id', userId)
            .eq('provider', provider)
            .single();

        if (error) return null;
        return data;
    }
};
