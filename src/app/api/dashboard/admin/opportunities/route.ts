import { NextRequest, NextResponse } from 'next/server';

import { isOpportunitiesUserAllowed } from '@/lib/commercial-opportunities/access';
import { adminDashboardAuthErrorResponse, requireAdminDashboardAccess } from '@/lib/server/admin-dashboard-auth';
import {
  opportunitiesGrantedUserIds, opportunitiesGrantsAvailable, setOpportunitiesGrant,
} from '@/lib/server/commercial-opportunities/grants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { 'Cache-Control': 'private, no-store' };

type Supabase = Awaited<ReturnType<typeof requireAdminDashboardAccess>>['supabase'];

async function memberIds(supabase: Supabase, organizationId: string) {
  const { data, error } = await supabase.from('organization_members').select('user_id').eq('organization_id', organizationId);
  if (error) throw error;
  return [...new Set(((data || []) as Array<{ user_id: string }>).map(row => row.user_id).filter(Boolean))];
}

/**
 * Who may open «Oportunidades» in the admin's organization (Plan 15): the members an owner or admin let in, and the ones
 * that come from ANTON.IA's own list (OPPORTUNITIES_ALLOWED_EMAILS), which this panel shows but cannot remove. Only ids of
 * this organization's members leave the server, never the list itself. `available: false` until the table exists.
 */
export async function GET() {
  try {
    const auth = await requireAdminDashboardAccess();
    if (!(await opportunitiesGrantsAvailable(auth.supabase))) return NextResponse.json({ available: false, granted: [], listed: [] }, { headers: noStore });
    const [ids, granted] = await Promise.all([memberIds(auth.supabase, auth.organizationId), opportunitiesGrantedUserIds(auth.supabase, auth.organizationId)]);
    const listed: string[] = [];
    for (let index = 0; index < ids.length; index += 8) {
      const users = await Promise.all(ids.slice(index, index + 8).map(async id => {
        const { data, error } = await auth.supabase.auth.admin.getUserById(id);
        return !error && isOpportunitiesUserAllowed(data?.user, process.env.OPPORTUNITIES_ALLOWED_EMAILS) ? id : null;
      }));
      listed.push(...users.filter((id): id is string => Boolean(id)));
    }
    return NextResponse.json({ available: true, granted: ids.filter(id => granted.has(id)), listed }, { headers: noStore });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error)
      || NextResponse.json({ error: 'No pudimos cargar quién usa Oportunidades.' }, { status: 500, headers: noStore });
  }
}

/** Gives or takes away one member's access. The member must belong to the admin's organization. */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminDashboardAccess();
    const body = await request.json().catch(() => ({}));
    const userId = String(body?.userId || '').trim();
    if (!UUID_RE.test(userId) || typeof body?.enabled !== 'boolean') {
      return NextResponse.json({ error: 'El cambio de acceso no es válido.' }, { status: 400, headers: noStore });
    }
    if (!(await memberIds(auth.supabase, auth.organizationId)).includes(userId)) {
      return NextResponse.json({ error: 'Esa persona no pertenece a tu organización.' }, { status: 404, headers: noStore });
    }
    await setOpportunitiesGrant(auth.supabase, { organizationId: auth.organizationId, userId, grantedBy: auth.user.id, enabled: body.enabled });
    return NextResponse.json({ userId, enabled: body.enabled }, { headers: noStore });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error)
      || NextResponse.json({ error: 'No pudimos cambiar el acceso a Oportunidades. Inténtalo de nuevo.' }, { status: 500, headers: noStore });
  }
}
