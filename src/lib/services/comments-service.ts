import { supabase } from '@/lib/supabase';
import { Comment } from '@/lib/types';
import { organizationService } from './organization-service';

export const commentsService = {
    async getComments(entityType: string, entityId: string): Promise<Comment[]> {
        const { data, error } = await supabase
            .from('comments')
            .select(`
        *,
        user:profiles!comments_user_id_fkey (
          full_name,
          avatar_url,
          email
        )
      `)
            .eq('entity_type', entityType)
            .eq('entity_id', entityId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching comments:', error);
            return [];
        }

        return data.map((row: any) => ({
            id: row.id,
            organizationId: row.organization_id,
            userId: row.user_id,
            entityType: row.entity_type,
            entityId: row.entity_id,
            content: row.content,
            createdAt: row.created_at,
            user: {
                fullName: row.user?.full_name || 'Unknown',
                avatarUrl: row.user?.avatar_url,
                email: row.user?.email,
            },
        }));
    },

    async addComment(entityType: string, entityId: string, content: string): Promise<Comment | null> {
        const orgId = await organizationService.getCurrentOrganizationId();
        if (!orgId) throw new Error('No organization found');

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No user found');

        const { data, error } = await supabase
            .from('comments')
            .insert({
                organization_id: orgId,
                user_id: user.id,
                entity_type: entityType,
                entity_id: entityId,
                content,
            })
            .select(`
        *,
        user:profiles!comments_user_id_fkey (
          full_name,
          avatar_url,
          email
        )
      `)
            .single();

        if (error) {
            console.error('Error adding comment:', error);
            return null;
        }

        return {
            id: data.id,
            organizationId: data.organization_id,
            userId: data.user_id,
            entityType: data.entity_type,
            entityId: data.entity_id,
            content: data.content,
            createdAt: data.created_at,
            user: {
                fullName: data.user?.full_name || 'Unknown',
                avatarUrl: data.user?.avatar_url,
                email: data.user?.email,
            },
        };
    },

    async deleteComment(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('comments')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting comment:', error);
            return false;
        }
        return true;
    }
};
