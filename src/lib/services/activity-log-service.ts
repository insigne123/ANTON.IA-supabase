import { supabase } from '@/lib/supabase';
import { organizationService } from './organization-service';

export type ActivityLog = {
    id: string;
    organization_id: string;
    user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata: any;
    created_at: string;
    profiles?: {
        full_name: string | null;
        email: string | null;
        avatar_url: string | null;
    };
};

export const activityLogService = {
    async logActivity(
        action: string,
        entityType: string,
        entityId?: string,
        metadata: any = {}
    ): Promise<void> {
        try {
            const orgId = await organizationService.getCurrentOrganizationId();
            if (!orgId) return;

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            await supabase.from('activity_logs').insert({
                organization_id: orgId,
                user_id: user.id,
                action,
                entity_type: entityType,
                entity_id: entityId,
                metadata
            });
        } catch (error) {
            console.error('Failed to log activity:', error);
            // Don't throw, logging shouldn't break the main flow
        }
    },

    async getLogs(limit = 50): Promise<ActivityLog[]> {
        const orgId = await organizationService.getCurrentOrganizationId();
        if (!orgId) return [];

        const { data, error } = await supabase
            .from('activity_logs')
            .select(`
        *,
        profiles:user_id (
          full_name,
          email,
          avatar_url
        )
      `)
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching activity logs:', error);
            return [];
        }

        return data || [];
    }
};
