import { supabase } from '@/lib/supabase';
import { SavedSearch } from '@/lib/types';
import { organizationService } from './organization-service';

export const savedSearchesService = {
    async getSavedSearches(): Promise<SavedSearch[]> {
        const { data, error } = await supabase
            .from('saved_searches')
            .select(`
        *,
        user:profiles!saved_searches_user_id_fkey (
          full_name,
          avatar_url
        )
      `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching saved searches:', error);
            return [];
        }

        return data.map((row: any) => ({
            id: row.id,
            organizationId: row.organization_id,
            userId: row.user_id,
            name: row.name,
            criteria: row.criteria,
            isShared: row.is_shared,
            createdAt: row.created_at,
            user: {
                fullName: row.user?.full_name || 'Unknown',
                avatarUrl: row.user?.avatar_url,
            },
        }));
    },

    async saveSearch(name: string, criteria: any, isShared: boolean): Promise<SavedSearch | null> {
        const orgId = await organizationService.getCurrentOrganizationId();
        if (!orgId) throw new Error('No organization found');

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No user found');

        const { data, error } = await supabase
            .from('saved_searches')
            .insert({
                organization_id: orgId,
                user_id: user.id,
                name,
                criteria,
                is_shared: isShared,
            })
            .select(`
        *,
        user:profiles!saved_searches_user_id_fkey (
          full_name,
          avatar_url
        )
      `)
            .single();

        if (error) {
            console.error('Error saving search:', error);
            return null;
        }

        return {
            id: data.id,
            organizationId: data.organization_id,
            userId: data.user_id,
            name: data.name,
            criteria: data.criteria,
            isShared: data.is_shared,
            createdAt: data.created_at,
            user: {
                fullName: data.user?.full_name || 'Unknown',
                avatarUrl: data.user?.avatar_url,
            },
        };
    },

    async deleteSearch(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('saved_searches')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting saved search:', error);
            return false;
        }
        return true;
    }
};
