import { supabase } from '@/lib/supabase';

export type Profile = {
    id: string;
    email: string | null;
    full_name: string | null;
    avatar_url: string | null;
    created_at: string;
    updated_at: string;
};

export const profileService = {
    async getProfile(userId: string): Promise<Profile | null> {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            // console.error('Error fetching profile:', error);
            return null;
        }

        return data;
    },

    async getCurrentProfile(): Promise<Profile | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        return this.getProfile(user.id);
    },

    async updateProfile(userId: string, updates: Partial<Profile>): Promise<Profile | null> {
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
    }
};
