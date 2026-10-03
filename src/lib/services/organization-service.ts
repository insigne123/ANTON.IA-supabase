import { supabase } from '@/lib/supabase';

export type OrganizationRole = 'owner' | 'admin' | 'member';

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

// «Which organization am I in?» had 32 callers, each asking /api/organizations on its own: «Por escribir» sent it 9 times
// on load. Callers within LIST_TTL_MS share one request. Any write here (switch, create, rename, invite, leave, delete,
// members) forgets it, and a failed request is never shared.
const LIST_TTL_MS = 5_000;
let organizationList: { at: number; promise: Promise<OrganizationListResponse> } | null = null;

function forgetOrganizationList() {
    organizationList = null;
}

function notifyCurrentOrganizationChanged() {
    forgetOrganizationList();
    for (const listener of currentOrganizationListeners) listener();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const isWrite = Boolean(init?.method && init.method.toUpperCase() !== 'GET');
    try {
        const response = await fetch(path, {
            ...init,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...init?.headers },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Organization request failed');
        return payload as T;
    } finally {
        if (isWrite) forgetOrganizationList();
    }
}

export const organizationService = {
    subscribeToCurrentOrganizationChanges(listener: () => void) {
        currentOrganizationListeners.add(listener);
        return () => currentOrganizationListeners.delete(listener);
    },

    async listOrganizations(): Promise<OrganizationListResponse> {
        const now = Date.now();
        if (organizationList && now - organizationList.at < LIST_TTL_MS) return organizationList.promise;
        const entry = { at: now, promise: requestJson<OrganizationListResponse>('/api/organizations') };
        organizationList = entry;
        entry.promise.catch(() => {
            if (organizationList === entry) organizationList = null;
        });
        return entry.promise;
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

    async createInvite(email: string, role: 'admin' | 'member' = 'member', organizationId?: string | null) {
        const orgId = String(organizationId || '').trim() || await this.getCurrentOrganizationId();
        if (!orgId) return null;
        return requestJson<{ inviteUrl: string; expiresAt: string }>(
            `/api/organizations/${encodeURIComponent(orgId)}/invites`,
            { method: 'POST', body: JSON.stringify({ email, role }) },
        );
    },

    async getInvites(): Promise<any[]> {
        return (await this.getOrganizationDetails())?.invites || [];
    },

    async revokeInvite(inviteId: string, organizationId?: string): Promise<boolean> {
        const orgId = organizationId || await this.getCurrentOrganizationId();
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
