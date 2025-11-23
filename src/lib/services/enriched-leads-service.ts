import { supabase } from '../supabase';
import type { EnrichedLead } from '../types';
import { v4 as uuidv4 } from 'uuid';

const TABLE = 'enriched_leads';

function mapRowToEnrichedLead(row: any): EnrichedLead {
    return {
        id: row.id,
        sourceOpportunityId: row.data?.sourceOpportunityId,
        fullName: row.full_name,
        email: row.email,
        companyName: row.company_name,
        title: row.title,
        linkedinUrl: row.linkedin_url,
        emailStatus: row.data?.emailStatus,
        companyDomain: row.data?.companyDomain,
        descriptionSnippet: row.data?.descriptionSnippet,
        createdAt: row.created_at,
        country: row.data?.country,
        city: row.data?.city,
        industry: row.data?.industry,
    };
}

function mapEnrichedLeadToRow(lead: EnrichedLead, userId: string) {
    // Validate UUID or generate one if missing/invalid
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lead.id || '');
    const id = isValidUUID ? lead.id : uuidv4();

    return {
        id,
        user_id: userId,
        full_name: lead.fullName,
        email: lead.email,
        company_name: lead.companyName,
        title: lead.title,
        linkedin_url: lead.linkedinUrl,
        created_at: lead.createdAt || new Date().toISOString(),
        data: {
            sourceOpportunityId: lead.sourceOpportunityId,
            emailStatus: lead.emailStatus,
            companyDomain: lead.companyDomain,
            descriptionSnippet: lead.descriptionSnippet,
            country: lead.country,
            city: lead.city,
            industry: lead.industry,
        },
    };
}

export async function getEnrichedLeads(): Promise<EnrichedLead[]> {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching enriched leads:', error);
        return [];
    }

    return (data || []).map(mapRowToEnrichedLead);
}

export async function setEnrichedLeads(items: EnrichedLead[]) {
    console.warn('setEnrichedLeads is not fully supported in cloud mode. Use add/remove methods.');
}

export async function addEnrichedLeads(items: EnrichedLead[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const existing = await getEnrichedLeads();
    const key = (v: EnrichedLead) => (v.id || v.email || `${v.fullName}|${v.companyName}|${v.title}`).toLowerCase();
    const seen = new Set(existing.map(key));

    const toInsert: any[] = [];

    for (const item of items) {
        const k = key(item);
        if (!seen.has(k)) {
            toInsert.push(mapEnrichedLeadToRow(item, user.id));
            seen.add(k);
        }
    }

    if (toInsert.length > 0) {
        const { error } = await supabase.from(TABLE).insert(toInsert);
        if (error) {
            console.error('Error adding enriched leads:', error);
        }
    }
}

export async function removeWhere(pred: (e: EnrichedLead) => boolean): Promise<number> {
    const all = await getEnrichedLeads();
    const toRemove = all.filter(pred);

    if (toRemove.length === 0) return 0;

    const ids = toRemove.map(l => l.id);
    const { error } = await supabase.from(TABLE).delete().in('id', ids);

    if (error) {
        console.error('Error removing enriched leads:', error);
        return 0;
    }

    return toRemove.length;
}

export async function findEnrichedLeadById(id: string): Promise<EnrichedLead | undefined> {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) return undefined;
    return mapRowToEnrichedLead(data);
}

export async function removeEnrichedLeadById(id: string) {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) {
        console.error('Error removing enriched lead:', error);
    }
    return await getEnrichedLeads();
}

export const enrichedLeadsStorage = {
    get: getEnrichedLeads,
    set: setEnrichedLeads,
    addDedup: async (newOnes: EnrichedLead[]) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { addedCount: 0, duplicateCount: 0, added: [], duplicates: [] };

        const existing = await getEnrichedLeads();
        const keyOf = (l: EnrichedLead) => (l.id?.trim() || (l.email?.trim() || '') || `${l.fullName || ''}|${l.companyDomain || l.companyName || ''}|${l.title || ''}`).toLowerCase();
        const seen = new Set(existing.map(keyOf));

        const added: EnrichedLead[] = [];
        const dups: EnrichedLead[] = [];
        const toInsert: any[] = [];

        for (const raw of newOnes) {
            const k = keyOf(raw);
            if (!k || seen.has(k)) {
                dups.push(raw);
                continue;
            }

            // Prepare for insert
            const row = mapEnrichedLeadToRow(raw, user.id);
            toInsert.push(row);

            // Add to local tracking
            seen.add(k);
            added.push(mapRowToEnrichedLead(row)); // Approximate return value
        }

        if (toInsert.length > 0) {
            const { error } = await supabase.from(TABLE).insert(toInsert);
            if (error) {
                console.error('Error adding enriched leads:', error);
                return { addedCount: 0, duplicateCount: dups.length, added: [], duplicates: dups };
            }
        }

        return { addedCount: added.length, duplicateCount: dups.length, added, duplicates: dups };
    },
    isSaved: async (l: EnrichedLead) => {
        const all = await getEnrichedLeads();
        const keyOf = (l: EnrichedLead) => (l.id?.trim() || (l.email?.trim() || '') || `${l.fullName || ''}|${l.companyDomain || l.companyName || ''}|${l.title || ''}`).toLowerCase();
        return all.some(x => keyOf(x) === keyOf(l));
    },
    removeById: async (id: string) => {
        const { error } = await supabase.from(TABLE).delete().eq('id', id);
        if (error) {
            console.error('Error removing enriched lead:', error);
            return { removed: false, remaining: 0 };
        }
        // We'd need to fetch count to be accurate, but for now:
        const remaining = (await getEnrichedLeads()).length;
        return { removed: true, remaining };
    },
    removeWhere: removeWhere,
    findEnrichedLeadById: findEnrichedLeadById,
};
