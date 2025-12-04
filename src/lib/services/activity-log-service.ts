import { supabase } from '@/lib/supabase';
import { organizationService } from './organization-service';

export type ActivityAction =
    | 'create_lead'
    | 'update_lead'
    | 'delete_lead'
    | 'create_campaign'
    | 'update_campaign'
    | 'delete_campaign'
    | 'invite_member'
    | 'update_member'
    | 'remove_member'
    | 'join_organization'
    | 'leave_organization'
    | 'create_organization'
    | 'update_organization';

export type EntityType = 'lead' | 'campaign' | 'member' | 'organization';

export const activityLogService = {
    async logActivity(
        action: ActivityAction,
        entityType: EntityType,
        entityId?: string,
        details: any = {}
    ) {
        try {
            const orgId = await organizationService.getCurrentOrganizationId();
            if (!orgId) return; // Don't log if not in an org (or maybe log as personal? For now, org only)

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { error } = await supabase
                .from('activity_logs')
                .insert([{
                    organization_id: orgId,
                    user_id: user.id,
                    action,
                    entity_type: entityType,
                    entity_id: entityId,
                    details
                }]);

            if (error) {
                console.error('Error logging activity:', error);
            }
        } catch (error) {
            console.error('Failed to log activity:', error);
        }
    },

    async getActivities(limit: number = 20) {
        const orgId = await organizationService.getCurrentOrganizationId();
        if (!orgId) return [];

        const { data, error } = await supabase
            .from('activity_logs')
            .select(`
                *,
                profiles:profiles!activity_logs_user_id_fkey (
                    full_name,
                    email,
                    avatar_url
                )
            `)
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching activities:', error);
            return [];
        }

        return data || [];
    }
};
