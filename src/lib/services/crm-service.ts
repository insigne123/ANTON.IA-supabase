import { supabase } from '@/lib/supabase';
import { UnifiedRow } from '@/lib/unified-sheet-types';
import { unifiedSheetService } from './unified-sheet-service';

export const crmService = {
    async getAllUnifiedRows(): Promise<UnifiedRow[]> {
        const rows: UnifiedRow[] = [];

        try {
            // 1. Fetch all sources in parallel
            const [
                { data: savedLeads },
                { data: enrichedLeads },
                { data: opportunities },
                customDataMap
            ] = await Promise.all([
                supabase.from('saved_leads').select('*'),
                supabase.from('enriched_leads').select('*'),
                supabase.from('enriched_opportunities').select('*'),
                unifiedSheetService.getAllCustom()
            ]);

            // 2. Normalize Saved Leads
            savedLeads?.forEach((l: any) => {
                const gid = `lead_saved|${l.id}`;
                const custom = customDataMap[gid] || {};
                rows.push({
                    gid,
                    sourceId: l.id,
                    kind: 'lead_saved',
                    status: 'saved', // Default status
                    name: l.full_name || (l.first_name ? l.first_name + ' ' + (l.last_name || '') : 'Sin nombre'),
                    email: l.email,
                    company: l.company_name || l.company,
                    title: l.title || l.job_title,
                    linkedinUrl: l.linkedin_url || l.linkedin,
                    stage: custom.stage || 'inbox',
                    owner: custom.owner,
                    notes: custom.notes,
                    updatedAt: l.created_at
                });
            });

            // 3. Normalize Enriched Leads
            enrichedLeads?.forEach((l: any) => {
                const gid = `enriched_lead|${l.id}`;
                const custom = customDataMap[gid] || {};
                rows.push({
                    gid,
                    sourceId: l.id,
                    kind: 'lead_enriched',
                    status: 'enriched', // Default status
                    name: l.full_name || 'Sin nombre',
                    email: l.email,
                    company: l.company_name,
                    title: l.title,
                    linkedinUrl: l.linkedin_url,
                    stage: custom.stage || 'inbox',
                    owner: custom.owner,
                    notes: custom.notes,
                    updatedAt: l.created_at
                });
            });

            // 4. Normalize Opportunities
            opportunities?.forEach((l: any) => {
                const gid = `enriched_opportunity|${l.id}`;
                const custom = customDataMap[gid] || {};
                rows.push({
                    gid,
                    sourceId: l.id,
                    kind: 'opportunity',
                    status: 'enriched', // Default status
                    name: l.title || 'Oportunidad',
                    email: null,
                    company: l.company_name,
                    title: 'Oportunidad',
                    linkedinUrl: l.job_url,
                    stage: custom.stage || 'inbox',
                    owner: custom.owner,
                    notes: custom.notes,
                    updatedAt: l.created_at
                });
            });

            // 5. Apply updated_at from custom data if available (unifiedSheetService.getAllCustom needs to return it? It currently only returns stage, owner, notes)
            // Let's assume the component will handle sorting or we rely on base date.

            return rows;

        } catch (err) {
            console.error('[crmService] Error fetching rows:', err);
            return [];
        }
    }
};
