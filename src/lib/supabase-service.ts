import { supabase } from './supabase';
import type { Lead } from './types';

const TABLE = 'leads';

// Helper to map DB row to Lead type
function mapRowToLead(row: any): Lead {
    return {
        id: row.id,
        name: row.name,
        title: row.title,
        company: row.company,
        email: row.email,
        avatar: row.avatar,
        status: row.status,
        emailEnrichment: row.email_enrichment,
        industry: row.industry,
        companyWebsite: row.company_website,
        companyLinkedin: row.company_linkedin,
        linkedinUrl: row.linkedin_url,
        location: row.location,
        country: row.country,
        city: row.city,
    };
}

// Helper to map Lead type to DB row
function mapLeadToRow(lead: Lead, userId: string) {
    // Validate UUID. If invalid, let DB generate one.
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lead.id || '');

    const row: any = {
        user_id: userId,
        name: lead.name,
        title: lead.title,
        company: lead.company,
        email: lead.email,
        avatar: lead.avatar,
        status: lead.status,
        email_enrichment: lead.emailEnrichment,
        industry: lead.industry,
        company_website: lead.companyWebsite,
        company_linkedin: lead.companyLinkedin,
        linkedin_url: lead.linkedinUrl,
        location: lead.location,
        country: lead.country,
        city: lead.city,
    };

    if (isValidUUID) {
        row.id = lead.id;
    }

    return row;
}

export const supabaseService = {
    async getLeads(): Promise<Lead[]> {
        const { data, error } = await supabase
            .from(TABLE)
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching leads:', error);
            return [];
        }

        return (data || []).map(mapRowToLead);
    },

    // WARNING: This replaces all leads for the user. Use with caution or prefer add/remove.
    async setLeads(items: Lead[]) {
        console.warn('supabaseService.setLeads is not fully implemented to overwrite all data. Use add/remove methods.');
    },

    async addLeadsDedup(items: Lead[]): Promise<{ addedCount: number; duplicateCount: number }> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { addedCount: 0, duplicateCount: 0 };

        const existing = await this.getLeads();
        // Use content-based key for deduplication because incoming IDs might be non-UUIDs (from n8n)
        // while existing IDs are UUIDs. Comparing them would always fail.
        const key = (v: Lead) => `${v.name || ''}|${v.company || ''}|${v.title || ''}`.toLowerCase();
        const seen = new Set(existing.map(key));

        const toInsert: any[] = [];
        let duplicateCount = 0;

        for (const it of items) {
            const k = key(it);
            if (!seen.has(k)) {
                toInsert.push(mapLeadToRow(it, user.id));
                seen.add(k);
            } else {
                duplicateCount++;
            }
        }

        if (toInsert.length > 0) {
            const { error } = await supabase.from(TABLE).insert(toInsert);
            if (error) {
                console.error('Error adding leads:', error);
                return { addedCount: 0, duplicateCount }; // Or throw
            }
        }

        return { addedCount: toInsert.length, duplicateCount };
    },

    async isLeadSaved(lead: Lead): Promise<boolean> {
        const all = await this.getLeads();
        const key = (v: Lead) => `${v.name || ''}|${v.company || ''}|${v.title || ''}`.toLowerCase();
        const toFind = key(lead);
        return all.some(v => key(v) === toFind);
    },

    async removeWhere(pred: (l: Lead) => boolean): Promise<number> {
        const all = await this.getLeads();
        const toRemove = all.filter(pred);

        if (toRemove.length === 0) return 0;

        const ids = toRemove.map(l => l.id);
        const { error } = await supabase.from(TABLE).delete().in('id', ids);

        if (error) {
            console.error('Error removing leads:', error);
            return 0;
        }

        return toRemove.length;
    }
};
