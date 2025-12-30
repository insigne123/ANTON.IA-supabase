
import { supabase } from '@/lib/supabase';
import { organizationService } from './organization-service';

export interface ExcludedDomain {
    id: string;
    organization_id: string;
    domain: string;
    reason?: string;
    created_at: string;
}

export const domainService = {
    async getExcludedDomains(): Promise<ExcludedDomain[]> {
        const orgId = await organizationService.getCurrentOrganizationId();
        if (!orgId) return [];

        const { data, error } = await supabase
            .from('excluded_domains')
            .select('*')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching excluded domains:', error);
            return [];
        }
        return data as ExcludedDomain[];
    },

    async addDomain(domain: string, reason?: string) {
        const orgId = await organizationService.getCurrentOrganizationId();
        if (!orgId) throw new Error('No Organization ID found');

        // Normalize domain
        const cleanDomain = domain.toLowerCase().trim().replace('@', '');

        const { error } = await supabase
            .from('excluded_domains')
            .insert({
                organization_id: orgId,
                domain: cleanDomain,
                reason
            });

        if (error) throw error;
    },

    async removeDomain(id: string) {
        const { error } = await supabase
            .from('excluded_domains')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
};
