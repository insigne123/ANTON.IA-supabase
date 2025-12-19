import { supabase } from '../supabase';
import type { EnrichedLead } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { organizationService } from './organization-service';

// New table for Separated Opportunities
const TABLE = 'enriched_opportunities';

// We reuse EnrichedLead type as it fits the data shape (person found via opportunity)
// But we store it in a different table.

function mapRowToEnrichedLead(row: any): EnrichedLead {
    return {
        id: row.id,
        organizationId: row.organization_id,
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
        phoneNumbers: typeof row.phone_numbers === 'string'
            ? tryParse(row.phone_numbers)
            : (Array.isArray(row.phone_numbers) ? row.phone_numbers : []),
        primaryPhone: row.primary_phone,
        enrichmentStatus: row.enrichment_status,
    };
}

function tryParse(json: string) {
    try {
        return JSON.parse(json);
    } catch {
        return [];
    }
}

function mapEnrichedLeadToRow(lead: EnrichedLead, userId: string, organizationId: string | null) {
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lead.id || '');
    const id = isValidUUID ? lead.id : uuidv4();

    return {
        id,
        user_id: userId,
        organization_id: organizationId,
        full_name: lead.fullName,
        email: lead.email,
        company_name: lead.companyName,
        title: lead.title,
        linkedin_url: lead.linkedinUrl,
        created_at: lead.createdAt || new Date().toISOString(),
        phone_numbers: lead.phoneNumbers,
        primary_phone: lead.primaryPhone,
        enrichment_status: lead.enrichmentStatus ?? 'completed',
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

export async function getEnrichedOpportunities(): Promise<EnrichedLead[]> {
    const orgId = await organizationService.getCurrentOrganizationId();

    let query = supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false });

    if (orgId) {
        query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching enriched opportunities:', error);
        return [];
    }

    return (data || []).map(mapRowToEnrichedLead);
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

export const enrichedOpportunitiesStorage = {
    get: getEnrichedOpportunities,
    addDedup: async (newOnes: EnrichedLead[]) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { addedCount: 0, duplicateCount: 0, added: [], duplicates: [] };

        const orgId = await organizationService.getCurrentOrganizationId();
        const existing = await getEnrichedOpportunities();

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

            const row = mapEnrichedLeadToRow(raw, user.id, orgId);
            toInsert.push(row);
            seen.add(k);
            added.push(mapRowToEnrichedLead(row));
        }

        if (toInsert.length > 0) {
            const { error } = await supabase.from(TABLE).insert(toInsert);
            if (error) {
                console.error('Error adding enriched opportunities:', error);
                return { addedCount: 0, duplicateCount: dups.length, added: [], duplicates: dups };
            }
        }

        return { addedCount: added.length, duplicateCount: dups.length, added, duplicates: dups };
    },
    removeById: async (id: string) => {
        const { error } = await supabase.from(TABLE).delete().eq('id', id);
        return { removed: !error, remaining: 0 }; // simplified return
    },
    isSaved: async (l: EnrichedLead) => {
        const all = await getEnrichedOpportunities();
        const keyOf = (l: EnrichedLead) => (l.id?.trim() || (l.email?.trim() || '') || `${l.fullName || ''}|${l.companyDomain || l.companyName || ''}|${l.title || ''}`).toLowerCase();
        return all.some(x => keyOf(x) === keyOf(l));
    },
    findEnrichedLeadById: findEnrichedLeadById
};
