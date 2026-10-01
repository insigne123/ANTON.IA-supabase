import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { readTeamLocks } from '@/lib/server/team-locks';

export const dynamic = 'force-dynamic';

const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 200) : [];

/** Who in the team holds each of these people (Plan 5, PR-9b): by email, provider id or LinkedIn. Read only. */
export async function POST(req: NextRequest) {
  try {
    const { user, organizationId, supabase } = await requireAuth();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new AuthError('Pedido inválido', 400);
    const locks = await readTeamLocks(supabase as any, { userId: user.id, organizationId }, {
      emails: list(body.emails), providerIds: list(body.providerIds), linkedinUrls: list(body.linkedinUrls),
    });
    return NextResponse.json(locks, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleAuthError(error); }
}
