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

/**
 * Reads of a profile that are still on their way, by user id ('' for the signed-in person). «Firmas y estilo» mounts its
 * three tabs at once and each asked for the profile: five reads, each behind a getUser() that the auth client runs one at
 * a time, took about 3 s in production (oct 2026). Who asks while a read is on its way gets that same read; nothing is
 * kept once it settles, so a save is always seen by the next read.
 */
const profileReads = new Map<string, Promise<Profile | null>>();

async function readProfile(userId?: string): Promise<Profile | null> {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const targetId = userId || user?.id;

    if (!targetId) return null;

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

export const profileService = {
    async getProfile(userId?: string): Promise<Profile | null> {
        const key = userId || '';
        let read = profileReads.get(key);
        if (!read) {
            read = readProfile(userId).finally(() => { profileReads.delete(key); });
            profileReads.set(key, read);
        }
        // Each caller gets its own copy: some change the signatures they read before saving them.
        const profile = await read;
        return profile ? structuredClone(profile) : null;
    },

    async getCurrentProfile(): Promise<Profile | null> {
        return this.getProfile();
    },

    async updateProfile(updates: Partial<Profile>): Promise<Profile> {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!user) throw new Error('No authenticated user is available to update the profile.');
        return this.updateProfileById(user.id, updates);
    },

    async updateProfileById(userId: string, updates: Partial<Profile>): Promise<Profile> {
        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error updating profile:', error);
            throw error;
        }

        if (!data) throw new Error('The profile update did not return an updated row.');

        return data;
    },

    async getSignatures(): Promise<any> {
        const profile = await this.getCurrentProfile();
        return profile?.signatures || {};
    },

    async setSignatures(signatures: any): Promise<void> {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!user) throw new Error('No authenticated user is available to update signatures.');
        await this.updateProfileById(user.id, { signatures });
    }
};
