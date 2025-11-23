import { supabase } from '@/lib/supabase';

export interface Profile {
    id: string;
    email: string;
    full_name?: string;
    avatar_url?: string;
    signatures?: Record<string, any>; // JSON storage for signatures by channel
    company_name?: string;
    company_domain?: string;
    // Add other settings here as needed
}

export const profileService = {
    async getProfile(): Promise<Profile | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (error) {
            console.error('Error fetching profile:', error);
            return null;
        }

        return data as Profile;
    },

    async updateProfile(updates: Partial<Profile>): Promise<Profile | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', user.id)
            .select()
            .single();

        if (error) {
            console.error('Error updating profile:', error);
            return null;
        }

        return data as Profile;
    },

    // Helper specifically for signature
    async getSignatures(): Promise<Record<string, any>> {
        const profile = await this.getProfile();
        return profile?.signatures || {};
    },

    async setSignatures(signatures: Record<string, any>): Promise<void> {
        await this.updateProfile({ signatures });
    }
};
