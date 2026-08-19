import { NextRequest, NextResponse } from 'next/server';

import {
  adminDashboardAuthErrorResponse,
  requireAdminDashboardAccess,
} from '@/lib/server/admin-dashboard-auth';
import { loadAdminDashboardOverview } from '@/lib/server/admin-dashboard-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateOnly(value: string | null) {
  return value && DATE_RE.test(value) ? value : null;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminDashboardAccess();
    const defaults = defaultRange();
    const from = dateOnly(req.nextUrl.searchParams.get('from')) || defaults.from;
    const to = dateOnly(req.nextUrl.searchParams.get('to')) || defaults.to;
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    const daySpan = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);

    if (!Number.isFinite(daySpan) || daySpan < 0 || daySpan > 366 || from > to) {
      return NextResponse.json({ error: 'El rango debe estar entre 0 y 366 días.' }, { status: 400 });
    }

    const groupId = String(req.nextUrl.searchParams.get('groupId') || '').trim() || null;
    const userId = String(req.nextUrl.searchParams.get('userId') || '').trim() || null;
    if ((groupId && !UUID_RE.test(groupId)) || (userId && !UUID_RE.test(userId))) {
      return NextResponse.json({ error: 'El filtro seleccionado no es válido.' }, { status: 400 });
    }

    const overview = await loadAdminDashboardOverview(
      auth.supabase,
      auth.organizationId,
      auth.organizationName,
      { from, to, groupId, userId },
    );

    return NextResponse.json(overview, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error) || NextResponse.json({ error: 'Unable to load dashboard' }, { status: 500 });
  }
}
