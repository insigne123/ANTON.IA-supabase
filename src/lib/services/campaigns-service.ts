import { supabase } from '@/lib/supabase';
import { contactedLeadsStorage } from './contacted-leads-service';
import { organizationService } from './organization-service';
import { activityLogService } from './activity-log-service';

// Constants for table names
const TABLE_CAMPAIGNS = 'campaigns';
const TABLE_STEPS = 'campaign_steps';

export type CampaignStepAttachment = {
    name: string;
    contentBytes: string;     // base64
    contentType?: string;     // opcional
};

// UI-compatible CampaignStep
export type CampaignStep = {
    id: string; // UI needs ID for keys/editing
    name: string;
    offsetDays: number;
    subject: string; // UI uses 'subject'
    bodyHtml: string; // UI uses 'bodyHtml'
    attachments?: CampaignStepAttachment[];
};

// UI-compatible Campaign
export type Campaign = {
    id: string;
    organizationId?: string;
    name: string;
    isPaused: boolean; // UI uses boolean isPaused
    createdAt: string;
    updatedAt: string;
    steps: CampaignStep[];
    excludedLeadIds: string[];
    sentRecords: Record<string, { lastStepIdx: number; lastSentAt: string }>;
};

function mapRowToCampaign(row: any, steps: any[] = []): Campaign {
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name || 'Campaña',
        isPaused: row.status === 'paused', // Map DB status -> UI boolean
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        steps: steps.map(s => ({
            id: s.id,
            name: `Paso ${s.order_index + 1}`, // Generate a name if missing
            offsetDays: s.offset_days,
            subject: s.subject_template, // Map DB -> UI
            bodyHtml: s.body_template,   // Map DB -> UI
            attachments: s.attachments as CampaignStepAttachment[]
        })),
        excludedLeadIds: row.excluded_lead_ids || [],
        sentRecords: {} // Not persisted in relational schema yet, return empty
    };
}

export const campaignsStorage = {
    async get(): Promise<Campaign[]> {
        try {
            const orgId = await organizationService.getCurrentOrganizationId();

            let query = supabase
                .from(TABLE_CAMPAIGNS)
                .select('*')
                .order('created_at', { ascending: false });

            if (orgId) {
                query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
            }

            const { data: campaigns, error: errC } = await query;

            if (errC || !campaigns) {
                console.error('Error fetching campaigns:', errC);
                return [];
            }

            // Fetch steps
            const campaignIds = campaigns.map(c => c.id);
            let stepsByCampaign: Record<string, any[]> = {};

            if (campaignIds.length > 0) {
                const { data: steps, error: errS } = await supabase
                    .from(TABLE_STEPS)
                    .select('*')
                    .in('campaign_id', campaignIds)
                    .order('order_index', { ascending: true });

                if (!errS && steps) {
                    steps.forEach((s: any) => {
                        if (!stepsByCampaign[s.campaign_id]) stepsByCampaign[s.campaign_id] = [];
                        stepsByCampaign[s.campaign_id].push(s);
                    });
                }
            }

            return campaigns.map(c => mapRowToCampaign(c, stepsByCampaign[c.id] || []));
        } catch (err) {
            console.error('Unexpected error fetching campaigns:', err);
            return [];
        }
    },

    async add(input: Partial<Campaign>): Promise<Campaign | null> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;

            const orgId = await organizationService.getCurrentOrganizationId();

            // 1. Insert Campaign
            const { data: campData, error: campError } = await supabase
                .from(TABLE_CAMPAIGNS)
                .insert({
                    user_id: user.id,
                    organization_id: orgId,
                    name: input.name,
                    status: input.isPaused ? 'paused' : 'active',
                    excluded_lead_ids: input.excludedLeadIds || []
                })
                .select()
                .single();

            if (campError || !campData) {
                console.error('Error adding campaign:', campError);
                return null;
            }

            // 2. Insert Steps
            if (input.steps && input.steps.length > 0) {
                const stepsToInsert = input.steps.map((s, idx) => ({
                    campaign_id: campData.id,
                    order_index: idx,
                    offset_days: s.offsetDays,
                    subject_template: s.subject || '', // Map UI -> DB
                    body_template: s.bodyHtml || '',   // Map UI -> DB
                    attachments: s.attachments || []
                }));

                const { error: stepsError } = await supabase
                    .from(TABLE_STEPS)
                    .insert(stepsToInsert);

                if (stepsError) console.error('Error adding steps:', stepsError);
            }

            await activityLogService.logActivity('create_campaign', 'campaign', campData.id, { name: campData.name });

            return this.getById(campData.id);
        } catch (err) {
            console.error('Unexpected error adding campaign:', err);
            return null;
        }
    },

    async update(id: string, patch: Partial<Campaign>): Promise<Campaign | null> {
        try {
            const updateData: any = { updated_at: new Date().toISOString() };
            if (patch.name !== undefined) updateData.name = patch.name;
            if (patch.isPaused !== undefined) updateData.status = patch.isPaused ? 'paused' : 'active';
            if (patch.excludedLeadIds !== undefined) updateData.excluded_lead_ids = patch.excludedLeadIds;

            const { error } = await supabase
                .from(TABLE_CAMPAIGNS)
                .update(updateData)
                .eq('id', id);

            if (error) throw error;

            // If steps are provided, replace them
            if (patch.steps) {
                await supabase.from(TABLE_STEPS).delete().eq('campaign_id', id);

                const stepsToInsert = patch.steps.map((s, idx) => ({
                    campaign_id: id,
                    order_index: idx,
                    offset_days: s.offsetDays,
                    subject_template: s.subject,
                    body_template: s.bodyHtml,
                    attachments: s.attachments || []
                }));
                await supabase.from(TABLE_STEPS).insert(stepsToInsert);
            }

            return this.getById(id);
        } catch (e) {
            console.error("Error update", e);
            return null;
        }
    },

    async getById(id: string): Promise<Campaign | null> {
        const all = await this.get();
        return all.find(c => c.id === id) || null;
    },

    async remove(id: string): Promise<number> {
        const { error } = await supabase.from(TABLE_CAMPAIGNS).delete().eq('id', id);
        return error ? 0 : 1;
    },

    async togglePause(id: string, paused: boolean): Promise<Campaign | null> {
        return this.update(id, { isPaused: paused });
    },

    async setExclusions(id: string, excludedLeadIds: string[]): Promise<Campaign | null> {
        return this.update(id, { excludedLeadIds: excludedLeadIds });
    }
};
