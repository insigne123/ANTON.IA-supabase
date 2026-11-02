import { daysBetween, dayStartInZone, lastDaysInZone, shiftDay } from '@/lib/admin/chile-time';

/**
 * The filters of «Uso y resultados» as its cards read them (credit-results and team-funnel routes): the period in Chile,
 * the team and the person, checked; and the organization's members they leave. The organization itself comes from
 * authorizedUsageScope (admin-usage-auth.ts), never from here.
 */
export class AdminScopeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AdminFilters = { from: string; to: string; groupId: string; userId: string };

/** The days asked for (the last 30 by default, up to 367), and the team and person when they are valid ids. */
export function readAdminFilters(params: URLSearchParams): AdminFilters {
  const defaults = lastDaysInZone(30);
  const from = DATE_RE.test(params.get('from') || '') ? params.get('from')! : defaults.from;
  const to = DATE_RE.test(params.get('to') || '') ? params.get('to')! : defaults.to;
  const span = daysBetween(from, to);
  if (!Number.isFinite(span) || span < 1 || span > 367) throw new AdminScopeError('El rango debe estar entre 1 y 367 días.');
  const groupId = String(params.get('groupId') || '').trim();
  const userId = String(params.get('userId') || '').trim();
  if ((groupId && !UUID_RE.test(groupId)) || (userId && !UUID_RE.test(userId))) throw new AdminScopeError('El filtro seleccionado no es válido.');
  return { from, to, groupId, userId };
}

/** The period as instants: from the first day's start to the start of the day after the last, in Chile. */
export function periodBounds(filters: Pick<AdminFilters, 'from' | 'to'>) {
  return { from: dayStartInZone(filters.from).toISOString(), to: dayStartInZone(shiftDay(filters.to, 1)).toISOString() };
}

/** The organization's members in the team (its current members) and the person asked for; everyone without filters. */
export async function scopeMemberIds(supabase: any, organizationId: string, filters: Pick<AdminFilters, 'groupId' | 'userId'>) {
  const members = await supabase.from('organization_members').select('user_id').eq('organization_id', organizationId);
  if (members.error) throw new AdminScopeError('No pudimos leer el equipo.', 503);
  let userIds: string[] = (members.data || []).map((row: any) => String(row.user_id));
  if (filters.groupId) {
    const assigned = await supabase.from('organization_reporting_group_members').select('user_id,unassigned_at')
      .eq('organization_id', organizationId).eq('group_id', filters.groupId);
    if (assigned.error) throw new AdminScopeError('No pudimos leer el equipo.', 503);
    const inGroup = new Set((assigned.data || []).filter((row: any) => !row.unassigned_at).map((row: any) => String(row.user_id)));
    userIds = userIds.filter(id => inGroup.has(id));
  }
  if (filters.userId) userIds = userIds.filter(id => id === filters.userId);
  return userIds;
}

/** A member's name from their account, or the fallback. */
export function memberName(user: any, fallback: string) {
  const metadata = user?.user_metadata || {};
  return String(metadata.full_name || metadata.name || metadata.display_name || String(user?.email || '').split('@')[0] || '').trim() || fallback;
}
