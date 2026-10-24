import { NextRequest, NextResponse } from 'next/server';

import { lastDays } from '@/lib/admin/work';
import { adminDashboardAuthErrorResponse, requireAdminDashboardAccess } from '@/lib/server/admin-dashboard-auth';
import { loadAdminWork } from '@/lib/server/admin-work-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** «Oportunidades y Cowork» of the organization the administrator is in, for the last 7, 30 or 90 days (lib/admin/work.ts). */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminDashboardAccess();
    const days = [7, 30, 90].includes(Number(request.nextUrl.searchParams.get('days'))) ? Number(request.nextUrl.searchParams.get('days')) : 30;
    const report = await loadAdminWork(auth.supabase, { id: auth.organizationId, name: auth.organizationName }, lastDays(days));
    return NextResponse.json({ ...report, days }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error)
      || NextResponse.json({ error: 'No pudimos cargar el informe de Oportunidades y Cowork.' }, { status: 500 });
  }
}
