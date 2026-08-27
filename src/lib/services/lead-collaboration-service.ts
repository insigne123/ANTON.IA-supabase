'use client';

export type OrganizationMemberRole = 'owner' | 'admin' | 'member';

export type LeadContactState = 'uncontacted' | 'reserved' | 'contacted' | 'replied' | 'suppressed';
export type ContactThreadStatus = 'available' | 'reserved' | 'active' | 'closed' | 'suppressed';

export interface CollaborationProfile {
    full_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
}

export interface CollaborationMember {
    user_id: string;
    role: OrganizationMemberRole;
    profiles?: CollaborationProfile | CollaborationProfile[] | null;
}

export interface LeadCollaboration {
    lead_id: string;
    organization_id: string;
    discovered_by_user_id: string | null;
    discovered_at: string;
    assigned_to_user_id: string | null;
    assigned_at: string | null;
    assigned_by_user_id: string | null;
    claimed_by_user_id: string | null;
    claim_expires_at: string | null;
    contact_state: LeadContactState;
    created_at: string;
    updated_at: string;
}

export interface ContactThread {
    id: string;
    organization_id: string;
    channel: 'email' | 'linkedin';
    recipient_key: string;
    recipient_email: string | null;
    status: ContactThreadStatus;
    active_lead_id: string | null;
    active_campaign_id: string | null;
    opened_by_user_id: string | null;
    last_sent_by_user_id: string | null;
    root_dispatch_id: string | null;
    reserved_dispatch_id: string | null;
    reservation_expires_at: string | null;
    first_contacted_at: string | null;
    last_contacted_at: string | null;
    closed_at: string | null;
    reopened_at: string | null;
    reopened_by_user_id: string | null;
    reopen_reason: string | null;
    created_at: string;
    updated_at: string;
}

export interface LeadCollaborationPermissions {
    canAssign: boolean;
    canClaim: boolean;
    canReleaseClaim: boolean;
    canReopen: boolean;
}

export function isCollaborationUnavailable(error: unknown) {
    return error instanceof LeadCollaborationServiceError
        && error.status === 404
        && error.message === 'Organization collaboration is not enabled';
}

export interface LeadCollaborationResult {
    collaboration: LeadCollaboration | null;
    members: CollaborationMember[];
    contactThread: ContactThread | null;
    permissions: LeadCollaborationPermissions;
}

export interface LeadIdentifier {
    id?: unknown;
    leadId?: unknown;
    lead_id?: unknown;
    sourceId?: unknown;
    gid?: unknown;
}

type CollaborationListener = (result: LeadCollaborationResult) => void;
type BatchResult = Omit<LeadCollaborationResult, 'members'>;
type BatchQueueEntry = {
    resolve: (result: LeadCollaborationResult) => void;
    reject: (error: unknown) => void;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { result: LeadCollaborationResult; expiresAt: number }>();
const inFlight = new Map<string, Promise<LeadCollaborationResult>>();
const listeners = new Map<string, Set<CollaborationListener>>();
const requestVersions = new Map<string, number>();
const batchQueues = new Map<string, Map<string, BatchQueueEntry[]>>();
const scheduledOrganizations = new Set<string>();

export class LeadCollaborationServiceError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'LeadCollaborationServiceError';
    }
}

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export function resolveLeadUuid(lead: LeadIdentifier | null | undefined): string | null {
    if (!lead) return null;

    const directCandidates = [lead.id, lead.leadId, lead.lead_id, lead.sourceId];
    for (const candidate of directCandidates) {
        if (isUuid(candidate)) return candidate.trim();
    }

    if (typeof lead.gid === 'string') {
        const gidCandidate = lead.gid.split('|').pop();
        if (isUuid(gidCandidate)) return gidCandidate.trim();
    }

    return null;
}

export function profileForCollaborationMember(member: CollaborationMember | undefined) {
    if (!member) return null;
    return Array.isArray(member.profiles) ? member.profiles[0] || null : member.profiles || null;
}

export function collaborationMemberName(
    members: CollaborationMember[],
    userId: string | null | undefined,
    currentUserId?: string | null,
) {
    if (!userId) return 'Sin registro';
    const member = members.find((item) => item.user_id === userId);
    const profile = profileForCollaborationMember(member);
    const name = profile?.full_name?.trim() || profile?.email?.trim() || 'Miembro del equipo';
    return userId === currentUserId ? `${name} (tú)` : name;
}

export function isLeadClaimActive(collaboration: LeadCollaboration | null, now = Date.now()) {
    if (!collaboration?.claimed_by_user_id || !collaboration.claim_expires_at) return false;
    const expiresAt = new Date(collaboration.claim_expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
}

export function isContactThreadActive(contactThread: ContactThread | null) {
    return contactThread?.status === 'active' || contactThread?.status === 'reserved';
}

export function contactThreadConflictsWithLead(
    contactThread: ContactThread | null,
    leadId: string,
    currentUserId?: string | null,
) {
    if (!isContactThreadActive(contactThread)) return false;
    const threadOwnerId = contactThread?.opened_by_user_id || contactThread?.last_sent_by_user_id;
    return contactThread?.active_lead_id !== leadId
        || Boolean(currentUserId && threadOwnerId && threadOwnerId !== currentUserId);
}

function collaborationKey(organizationId: string, leadId: string) {
    return `${organizationId}:${leadId}`;
}

function collaborationPath(organizationId: string, leadId: string) {
    return `/api/organizations/${encodeURIComponent(organizationId)}/leads/${encodeURIComponent(leadId)}/collaboration`;
}

function collaborationBatchPath(organizationId: string) {
    return `/api/organizations/${encodeURIComponent(organizationId)}/leads/collaboration`;
}

function publish(key: string, result: LeadCollaborationResult) {
    listeners.get(key)?.forEach((listener) => listener(result));
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Lead collaboration request failed';
        throw new LeadCollaborationServiceError(message, response.status);
    }
    return payload as T;
}

