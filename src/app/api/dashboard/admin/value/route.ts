import { NextRequest, NextResponse } from 'next/server';

import { daysBetween, lastDaysInZone } from '@/lib/admin/chile-time';
import {
  AdminDashboardAuthError,
  adminDashboardAuthErrorResponse,
  requireAdminDashboardAccess,
} from '@/lib/server/admin-dashboard-auth';
import { loadAdminValue } from '@/lib/server/admin-value-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** «¿Les está sirviendo?»: adoption, who needs help and results against the previous period (src/lib/admin/value.ts). */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminDashboardAccess();
    const defaults = lastDaysInZone(30);
    const fromParam = req.nextUrl.searchParams.get('from') || '';
    const toParam = req.nextUrl.searchParams.get('to') || '';
    const from = DATE_RE.test(fromParam) ? fromParam : defaults.from;
    const to = DATE_RE.test(toParam) ? toParam : defaults.to;
    const span = daysBetween(from, to);
    if (!Number.isFinite(span) || span < 1 || span > 367) {
      return NextResponse.json({ error: 'El rango debe estar entre 1 y 367 días.' }, { status: 400 });
    }

    const groupId = String(req.nextUrl.searchParams.get('groupId') || '').trim() || null;
    const userId = String(req.nextUrl.searchParams.get('userId') || '').trim() || null;
    if ((groupId && !UUID_RE.test(groupId)) || (userId && !UUID_RE.test(userId))) {
      return NextResponse.json({ error: 'El filtro seleccionado no es válido.' }, { status: 400 });
    }

    const value = await loadAdminValue(auth.supabase, auth.organizationId, { from, to, groupId, userId });
    return NextResponse.json({ ...value, organization: { id: auth.organizationId, name: auth.organizationName } }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof AdminDashboardAuthError) return adminDashboardAuthErrorResponse(error);
    console.error('[admin-value] load failed:', error);
    const message = error instanceof Error && error.message.startsWith('No pudimos') ? error.message : 'No pudimos cargar el resumen. Inténtalo de nuevo.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
