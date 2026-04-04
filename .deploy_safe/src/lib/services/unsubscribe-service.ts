import { supabase } from '@/lib/supabase';
import { organizationService } from './organization-service';

export interface UnsubscribedEmail {
    id: string;
    email: string;
    user_id: string | null;
    organization_id: string | null;
    reason?: string;
    created_at: string;
}

export const unsubscribeService = {
    /**
     * Checks if an email is blocked for a given user or organization.
     */
    async isBlacklisted(email: string, userId: string, organizationId?: string | null): Promise<boolean> {
        let query = supabase
            .from('unsubscribed_emails')
            .select('id')
            .eq('email', email);

        if (organizationId) {
            // Check if blocked for THIS user OR THIS org
            query = query.or(`user_id.eq.${userId},organization_id.eq.${organizationId}`);
        } else {
            // Check if blocked for THIS user
            query = query.eq('user_id', userId);
        }

        const { data, error } = await query.single();

        // .single() returns error if no rows found (PGRST116), or row if found.
        if (data) return true;
        return false;
    },

    /**
     * Adds an email to the blacklist.
     * IMPORTANT: This should be used server-side or by authenticated users.
     */
    async addToBlacklist(email: string, userId?: string, organizationId?: string | null, reason?: string) {
        // Prepare payload
        // If orgId is present, we prefer blocking at org level? Or user level?
        // User requirements: "if user joins an org that the org also keeps this in mind"
        // Interpretation: Block should likely attach to the scope that SENT the email.

        // We will insert based on provided IDs.
        const payload: any = {
            email,
            reason
        };

        if (organizationId) payload.organization_id = organizationId;
        else if (userId) payload.user_id = userId;
        else throw new Error('Must provide userId or organizationId');

        const { error } = await supabase
            .from('unsubscribed_emails')
            .insert(payload);

        if (error) {
            // Ignore unique violation (already blocked)
            if (error.code !== '23505') {
                console.error('Error adding to blacklist:', error);
                throw error;
            }
        }
    },

    /**
     * Gets the list of blocked emails for the current context (User + Org).
     */
    async getBlacklist(): Promise<UnsubscribedEmail[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return [];

        const orgId = await organizationService.getCurrentOrganizationId();

        let query = supabase
            .from('unsubscribed_emails')
            .select('*')
            .order('created_at', { ascending: false });

        if (orgId) {
            query = query.or(`user_id.eq.${user.id},organization_id.eq.${orgId}`);
        } else {
            query = query.eq('user_id', user.id);
        }

        const { data, error } = await query;
        if (error) {
            console.error('Error fetching blacklist:', error);
            return [];
        }
        return data as UnsubscribedEmail[];
    },

    /**
     * Removes an entry from the blacklist.
     */
    async removeFromBlacklist(id: string): Promise<void> {
        const { error } = await supabase
            .from('unsubscribed_emails')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error removing from blacklist:', error);
            throw error;
        }
    }
};
