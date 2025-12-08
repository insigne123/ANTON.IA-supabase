import { supabase } from '@/lib/supabase';

export type Profile = {
    id: string;
    email: string | null;
    full_name: string | null;
    avatar_url: string | null;
    company_name?: string | null;
    company_domain?: string | null;
    job_title?: string | null;
    signatures?: any; // JSONB
    created_at: string;
    updated_at: string;
};

export const profileService = {
    async getProfile(userId?: string): Promise<Profile | null> {
        const { data: { user } } = await supabase.auth.getUser();
        const targetId = userId || user?.id;

        if (!targetId) return null;

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single();

        if (error) {
            // console.error('Error fetching profile:', error);
            return null;
        }

        return data;
    },

    async getCurrentProfile(): Promise<Profile | null> {
        return this.getProfile();
    },

    async updateProfile(updates: Partial<Profile>): Promise<Profile | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        return this.updateProfileById(user.id, updates);
    },

    async updateProfileById(userId: string, updates: Partial<Profile>): Promise<Profile | null> {
        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error updating profile:', error);
            return null;
        }

        return data;
    },

    async getSignatures(): Promise<any> {
        const profile = await this.getCurrentProfile();
        return profile?.signatures || {};
    },

    async setSignatures(signatures: any): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await this.updateProfileById(user.id, { signatures });
    }
};
