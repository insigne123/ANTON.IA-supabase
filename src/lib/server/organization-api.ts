import { NextResponse } from 'next/server';

import type { AuthContext } from '@/lib/server/auth-utils';

export const organizationNoStoreHeaders = { 'Cache-Control': 'no-store' };

export function assertOrganizationAccess(auth: AuthContext, organizationId: string) {
  if (!auth.organizationIds.includes(organizationId)) {
    const error = new Error('Organization not found');
    error.name = 'OrganizationAccessError';
    throw error;
  }
}

export function organizationApiError(error: any, fallbackCode: string) {
  if (error?.name === 'AuthError') {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: organizationNoStoreHeaders });
  }
  if (error?.name === 'OrganizationAccessError') {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404, headers: organizationNoStoreHeaders });
  }
  if (error?.name === 'OrganizationCollaborationDisabledError') {
    return NextResponse.json({ error: 'Organization collaboration is not enabled' }, { status: 404, headers: organizationNoStoreHeaders });
  }
  if (error?.name === 'ZodError') {
    return NextResponse.json({ error: 'Request data is invalid' }, { status: 400, headers: organizationNoStoreHeaders });
  }
  if (error?.name === 'RequestAuthError' && (error.status === 401 || error.status === 403)) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: organizationNoStoreHeaders });
  }

  const code = String(error?.code || '');
  const status = code === '42501' ? 403
    : code === 'P0002' ? 404
      : ['23505', '40001', '55000'].includes(code) ? 409
        : code === '22023' ? 400
          : 500;
  if (status === 500) console.error(`[organizations] ${fallbackCode}`, error);
  return NextResponse.json({
    error: status === 500 ? fallbackCode : String(error?.message || fallbackCode),
    code: code || fallbackCode,
  }, { status, headers: organizationNoStoreHeaders });
}
