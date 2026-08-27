import { supabase } from '@/lib/supabase';

type OrganizationRole = 'owner' | 'admin' | 'member';

export type OrganizationListResponse = {
    activeOrganizationId: string | null;
    organizations: Array<{
        id: string;
        name: string;
        role: OrganizationRole;
        memberCount: number;
    }>;
};

export type OrganizationDetailsResponse = {
    organization: any;
    members: any[];
    invites: any[];
    currentUserRole: OrganizationRole;
};

const currentOrganizationListeners = new Set<() => void>();

function notifyCurrentOrganizationChanged() {
    for (const listener of currentOrganizationListeners) listener();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Organization request failed');
    return payload as T;
}

export const organizationService = {
    subscribeToCurrentOrganizationChanges(listener: () => void) {
        currentOrganizationListeners.add(listener);
        return () => currentOrganizationListeners.delete(listener);
    },

    async listOrganizations(): Promise<OrganizationListResponse> {
        return requestJson<OrganizationListResponse>('/api/organizations');
    },

    async getCurrentOrganizationId(_knownUserId?: string | null): Promise<string | null> {
        try {
            return (await this.listOrganizations()).activeOrganizationId;
        } catch (error) {
            console.error('Error fetching organization ID:', error);
            return null;
        }
    },

    async setCurrentOrganization(organizationId: string): Promise<boolean> {
        await requestJson('/api/organizations/active', {
            method: 'PUT',
            body: JSON.stringify({ organizationId }),
        });
        notifyCurrentOrganizationChanged();
        return true;
    },

    async createOrganization(name: string): Promise<string | null> {
        const result = await requestJson<{ organizationId: string }>('/api/organizations', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
        notifyCurrentOrganizationChanged();
        return result.organizationId;
    },

    async updateOrganization(orgId: string, updates: { name: string }): Promise<boolean> {
        await requestJson(`/api/organizations/${encodeURIComponent(orgId)}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
        return true;
    },

    async getCredits(): Promise<{ credits: number, enabled: boolean, source?: 'organization' } | null> {
        const orgId = await this.getCurrentOrganizationId();
        if (!orgId) return null;

        const { data, error } = await supabase
            .from('organizations')
            .select('social_search_credits, feature_social_search_enabled')
            .eq('id', orgId)
            .single();
        if (error) {
            console.error('Error fetching credits:', error);
            return null;
        }
        return {
            credits: Number(data.social_search_credits ?? 0),
            enabled: Boolean(data.feature_social_search_enabled),
            source: 'organization',
        };
    },

    async getOrganizationDetails(organizationId?: string | null): Promise<OrganizationDetailsResponse | null> {
        const orgId = String(organizationId || '').trim() || await this.getCurrentOrganizationId();
        if (!orgId) return null;
        return requestJson<OrganizationDetailsResponse>(`/api/organizations/${encodeURIComponent(orgId)}`);
    },

    async createInvite(email: string, role: 'admin' | 'member' = 'member') {
        const orgId = await this.getCurrentOrganizationId();
        if (!orgId) return null;
        return requestJson<{ inviteUrl: string; expiresAt: string }>(
            `/api/organizations/${encodeURIComponent(orgId)}/invites`,
            { method: 'POST', body: JSON.stringify({ email, role }) },
        );
    },

    async getInvites(): Promise<any[]> {
        return (await this.getOrganizationDetails())?.invites || [];
    },

    async revokeInvite(inviteId: string): Promise<boolean> {
        const orgId = await this.getCurrentOrganizationId();
        if (!orgId) return false;
        await requestJson(`/api/organizations/${encodeURIComponent(orgId)}/invites/${encodeURIComponent(inviteId)}`, {
            method: 'DELETE',
        });
        return true;
    },

    async acceptInvite(token: string): Promise<boolean> {
        await requestJson('/api/organizations/invites/accept', {
            method: 'POST',
            body: JSON.stringify({ token }),
        });
        notifyCurrentOrganizationChanged();
        return true;
    },

    async leaveOrganization(orgId: string): Promise<boolean> {
        await requestJson(`/api/organizations/${encodeURIComponent(orgId)}/leave`, { method: 'POST' });
        notifyCurrentOrganizationChanged();
        return true;
    },

    async deleteOrganization(orgId: string): Promise<boolean> {
        await requestJson(`/api/organizations/${encodeURIComponent(orgId)}`, { method: 'DELETE' });
        notifyCurrentOrganizationChanged();
        return true;
    },

    async updateMemberRole(orgId: string, userId: string, role: OrganizationRole): Promise<boolean> {
        await requestJson(`/api/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ role }),
        });
        return true;
    },

    async removeMember(orgId: string, userId: string): Promise<boolean> {
        await requestJson(`/api/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`, {
            method: 'DELETE',
        });
        return true;
    },
};
