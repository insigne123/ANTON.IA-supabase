import { supabase } from '../supabase';
import type { JobOpportunity } from '../types';
import { v4 as uuidv4 } from 'uuid';

const TABLE = 'opportunities';

function mapRowToOpportunity(row: any): JobOpportunity {
    return {
        id: row.id,
        title: row.title,
        companyName: row.company_name,
        jobUrl: row.job_url,
        // Map other fields from data jsonb
        companyLinkedinUrl: row.data?.companyLinkedinUrl,
        companyDomain: row.data?.companyDomain,
        location: row.data?.location,
        publishedAt: row.data?.publishedAt,
        postedTime: row.data?.postedTime,
        applyUrl: row.data?.applyUrl,
        descriptionSnippet: row.data?.descriptionSnippet,
        workType: row.data?.workType,
        contractType: row.data?.contractType,
        experienceLevel: row.data?.experienceLevel,
        source: row.data?.source,
    };
}

function mapOpportunityToRow(opp: JobOpportunity, userId: string) {
    // Validate UUID or generate one if missing/invalid
    // Note: Opportunities from scrapers might have non-UUID IDs. We should probably use the scraper ID if it's a UUID, or generate a new one and store the scraper ID in data?
    // Or just use the scraper ID as the PK if it's unique enough?
    // The table definition uses `id text`, so we can store non-UUIDs if we want.
    // However, `saved-opportunities-storage.ts` generates a key based on content if ID is missing.

    const id = opp.id || uuidv4();

    return {
        id,
        user_id: userId,
        title: opp.title,
        company_name: opp.companyName,
        job_url: opp.jobUrl,
        status: 'saved', // Default status
        created_at: new Date().toISOString(),
        data: {
            companyLinkedinUrl: opp.companyLinkedinUrl,
            companyDomain: opp.companyDomain,
            location: opp.location,
            publishedAt: opp.publishedAt,
            postedTime: opp.postedTime,
            applyUrl: opp.applyUrl,
            descriptionSnippet: opp.descriptionSnippet,
            workType: opp.workType,
            contractType: opp.contractType,
            experienceLevel: opp.experienceLevel,
            source: opp.source,
        },
    };
}

export async function getOpps(): Promise<JobOpportunity[]> {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching opportunities:', error);
        return [];
    }

    return (data || []).map(mapRowToOpportunity);
}

export async function setOpps(opps: JobOpportunity[]) {
    console.warn('setOpps is not fully supported in cloud mode. Use add/remove methods.');
}

export const savedOpportunitiesStorage = {
    get: getOpps,
    set: setOpps,

    addDedup: async (oppsToAdd: JobOpportunity[]) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { addedCount: 0, duplicateCount: 0, added: [], duplicates: [] };

        const existing = await getOpps();

        // Logic from saved-opportunities-storage.ts
        const oppKey = (o: JobOpportunity) => {
            const base = o.id?.trim()
                || `${o.companyName || ''}|${o.title || ''}|${o.location || ''}|${o.jobUrl || ''}`;
            return base.toLowerCase();
        };

        const seen = new Set(existing.map(oppKey));
        const added: JobOpportunity[] = [];
        const duplicates: JobOpportunity[] = [];
        const toInsert: any[] = [];

        for (const o of oppsToAdd) {
            const k = oppKey(o);
            if (seen.has(k)) {
                duplicates.push(o);
            } else {
                // Prepare for insert
                const row = mapOpportunityToRow(o, user.id);
                toInsert.push(row);

                seen.add(k);
                added.push(mapRowToOpportunity(row));
            }
        }

        if (toInsert.length > 0) {
            const { error } = await supabase.from(TABLE).insert(toInsert);
            if (error) {
                console.error('Error adding opportunities:', error);
                return { addedCount: 0, duplicateCount: duplicates.length, added: [], duplicates };
            }
        }

        return {
            addedCount: added.length,
            duplicateCount: duplicates.length,
            added,
            duplicates,
        };
    },

    isSaved: async (o: JobOpportunity) => {
        const saved = await getOpps();
        const oppKey = (item: JobOpportunity) => {
            const base = item.id?.trim()
                || `${item.companyName || ''}|${item.title || ''}|${item.location || ''}|${item.jobUrl || ''}`;
            return base.toLowerCase();
        };
        const k = oppKey(o);
        return saved.some(s => oppKey(s) === k);
    },

    // Add remove method if needed, though original storage didn't export it explicitly in the object?
    // Wait, original `saved-opportunities-storage.ts` exported `savedOpportunitiesStorage` with `get`, `set`, `addDedup`, `isSaved`.
    // It didn't have `remove`.
    // But `Client.tsx` might need it?
    // Let's check `src/app/(app)/opportunities/page.tsx` to see if it removes opportunities.
};
