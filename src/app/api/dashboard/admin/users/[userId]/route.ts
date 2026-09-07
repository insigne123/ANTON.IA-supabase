import { NextResponse } from 'next/server';

import {
  AdminDashboardAuthError,
  adminDashboardAuthErrorResponse,
  requireAdminDashboardAccess,
} from '@/lib/server/admin-dashboard-auth';
import { loadAdminUserProfile } from '@/lib/server/admin-user-profile-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const auth = await requireAdminDashboardAccess();
    const { userId } = await context.params;
    const normalizedUserId = String(userId || '').trim();
    if (!UUID_RE.test(normalizedUserId)) {
      return NextResponse.json({ error: 'El usuario seleccionado no es válido.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const profile = await loadAdminUserProfile(
      auth.supabase,
      auth.organizationId,
      auth.organizationName,
      normalizedUserId,
    );
    if (!profile) {
      return NextResponse.json(
        { error: 'El usuario no pertenece a esta organización.' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(profile, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminDashboardAuthError) return adminDashboardAuthErrorResponse(error);
    console.error('[admin-user-profile-route] Unable to load user profile:', error);
    return NextResponse.json(
      { error: 'No pudimos cargar el historial de este usuario.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
