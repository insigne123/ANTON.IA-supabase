import { supabase } from '@/lib/supabase';

export const organizationService = {
    async getCurrentOrganizationId(): Promise<string | null> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;

            // Get the first organization the user is a member of
            const { data, error } = await supabase
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', user.id)
                .limit(1)
                .single();

            if (error || !data) {
                return null;
            }

            return data.organization_id;
        } catch (error) {
            console.error('Error fetching organization ID:', error);
            return null;
        }
    },

    async createOrganization(name: string): Promise<string | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        // Use RPC to create org and add member atomically
        const { data, error } = await supabase
            .rpc('create_new_organization', { org_name: name });

        if (error) {
            console.error('Error creating organization:', error);
            return null;
        }

        return data; // Returns the new org ID
    },

    async getOrganizationDetails(): Promise<{ organization: any, members: any[] } | null> {
        const orgId = await this.getCurrentOrganizationId();
        if (!orgId) return null;

        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', orgId)
            .single();

        if (orgError) {
            console.error('Error fetching organization details:', orgError);
            return null;
        }

        const { data: members, error: membersError } = await supabase
            .from('organization_members')
            .select('*')
            .eq('organization_id', orgId);

        if (membersError) {
            console.error('Error fetching members:', membersError);
            return { organization: org, members: [] };
        }

        return { organization: org, members: members || [] };
    }
};
