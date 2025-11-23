import { supabaseService } from '@/lib/supabase-service';
import { contactedLeadsStorage } from './contacted-leads-service';

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
    return {
        id: row.id,
        name: row.name || 'Campaña',
        isPaused: row.is_paused || false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        steps: Array.isArray(row.steps) ? row.steps : [],
        excludedLeadIds: Array.isArray(row.excluded_lead_ids) ? row.excluded_lead_ids : [],
        sentRecords: row.sent_records && typeof row.sent_records === 'object' ? row.sent_records : {},
    };
}

function mapCampaignToRow(c: Partial<Campaign>) {
    const row: any = {};
    if (c.id) row.id = c.id;
    if (c.name !== undefined) row.name = c.name;
    if (c.isPaused !== undefined) row.is_paused = c.isPaused;
    if (c.createdAt) row.created_at = c.createdAt;
    if (c.updatedAt) row.updated_at = c.updatedAt;
    if (c.steps) row.steps = c.steps;
    if (c.excludedLeadIds) row.excluded_lead_ids = c.excludedLeadIds;
    if (c.sentRecords) row.sent_records = c.sentRecords;
    return row;
}

export const campaignsStorage = {
    async get(): Promise<Campaign[]> {
        try {
            const { data, error } = await supabaseService
                .from('campaigns')
                .select('*')
                .order('created_at', { ascending: false });

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
            const id = input.id || crypto.randomUUID();
            const now = new Date().toISOString();
            const newCampaign: Campaign = {
                id,
                name: input.name,
                steps: input.steps,
                excludedLeadIds: input.excludedLeadIds || [],
                isPaused: false,
                createdAt: now,
                updatedAt: now,
                sentRecords: {},
            };

            const row = mapCampaignToRow(newCampaign);
            const { error } = await supabaseService
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
            const now = new Date().toISOString();
            const updateData = { ...patch, updatedAt: now };
            const row = mapCampaignToRow(updateData);

            const { data, error } = await supabaseService
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
            const { data, error } = await supabaseService
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
            const { error, count } = await supabaseService
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
        return this.update(id, { excludedLeadIds: Array.from(new Set(excludedLeadIds)) });
    }
};
