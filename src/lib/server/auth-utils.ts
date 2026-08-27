import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSupliaEnabled } from '@/lib/suplia/access';
import { resolveActiveOrganization, type OrganizationMembership } from '@/lib/server/organization-context';

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
export async function requireAuth(): Promise<AuthContext> {
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

export async function requireSupliaAuth() {
    if (!isSupliaEnabled()) {
        throw new AuthError('Not Found', 404);
    }

    return requireAuth();
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
