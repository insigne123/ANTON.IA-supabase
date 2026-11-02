import { NextRequest, NextResponse } from 'next/server';
import { daysBetween, dayStartInZone, lastDaysInZone, shiftDay } from '@/lib/admin/chile-time';
import { AdminDashboardAuthError } from '@/lib/server/admin-dashboard-auth';
import { authorizedUsageScope, requireAdminUsageAccess } from '@/lib/server/admin-usage-auth';
import { loadMemberIdentities } from '@/lib/server/admin-member-identities';
import { CreditResultsError, readCreditResults } from '@/lib/server/credit-results';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store' };

const displayName = (user: any, fallback: string) => {
  const metadata = user?.user_metadata || {};
  return String(metadata.full_name || metadata.name || metadata.display_name || String(user?.email || '').split('@')[0] || '').trim() || fallback;
};

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
    const defaults = lastDaysInZone(30);
    const from = DATE_RE.test(params.get('from') || '') ? params.get('from')! : defaults.from;
    const to = DATE_RE.test(params.get('to') || '') ? params.get('to')! : defaults.to;
    const span = daysBetween(from, to);
    if (!Number.isFinite(span) || span < 1 || span > 367) return NextResponse.json({ error: 'El rango debe estar entre 1 y 367 días.' }, { status: 400, headers });
    const groupId = String(params.get('groupId') || '').trim();
    const userId = String(params.get('userId') || '').trim();
    if ((groupId && !UUID_RE.test(groupId)) || (userId && !UUID_RE.test(userId))) return NextResponse.json({ error: 'El filtro seleccionado no es válido.' }, { status: 400, headers });

    const members = await access.supabase.from('organization_members').select('user_id').eq('organization_id', organizationId);
    if (members.error) throw new CreditResultsError('No pudimos leer el equipo.');
    let userIds: string[] = (members.data || []).map((row: any) => String(row.user_id));
    if (groupId) {
      const assigned = await access.supabase.from('organization_reporting_group_members').select('user_id,unassigned_at')
        .eq('organization_id', organizationId).eq('group_id', groupId);
      if (assigned.error) throw new CreditResultsError('No pudimos leer el equipo.');
      const inGroup = new Set((assigned.data || []).filter((row: any) => !row.unassigned_at).map((row: any) => String(row.user_id)));
      userIds = userIds.filter(id => inGroup.has(id));
    }
    if (userId) userIds = userIds.filter(id => id === userId);

    const results = await readCreditResults(access.supabase, {
      organizationId,
      from: dayStartInZone(from).toISOString(),
      to: dayStartInZone(shiftDay(to, 1)).toISOString(),
      userIds: groupId || userId ? userIds : null,
    });
    const identities = await loadMemberIdentities(access.supabase, results.people.map(person => person.userId));
    const users = new Map((identities.data?.users || []).map((user: any) => [String(user.id), user]));
    return NextResponse.json({
      from, to,
      totals: results.totals,
      people: results.people.map(person => ({ ...person, name: displayName(users.get(person.userId), 'Persona sin nombre') })),
    }, { headers });
  } catch (error) {
    if (error instanceof AdminDashboardAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof CreditResultsError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.warn('[credit-results] unavailable');
    return NextResponse.json({ error: 'No pudimos leer qué se obtuvo con los créditos. Intenta nuevamente.' }, { status: 503, headers });
  }
}
