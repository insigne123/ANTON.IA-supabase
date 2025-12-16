import { supabase } from '../supabase';
import type { EnrichedLead } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { organizationService } from './organization-service';

const TABLE = 'enriched_leads';

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
        phoneNumbers: row.phone_numbers,
        primaryPhone: row.primary_phone,
    };
}

function mapEnrichedLeadToRow(lead: EnrichedLead, userId: string, organizationId: string | null) {
    // Validate UUID or generate one if missing/invalid
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
    const { data: { user } } = await supabase.auth.getUser();
    console.log('[enriched-leads] get: user', user?.id);

    const orgId = await organizationService.getCurrentOrganizationId();
    console.log('[enriched-leads] get: orgId', orgId);

    let query = supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false });

    if (orgId) {
        // Allow seeing enriched leads for the current org OR personal (null org_id)
        query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching enriched leads:', error);
        return [];
    }
    console.log('[enriched-leads] get: found', data?.length, 'rows');

    return (data || []).map(mapRowToEnrichedLead);
}

export async function setEnrichedLeads(items: EnrichedLead[]) {
    console.warn('setEnrichedLeads is not fully supported in cloud mode. Use add/remove methods.');
}

export async function addEnrichedLeads(items: EnrichedLead[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const orgId = await organizationService.getCurrentOrganizationId();

    const existing = await getEnrichedLeads();
    const key = (v: EnrichedLead) => (v.id || v.email || `${v.fullName}|${v.companyName}|${v.title}`).toLowerCase();
    const seen = new Set(existing.map(key));

    const toInsert: any[] = [];

    for (const item of items) {
        const k = key(item);
        if (!seen.has(k)) {
            toInsert.push(mapEnrichedLeadToRow(item, user.id, orgId));
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
        console.log('[enriched-leads] DB URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (!user) {
            console.error('[enriched-leads] addDedup: No user found', userError);
            return { addedCount: 0, duplicateCount: 0, added: [], duplicates: [] };
        }
        console.log('[enriched-leads] addDedup: user', user.id);

        const orgId = await organizationService.getCurrentOrganizationId();

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
            const row = mapEnrichedLeadToRow(raw, user.id, orgId);
            toInsert.push(row);

            // Add to local tracking
            seen.add(k);
            added.push(mapRowToEnrichedLead(row)); // Approximate return value
        }

        if (toInsert.length > 0) {
            const { data: inserted, error } = await supabase.from(TABLE).insert(toInsert).select();
            if (error) {
                console.error('Error adding enriched leads:', error);
                return { addedCount: 0, duplicateCount: dups.length, added: [], duplicates: dups };
            }
            console.log('[enriched-leads] addDedup: actual inserted', inserted?.length, inserted);

            // Update 'added' with actual returned data to be sure
            if (inserted && inserted.length > 0) {
                added.length = 0; // Clear optimistic
                inserted.forEach(r => added.push(mapRowToEnrichedLead(r)));
            } else {
                // If success but no data returned, something is wrong (RLS blocking view?)
                console.warn('[enriched-leads] addDedup: success but no data returned. RLS blocking select?');
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
    update: async (leads: EnrichedLead[]) => {
        // Prepare updates. Since we might have partial data, we should be careful.
        // For enrichment, we want to update phone/email if provided.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const orgId = await organizationService.getCurrentOrganizationId();

        for (const l of leads) {
            const row = mapEnrichedLeadToRow(l, user.id, orgId);
            // Use upsert or update. Since ID exists, update is safer if we want to preserve other fields?
            // Actually, mapEnrichedLeadToRow overwrites everything with what's in 'l'. 
            // If 'l' comes from API and is "partial" (e.g. missing some local data), we might lose data.
            // BUT, the client flow is: load existing -> send to API -> get merged result -> save.
            // Client.tsx: `handleConfirmEnrich` sends a minimal payload, but receives `newEnriched`.
            // If `newEnriched` is fully hydrated (merged with previous state), we can overwrite.
            // The API `enrich-apollo` returns a NEW object with `id: uuid()`. Wait.
            // If API returns NEW ID, `addDedup` treats it as new? 
            // In `Client.tsx`, we pass `clientRef: l.id`. The API returns `clientRef` in the object.
            // We should use that to match and update the EXISTING ID.

            // Let's implement a smart upsert that uses `clientRef` as ID if present.
            const finalId = (l as any).clientRef || l.id;
            const updateData: any = { ...row, id: finalId };

            // Remove fields that shouldn't be nulled if undefined in 'l' (if we were doing partial).
            // But for now, let's assume `addDedup` is for NEW, and `update` is for existing.
            // We'll use `upsert` on the specific ID.
            const { error } = await supabase.from(TABLE).upsert(updateData);
            if (error) console.error('Error updating lead:', finalId, error);
        }
    },
    removeWhere: removeWhere,
    findEnrichedLeadById: findEnrichedLeadById,
};

export async function updateEnrichedLead(id: string, updates: Partial<EnrichedLead>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No session');

    const mappedUpdates: any = {};
    if (updates.phoneNumbers !== undefined) mappedUpdates.phone_numbers = updates.phoneNumbers;
    if (updates.primaryPhone !== undefined) mappedUpdates.primary_phone = updates.primaryPhone;

    if (Object.keys(mappedUpdates).length === 0) return;

    const { error } = await supabase
        .from(TABLE)
        .update(mappedUpdates)
        .eq('id', id);

    if (error) {
        console.error('Error updating enriched lead:', error);
        throw error;
    }
}
