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
        return data;
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
            daily_search_limit: config.dailySearchLimit ?? 100,
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
        return data;
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
            })
            .select()
            .single();

        if (error) throw error;
        return data as AntoniaMission;
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
        return data as AntoniaMission[];
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
     * Get Recent Logs
     */
    getLogs: async (organizationId: string, limit = 50) => {
        const { data, error } = await supabase
            .from('antonia_logs')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data;
    }
};
