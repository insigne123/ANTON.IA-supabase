import { supabase } from '@/lib/supabase';
import { contactedLeadsStorage } from './contacted-leads-service';
import { organizationService } from './organization-service';

export type CampaignStepAttachment = {
    name: string;
    contentBytes: string;     // base64
    contentType?: string;     // opcional
};

export type CampaignStep = {
    id: string;
    name: string;
    offsetDays: number;       // días desde el último contacto/seguimiento anterior
    subject: string;
    bodyHtml: string;         // permite HTML e imágenes embebidas (base64) o links
    attachments?: CampaignStepAttachment[];
};

export type Campaign = {
    id: string;
    organizationId?: string;
    name: string;
    isPaused: boolean;
    createdAt: string;
    updatedAt: string;
    steps: CampaignStep[];
    excludedLeadIds: string[];                        // leads que NO participan en esta campaña
    // Progreso por lead (independiente por campaña)
    sentRecords: Record<string, { lastStepIdx: number; lastSentAt: string }>;
};

function mapRowToCampaign(row: any): Campaign {
    // Handle both legacy (array) and new (object) formats for steps
    const rawSteps = row.steps;
    const isLegacy = Array.isArray(rawSteps);

    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name || 'Campaña',
        // Map status column to isPaused boolean
        isPaused: row.status === 'PAUSED',
        createdAt: row.created_at,
        // updatedAt is not a column, so we try to get it from JSON or fallback to createdAt
        updatedAt: isLegacy ? row.created_at : (rawSteps?.updatedAt || row.created_at),

        // If legacy, rawSteps is the array. If new, rawSteps.steps is the array.
        steps: isLegacy ? rawSteps : (rawSteps?.steps || []),
        // If legacy, these are empty. If new, they are in the JSON object.
        excludedLeadIds: isLegacy ? [] : (rawSteps?.excludedLeadIds || []),
        sentRecords: isLegacy ? {} : (rawSteps?.sentRecords || {}),
    };
}

function mapCampaignToRow(c: Partial<Campaign>, userId?: string, organizationId?: string | null) {
    const row: any = {};
    if (c.id) row.id = c.id;
    if (c.name !== undefined) row.name = c.name;
    if (userId) row.user_id = userId;
    if (organizationId) row.organization_id = organizationId;

    // Map isPaused to status column
    if (c.isPaused !== undefined) {
        row.status = c.isPaused ? 'PAUSED' : 'ACTIVE';
    }

    if (c.createdAt) row.created_at = c.createdAt;

    // We store everything else in the 'steps' JSONB column
    // We need to preserve existing data if we are doing a partial update.
    // The update method handles fetching existing data, so 'c' should have the merged state.

    if (c.steps || c.excludedLeadIds || c.sentRecords || c.updatedAt) {
        row.steps = {
            steps: c.steps || [],
            excludedLeadIds: c.excludedLeadIds || [],
            sentRecords: c.sentRecords || {},
            updatedAt: c.updatedAt // Store updatedAt in JSON since column doesn't exist
        };
    }

    return row;
}

export const campaignsStorage = {
    async get(): Promise<Campaign[]> {
        try {
            const orgId = await organizationService.getCurrentOrganizationId();

            let query = supabase
                .from('campaigns')
                .select('*')
                .order('created_at', { ascending: false });

            if (orgId) {
                // Allow seeing campaigns for the current org OR personal campaigns (null org_id)
                query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching campaigns:', error);
                return [];
            }
            return (data || []).map(mapRowToCampaign);
        } catch (err) {
            console.error('Unexpected error fetching campaigns:', err);
            return [];
        }
    },

    async add(input: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'isPaused' | 'sentRecords'> & { id?: string }): Promise<Campaign | null> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                console.error('User not authenticated');
                return null;
            }

            const orgId = await organizationService.getCurrentOrganizationId();

            const id = input.id || crypto.randomUUID();
            const now = new Date().toISOString();
            const newCampaign: Campaign = {
                id,
                organizationId: orgId || undefined,
                name: input.name,
                steps: input.steps,
                excludedLeadIds: input.excludedLeadIds || [],
                isPaused: false,
                createdAt: now,
                updatedAt: now,
                sentRecords: {},
            };

            const row = mapCampaignToRow(newCampaign, user.id, orgId);

            const { error } = await supabase
                .from('campaigns')
                .insert([row]);

            if (error) {
                console.error('Error adding campaign:', error);
                return null;
            }
            return newCampaign;
        } catch (err) {
            console.error('Unexpected error adding campaign:', err);
            return null;
        }
    },

    async update(id: string, patch: Partial<Omit<Campaign, 'id' | 'createdAt'>>): Promise<Campaign | null> {
        try {
            // Since we store multiple fields in the 'steps' JSON column, we must fetch first to merge
            // otherwise we might lose data (e.g. updating exclusions would wipe steps).
            const existing = await this.getById(id);
            if (!existing) return null;

            const now = new Date().toISOString();
            const merged: Campaign = {
                ...existing,
                ...patch,
                updatedAt: now
            };

            // We don't update user_id or organization_id on update usually
            const row = mapCampaignToRow(merged);

            const { data, error } = await supabase
                .from('campaigns')
                .update(row)
                .eq('id', id)
                .select()
                .single();

            if (error) {
                console.error('Error updating campaign:', error);
                return null;
            }
            return mapRowToCampaign(data);
        } catch (err) {
            console.error('Unexpected error updating campaign:', err);
            return null;
        }
    },

    async getById(id: string): Promise<Campaign | null> {
        try {
            const { data, error } = await supabase
                .from('campaigns')
                .select('*')
                .eq('id', id)
                .single();

            if (error) {
                // console.error('Error getting campaign by id:', error);
                return null;
            }
            return mapRowToCampaign(data);
        } catch (err) {
            console.error('Unexpected error getting campaign by id:', err);
            return null;
        }
    },

    async remove(id: string): Promise<number> {
        try {
            const { error, count } = await supabase
                .from('campaigns')
                .delete()
                .eq('id', id); // .delete({ count: 'exact' }) is not directly available in all clients but delete returns count often.

            // Supabase JS client delete returns data, error, count, status, statusText
            if (error) {
                console.error('Error removing campaign:', error);
                return 0;
            }
            return 1; // Assuming success if no error
        } catch (err) {
            console.error('Unexpected error removing campaign:', err);
            return 0;
        }
    },

    async togglePause(id: string, paused: boolean): Promise<Campaign | null> {
        return this.update(id, { isPaused: paused });
    },

    async setExclusions(id: string, excludedLeadIds: string[]): Promise<Campaign | null> {
        return this.update(id, { excludedLeadIds: [...new Set(excludedLeadIds)] });
    }
};
