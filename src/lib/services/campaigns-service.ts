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

    // A/B Testing
    variantB?: {
        subject: string;
        bodyHtml: string;
        attachments?: CampaignStepAttachment[];
        weight?: number; // 0.5 default (50/50)
    };
};

// UI-compatible Campaign
export type Campaign = {
    id: string;
    organizationId?: string;
    name: string;
    isPaused: boolean;
    steps: CampaignStep[];
    excludedLeadIds: string[];
    createdAt: string;
    updatedAt: string;
    // Progreso por lead (independiente por campaña)
    sentRecords?: Record<string, { lastStepIdx: number; lastSentAt: string }>;

    // Campaign-wide settings
    settings?: {
        smartScheduling?: {
            enabled: boolean;
            timezone: string;
            startHour: number; // 0-23
            endHour: number;   // 0-23
        };
    };
};

function mapRowToCampaign(row: any, steps: any[] = []): Campaign {
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name || 'Campaña',
        isPaused: row.status === 'paused',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        steps: steps.map(s => ({
            id: s.id,
            name: s.name || `Paso ${s.order_index + 1}`,
            offsetDays: s.offset_days,
            subject: s.subject_template,
            bodyHtml: s.body_template,
            attachments: s.attachments as CampaignStepAttachment[],
            variantB: s.variant_b || undefined
        })),
        excludedLeadIds: row.excluded_lead_ids || [],
        sentRecords: row.sent_records || row.sentRecords || {},
        settings: row.settings || undefined
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
                    excluded_lead_ids: input.excludedLeadIds || [],
                    settings: input.settings || {},
                    sent_records: input.sentRecords || {}
                })
                .select()
                .single();

            if (campError || !campData) {
                console.error('Error adding campaign:', campError);
                return null;
            }

            // 2. Insert Steps
            if (input.steps && input.steps.length > 0) {
                const stepsPayload = input.steps.map((s, idx) => ({
                    campaign_id: campData.id,
                    order_index: idx,
                    name: s.name,
                    offset_days: s.offsetDays,
                    subject_template: s.subject,
                    body_template: s.bodyHtml,
                    attachments: s.attachments || [],
                    variant_b: s.variantB || null
                }));

                const { error: stepsError } = await supabase
                    .from(TABLE_STEPS)
                    .insert(stepsPayload);

                if (stepsError) {
                    console.error('Error adding steps:', stepsError);
                }
            }

            return await this.getById(campData.id);
        } catch (err) {
            console.error('Error in add campaign:', err);
            return null;
        }
    },

    async update(id: string, patch: Partial<Campaign>): Promise<Campaign | null> {
        try {
            const updateData: any = { updated_at: new Date().toISOString() };
            if (patch.name !== undefined) updateData.name = patch.name;
            if (patch.isPaused !== undefined) updateData.status = patch.isPaused ? 'paused' : 'active';
            if (patch.excludedLeadIds !== undefined) updateData.excluded_lead_ids = patch.excludedLeadIds;
            if (patch.settings !== undefined) updateData.settings = patch.settings;
            if (patch.sentRecords !== undefined) updateData.sent_records = patch.sentRecords;

            const { error } = await supabase
                .from(TABLE_CAMPAIGNS)
                .update(updateData)
                .eq('id', id);

            if (error) throw error;

            // If steps are provided, replace them
            if (patch.steps) {
                // Delete old steps
                await supabase.from(TABLE_STEPS).delete().eq('campaign_id', id);

                // Insert new steps
                const stepsPayload = patch.steps.map((s, idx) => ({
                    campaign_id: id,
                    order_index: idx,
                    name: s.name,
                    offset_days: s.offsetDays,
                    subject_template: s.subject,
                    body_template: s.bodyHtml,
                    attachments: s.attachments || [],
                    variant_b: s.variantB || null
                }));
                await supabase.from(TABLE_STEPS).insert(stepsPayload);
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
