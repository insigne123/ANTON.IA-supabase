import { NextResponse } from 'next/server';

import { AdminDashboardAuthError, requireAdminDashboardAccess } from '@/lib/server/admin-dashboard-auth';
import { loadApolloCreditAllocation } from '@/lib/server/apollo-credit-allocation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The Apollo credits assigned to the signed-in admin's organization for this window, and what is left; null when it has none. */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const auth = await requireAdminDashboardAccess();
    const allocation = await loadApolloCreditAllocation(auth.organizationId, auth.supabase);
    return NextResponse.json({ allocation }, { headers });
  } catch (error) {
    if (error instanceof AdminDashboardAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    console.warn('[admin-apollo] allocation unavailable');
    return NextResponse.json({ error: 'No pudimos leer los créditos de Apollo. Intenta nuevamente.' }, { status: 503, headers });
  }
}
