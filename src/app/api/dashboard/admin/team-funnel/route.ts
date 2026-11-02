import { NextRequest, NextResponse } from 'next/server';
import { AdminDashboardAuthError } from '@/lib/server/admin-dashboard-auth';
import { AdminScopeError, memberName, periodBounds, readAdminFilters, scopeMemberIds } from '@/lib/server/admin-scope';
import { authorizedUsageScope, requireAdminUsageAccess } from '@/lib/server/admin-usage-auth';
import { loadMemberIdentities } from '@/lib/server/admin-member-identities';
import { TeamFunnelError, readTeamFunnel } from '@/lib/server/team-funnel';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

/**
 * «El trabajo, paso a paso» for Administración (src/lib/team-funnel.ts): the period's steps, from saving a contact to a
 * conversation, for the organization, one team or one person, each member listed.
 */
export async function GET(req: NextRequest) {
  try {
    const access = await requireAdminUsageAccess(req);
    const params = req.nextUrl.searchParams;
    const organizationId = authorizedUsageScope(access, params.get('organizationId') || undefined);
    if (organizationId === 'all') return NextResponse.json({ error: 'Elige una empresa para ver el trabajo de su equipo.' }, { status: 400, headers });
    const filters = readAdminFilters(params);
    const userIds = await scopeMemberIds(access.supabase, organizationId, filters);
    const funnel = await readTeamFunnel(access.supabase, { organizationId, ...periodBounds(filters), userIds });
    const identities = await loadMemberIdentities(access.supabase, funnel.people.map(person => person.userId));
    const users = new Map((identities.data?.users || []).map((user: any) => [String(user.id), user]));
    return NextResponse.json({
      from: filters.from, to: filters.to,
      total: funnel.total,
      people: funnel.people.map(person => ({ ...person, name: memberName(users.get(person.userId), 'Persona sin nombre') })),
    }, { headers });
  } catch (error) {
    if (error instanceof AdminDashboardAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof AdminScopeError || error instanceof TeamFunnelError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.warn('[team-funnel] unavailable');
    return NextResponse.json({ error: 'No pudimos leer el trabajo del equipo. Intenta nuevamente.' }, { status: 503, headers });
  }
}
