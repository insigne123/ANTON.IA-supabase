import { supabase } from '../supabase';
import {
    AntoniaMission,
    AntoniaTask,
    AntoniaTaskType,
    AntoniaConfig,
    AntoniaMissionStatus
} from '../types';

export const antoniaService = {
    /**
     * Get configuration for an organization
     */
    getConfig: async (organizationId: string): Promise<AntoniaConfig | null> => {
        const { data, error } = await supabase
            .from('antonia_config')
            .select('*')
            .eq('organization_id', organizationId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching Antonia Config:', error);
            return null;
        }

        if (!data) return null;

        // Map snake_case to camelCase
        return {
            organizationId: data.organization_id,
            notificationEmail: data.notification_email,
            dailyReportEnabled: data.daily_report_enabled,
            instantAlertsEnabled: data.instant_alerts_enabled,
            dailySearchLimit: data.daily_search_limit,
            dailyEnrichLimit: data.daily_enrich_limit,
            dailyInvestigateLimit: data.daily_investigate_limit,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };
    },

    /**
     * Update or Create configuration
     */
    upsertConfig: async (config: Partial<AntoniaConfig> & { organizationId: string }) => {
        // Map camelCase to snake_case for DB
        const dbPayload = {
            organization_id: config.organizationId,
            notification_email: config.notificationEmail,
            daily_report_enabled: config.dailyReportEnabled,
            instant_alerts_enabled: config.instantAlertsEnabled,
            daily_search_limit: config.dailySearchLimit ?? 3,
            daily_enrich_limit: config.dailyEnrichLimit ?? 50,
            daily_investigate_limit: config.dailyInvestigateLimit ?? 20,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('antonia_config')
            .upsert(dbPayload)
            .select()
            .single();

        if (error) throw error;

        // Map snake_case response to camelCase
        return {
            organizationId: data.organization_id,
            notificationEmail: data.notification_email,
            dailyReportEnabled: data.daily_report_enabled,
            instantAlertsEnabled: data.instant_alerts_enabled,
            dailySearchLimit: data.daily_search_limit,
            dailyEnrichLimit: data.daily_enrich_limit,
            dailyInvestigateLimit: data.daily_investigate_limit,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };
    },

    /**
     * Create a new Mission
     */
    createMission: async (
        organizationId: string,
        userId: string,
        title: string,
        goalSummary: string,
        params: any
    ): Promise<AntoniaMission> => {
        const { data, error } = await supabase
            .from('antonia_missions')
            .insert({
                organization_id: organizationId,
                user_id: userId,
                title,
                status: 'active',
                goal_summary: goalSummary,
                params,
                daily_search_limit: params.dailySearchLimit || 1,
                daily_enrich_limit: params.dailyEnrichLimit || 10,
                daily_investigate_limit: params.dailyInvestigateLimit || 5,
                daily_contact_limit: params.dailyContactLimit || 3
            })
            .select()
            .single();

        if (error) throw error;

        return {
            id: data.id,
            organizationId: data.organization_id,
            userId: data.user_id,
            title: data.title,
            status: data.status,
            goalSummary: data.goal_summary,
            params: data.params,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        } as AntoniaMission;
    },

    /**
     * Add a Task to the Queue
     * Includes Idempotency Check
     */
    createTask: async (
        organizationId: string,
        type: AntoniaTaskType,
        payload: any,
        options?: { missionId?: string; idempotencyKey?: string }
    ): Promise<AntoniaTask | null> => {
        const { missionId, idempotencyKey } = options || {};

        const dbPayload: any = {
            organization_id: organizationId,
            type,
            status: 'pending',
            payload,
            mission_id: missionId,
        };

        if (idempotencyKey) {
            dbPayload.idempotency_key = idempotencyKey;
        }

        const { data, error } = await supabase
            .from('antonia_tasks')
            .insert(dbPayload)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique violation (idempotency)
                console.warn(`[Antonia] Task with idempotency key ${idempotencyKey} already exists. Skipping.`);
                // Optionally fetch existing task to return it
                return null;
            }
            throw error;
        }
        return data as AntoniaTask;
    },

    /**
     * Get Active Missions
     */
    getActiveMissions: async (organizationId: string) => {
        const { data, error } = await supabase
            .from('antonia_missions')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return data.map((m: any) => ({
            id: m.id,
            organizationId: m.organization_id,
            userId: m.user_id,
            title: m.title,
            status: m.status,
            goalSummary: m.goal_summary,
            params: m.params,
            createdAt: m.created_at,
            updatedAt: m.updated_at
        })) as AntoniaMission[];
    },

    /**
     * Get Campaigns for Organization
     */
    getCampaigns: async (organizationId: string) => {
        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Map to CamelCase to match Campaign type
        return data.map((c: any) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            organizationId: c.organization_id
        }));
    },

    /**
     * Update Mission Status or Title
     */
    updateMission: async (
        missionId: string,
        updates: { status?: AntoniaMissionStatus; title?: string }
    ) => {
        const { data, error } = await supabase
            .from('antonia_missions')
            .update(updates)
            .eq('id', missionId)
            .select()
            .single();

        if (error) throw error;

        return {
            id: data.id,
            organizationId: data.organization_id,
            userId: data.user_id,
            title: data.title,
            status: data.status,
            goalSummary: data.goal_summary,
            params: data.params,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        } as AntoniaMission;
    },

    /**
     * Get Recent Logs
     * @deprecated Logs are now tracked in antonia_tasks and visualized in AgentActivityFeed
     */
    getLogs: async (organizationId: string, limit = 50, missionId?: string) => {
        let query = supabase
            .from('antonia_logs')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (missionId) {
            query = query.eq('mission_id', missionId);
        }

        const { data, error } = await query;

        if (error) throw error;
        return data;
    },

    deleteMission: async (missionId: string) => {
        const { error } = await supabase
            .from('antonia_missions')
            .delete()
            .eq('id', missionId);

        if (error) throw error;
        return true;
    },

    /**
     * Generate a Historic Report for a Mission
     */
    generateMissionReport: async (organizationId: string, missionId: string, userId: string) => {
        return antoniaService.createTask(organizationId, 'GENERATE_REPORT', {
            reportType: 'mission_historic',
            missionId,
            userId
        });
    },

    /**
     * Get Reports for Organization
     */
    getReports: async (organizationId: string) => {
        const { data, error } = await supabase
            .from('antonia_reports')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching reports:', error);
            return [];
        }

        return data?.map((r: any) => ({
            id: r.id,
            organizationId: r.organization_id,
            missionId: r.mission_id,
            type: r.type,
            content: r.content,
            summaryData: r.summary_data,
            sentTo: r.sent_to,
            createdAt: r.created_at
        })) || [];
    }
};
