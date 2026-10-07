import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { resolveActiveOrganization, type OrganizationMembership } from '@/lib/server/organization-context';
import { requireSessionRequestAuth, RequestAuthError } from '@/lib/server/request-auth';

export type AuthContext = {
    user: any;
    organizationId: string;
    organizationIds: string[];
    organizationRole?: OrganizationMembership['role'];
    memberships?: OrganizationMembership[];
    supabase: any;
};

/**
 * Validates that a user is authenticated and belongs to an organization.
 * Returns the user, organizationId, and the supabase client.
 * If validation fails, throws an error that should be caught by the route handler,
 * or returns null (if we change design). 
 * 
 * Recommended usage:
 * try {
 *   const { user, organizationId } = await requireAuth(req);
 * } catch (e) {
 *   return handleAuthError(e);
 * }
 */
export async function requireAuth(request?: Request): Promise<AuthContext> {
    if (request?.headers.has('authorization')) {
        try {
            const session = await requireSessionRequestAuth(request);
            const resolved = await resolveActiveOrganization(session.supabase, session.user.id);
            if (!resolved.active) throw new AuthError('User does not belong to any organization', 403);
            return { user: session.user, organizationId: resolved.active.organizationId,
                organizationIds: resolved.memberships.map(membership => membership.organizationId), organizationRole: resolved.active.role,
                memberships: resolved.memberships, supabase: session.supabase };
        } catch (error) {
            if (error instanceof AuthError) throw error;
            if (error instanceof RequestAuthError) throw new AuthError(error.message, error.status);
            throw new AuthError('Failed to verify organization membership', 500);
        }
    }
    const supabase = createRouteHandlerClient({ cookies });

    // Verify the cookie-backed token with Supabase Auth before trusting its user.
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
        throw new AuthError('Unauthorized', 401);
    }

    let resolved;
    try {
        resolved = await resolveActiveOrganization(supabase, user.id);
    } catch (error) {
        console.error('[Auth] Member query error:', error);
        throw new AuthError('Failed to verify organization membership', 500);
    }

    if (!resolved.active) {
        throw new AuthError('User does not belong to any organization', 403);
    }

    const organizationIds = resolved.memberships.map((membership) => membership.organizationId);

    return {
        user,
        organizationId: resolved.active.organizationId,
        organizationIds,
        organizationRole: resolved.active.role,
        memberships: resolved.memberships,
        supabase
    };
}

export class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = 'AuthError';
    }
}

export function handleAuthError(error: any) {
    if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[API] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
