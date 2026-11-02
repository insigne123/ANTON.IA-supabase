import { NextRequest, NextResponse } from 'next/server';
import { AdminDashboardAuthError } from '@/lib/server/admin-dashboard-auth';
import { AdminScopeError, memberName, periodBounds, readAdminFilters, scopeMemberIds } from '@/lib/server/admin-scope';
import { authorizedUsageScope, requireAdminUsageAccess } from '@/lib/server/admin-usage-auth';
import { loadMemberIdentities } from '@/lib/server/admin-member-identities';
import { CreditResultsError, readCreditResults } from '@/lib/server/credit-results';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

/**
 * «Qué se obtuvo con los créditos» for Administración (src/lib/credit-results.ts): the period's Apollo credits and what
 * happened with the people paid for, for the organization, one team or one person.
 */
export async function GET(req: NextRequest) {
  try {
    const access = await requireAdminUsageAccess(req);
    const params = req.nextUrl.searchParams;
    const organizationId = authorizedUsageScope(access, params.get('organizationId') || undefined);
    if (organizationId === 'all') return NextResponse.json({ error: 'Elige una empresa para ver qué se obtuvo con sus créditos.' }, { status: 400, headers });
    const filters = readAdminFilters(params);
    const userIds = await scopeMemberIds(access.supabase, organizationId, filters);

    const results = await readCreditResults(access.supabase, {
      organizationId,
      ...periodBounds(filters),
      userIds: filters.groupId || filters.userId ? userIds : null,
    });
    const identities = await loadMemberIdentities(access.supabase, results.people.map(person => person.userId));
    const users = new Map((identities.data?.users || []).map((user: any) => [String(user.id), user]));
    return NextResponse.json({
      from: filters.from, to: filters.to,
      totals: results.totals,
      people: results.people.map(person => ({ ...person, name: memberName(users.get(person.userId), 'Persona sin nombre') })),
    }, { headers });
  } catch (error) {
    if (error instanceof AdminDashboardAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof AdminScopeError || error instanceof CreditResultsError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.warn('[credit-results] unavailable');
    return NextResponse.json({ error: 'No pudimos leer qué se obtuvo con los créditos. Intenta nuevamente.' }, { status: 503, headers });
  }
}