async function flushBatch(organizationId: string) {
    scheduledOrganizations.delete(organizationId);
    const queue = batchQueues.get(organizationId);
    if (!queue) return;
    batchQueues.delete(organizationId);

    const entries = [...queue.entries()];
    for (let offset = 0; offset < entries.length; offset += 100) {
        const chunk = entries.slice(offset, offset + 100);
        try {
            const response = await requestJson<{
                members: CollaborationMember[];
                results: Record<string, BatchResult>;
            }>(collaborationBatchPath(organizationId), {
                method: 'POST',
                body: JSON.stringify({ leadIds: chunk.map(([leadId]) => leadId) }),
            });
            for (const [leadId, requests] of chunk) {
                const result = response.results[leadId];
                if (!result) {
                    const error = new LeadCollaborationServiceError('Lead collaboration not found', 404);
                    requests.forEach(({ reject }) => reject(error));
                    continue;
                }
                const complete = { ...result, members: response.members };
                requests.forEach(({ resolve }) => resolve(complete));
            }
        } catch (error) {
            for (const [, requests] of chunk) requests.forEach(({ reject }) => reject(error));
        }
    }
}

function enqueueBatch(organizationId: string, leadId: string) {
    return new Promise<LeadCollaborationResult>((resolve, reject) => {
        const queue = batchQueues.get(organizationId) || new Map<string, BatchQueueEntry[]>();
        const requests = queue.get(leadId) || [];
        requests.push({ resolve, reject });
        queue.set(leadId, requests);
        batchQueues.set(organizationId, queue);
        if (!scheduledOrganizations.has(organizationId)) {
            scheduledOrganizations.add(organizationId);
            window.setTimeout(() => void flushBatch(organizationId), 0);
        }
    });
}

async function refreshAfterMutation(organizationId: string, leadId: string) {
    cache.delete(collaborationKey(organizationId, leadId));
    return leadCollaborationService.getCollaboration(organizationId, leadId, { force: true });
}

export const leadCollaborationService = {
    async getCollaboration(
        organizationId: string,
        leadId: string,
        options: { force?: boolean } = {},
    ): Promise<LeadCollaborationResult> {
        const key = collaborationKey(organizationId, leadId);
        const cached = cache.get(key);
        if (!options.force && cached && cached.expiresAt > Date.now()) return cached.result;
        if (cached) cache.delete(key);

        const pending = inFlight.get(key);
        if (!options.force && pending) return pending;

        const version = (requestVersions.get(key) || 0) + 1;
        requestVersions.set(key, version);
        const request = options.force
            ? requestJson<LeadCollaborationResult>(collaborationPath(organizationId, leadId))
            : enqueueBatch(organizationId, leadId);
        inFlight.set(key, request);

        try {
            const result = await request;
            if (requestVersions.get(key) === version) {
                cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
                publish(key, result);
            }
            return result;
        } finally {
            if (inFlight.get(key) === request) inFlight.delete(key);
        }
    },

    subscribe(organizationId: string, leadId: string, listener: CollaborationListener) {
        const key = collaborationKey(organizationId, leadId);
        const currentListeners = listeners.get(key) || new Set<CollaborationListener>();
        currentListeners.add(listener);
        listeners.set(key, currentListeners);
        return () => {
            currentListeners.delete(listener);
            if (currentListeners.size === 0) listeners.delete(key);
        };
    },

    async assign(organizationId: string, leadId: string, assignedToUserId: string) {
        await requestJson(collaborationPath(organizationId, leadId), {
            method: 'PUT',
            body: JSON.stringify({ assignedToUserId }),
        });
        return refreshAfterMutation(organizationId, leadId);
    },

    async claim(organizationId: string, leadId: string, minutes = 15) {
        await requestJson(collaborationPath(organizationId, leadId), {
            method: 'POST',
            body: JSON.stringify({ action: 'claim', minutes }),
        });
        return refreshAfterMutation(organizationId, leadId);
    },

    async releaseClaim(organizationId: string, leadId: string) {
        await requestJson(collaborationPath(organizationId, leadId), { method: 'DELETE' });
        return refreshAfterMutation(organizationId, leadId);
    },

    async reopen(organizationId: string, leadId: string, contactThreadId: string, reason: string) {
        await requestJson(collaborationPath(organizationId, leadId), {
            method: 'POST',
            body: JSON.stringify({ action: 'reopen', contactThreadId, reason: reason.trim() }),
        });
        return refreshAfterMutation(organizationId, leadId);
    },
};
