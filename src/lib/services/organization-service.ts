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
            .select(`
                *,
                profiles:user_id (
                    full_name,
                    email,
                    avatar_url
                )
            `)
            .eq('organization_id', orgId);

        if (membersError) {
            console.error('Error fetching members:', membersError);
            return { organization: org, members: [] };
        }

        return { organization: org, members: members || [] };
    },

    async createInvite(email: string, role: 'admin' | 'member' = 'member'): Promise<{ token: string } | null> {
        const orgId = await this.getCurrentOrganizationId();
        if (!orgId) return null;

        const token = crypto.randomUUID();

        const { error } = await supabase
            .from('organization_invites')
            .insert([{
                organization_id: orgId,
                email,
                role,
                token
            }]);

        if (error) {
            console.error('Error creating invite:', error);
            return null;
        }

        return { token };
    },

    async getInvites(): Promise<any[]> {
        const orgId = await this.getCurrentOrganizationId();
        if (!orgId) return [];

        const { data, error } = await supabase
            .from('organization_invites')
            .select('*')
            .eq('organization_id', orgId);

        if (error) {
            console.error('Error fetching invites:', error);
            return [];
        }

        return data || [];
    },

    async revokeInvite(inviteId: string): Promise<boolean> {
        const { error } = await supabase
            .from('organization_invites')
            .delete()
            .eq('id', inviteId);

        if (error) {
            console.error('Error revoking invite:', error);
            return false;
        }

        return true;
    },

    async acceptInvite(token: string): Promise<boolean> {
        const { data, error } = await supabase
            .rpc('accept_invite', { invite_token: token });

        if (error) {
            console.error('Error accepting invite:', error);
            throw error;
        }

        return !!data;
    },

    async leaveOrganization(orgId: string): Promise<boolean> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;

        const { error } = await supabase
            .from('organization_members')
            .delete()
            .eq('organization_id', orgId)
            .eq('user_id', user.id);

        if (error) {
            console.error('Error leaving organization:', error);
            return false;
        }
        return true;
    },

    async deleteOrganization(orgId: string): Promise<boolean> {
        // Only owners can delete (RLS enforced)
        const { error } = await supabase
            .from('organizations')
            .delete()
            .eq('id', orgId);

        if (error) {
            console.error('Error deleting organization:', error);
            return false;
        }
        return true;
    }
};
