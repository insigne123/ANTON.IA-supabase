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

// Internal type for the DB row
interface ProfileRow {
    id: string;
    signature?: string | null;
    company_profile?: any; // JSONB
    updated_at?: string;
}

export const profileService = {
    async getProfile(): Promise<Profile | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle(); // Use maybeSingle to avoid error if no row exists

        if (error) {
            console.error('Error fetching profile:', error);
            return null;
        }

        if (!data) {
            // If no profile exists, return a basic one based on auth user
            return {
                id: user.id,
                email: user.email || '',
                full_name: user.user_metadata?.full_name,
                avatar_url: user.user_metadata?.avatar_url,
            };
        }

        const row = data as ProfileRow;
        const cp = row.company_profile || {};

        return {
            id: user.id,
            email: user.email || '',
            full_name: cp.full_name || user.user_metadata?.full_name,
            avatar_url: cp.avatar_url || user.user_metadata?.avatar_url,
            signatures: cp.signatures || {},
            company_name: cp.company_name,
            company_domain: cp.company_domain,
        };
    },

    async updateProfile(updates: Partial<Profile>): Promise<Profile | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        // First get existing data to merge
        const existing = await this.getProfile();
        const currentProfile = existing || { id: user.id, email: user.email || '' };

        // Merge updates
        const merged: Profile = { ...currentProfile, ...updates };

        // Map back to DB structure
        // We store everything in company_profile JSONB column
        const companyProfileData = {
            full_name: merged.full_name,
            avatar_url: merged.avatar_url,
            signatures: merged.signatures,
            company_name: merged.company_name,
            company_domain: merged.company_domain,
        };

        const rowData: ProfileRow = {
            id: user.id,
            company_profile: companyProfileData,
            updated_at: new Date().toISOString(),
            // We can also sync the main signature to the text column if we want, 
            // but for now let's just use the JSONB.
            // signature: merged.signatures?.['default']?.content 
        };

        const { data, error } = await supabase
            .from('profiles')
            .upsert(rowData) // Use upsert to handle insert/update
            .select()
            .single();

        if (error) {
            console.error('Error updating profile:', error);
            return null;
        }

        const row = data as ProfileRow;
        const cp = row.company_profile || {};

        return {
            id: user.id,
            email: user.email || '',
            full_name: cp.full_name,
            avatar_url: cp.avatar_url,
            signatures: cp.signatures,
            company_name: cp.company_name,
            company_domain: cp.company_domain,
        };
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
