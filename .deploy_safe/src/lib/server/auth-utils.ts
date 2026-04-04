import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export type AuthContext = {
    user: any;
    organizationId: string;
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
export async function requireAuth() {
    const supabase = createRouteHandlerClient({ cookies });

    // 1. Check Session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        throw new AuthError('Unauthorized', 401);
    }

    const user = session.user;

    // 2. Resolve Organization (Active or Primary)
    // First check metadata/cookies if we store active org there, otherwise query DB
    // For now, let's query the first organization they belong to.
    const { data: member, error: memberError } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

    if (memberError) {
        console.error('[Auth] Member query error:', memberError);
        throw new AuthError('Failed to verify organization membership', 500);
    }

    if (!member) {
        throw new AuthError('User does not belong to any organization', 403);
    }

    return {
        user,
        organizationId: member.organization_id,
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
