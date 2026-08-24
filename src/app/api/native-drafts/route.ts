import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { createNativeDraft } from '@/lib/server/native-drafts';
import { getNativeSnapshot } from '@/lib/server/native-research';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isNativeDraftSetupError(error: any) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '42p01'
    || message.includes('email_style_profiles')
    || message.includes('style_profile_id');
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const snapshotId = String(body?.researchSnapshotId || body?.snapshotId || '').trim();
    if (!snapshotId) return NextResponse.json({ error: 'NATIVE_DRAFT_SNAPSHOT_REQUIRED' }, { status: 400 });
    const snapshot = await getNativeSnapshot({
      snapshotId,
      access: { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id },
    });
    if (!snapshot) return NextResponse.json({ error: 'NATIVE_DRAFT_SNAPSHOT_NOT_FOUND' }, { status: 404 });
    const result = await createNativeDraft({
      organizationId: snapshot.organization_id,
      userId: auth.user.id,
      snapshotId,
      styleProfileId: typeof body?.styleProfileId === 'string' ? body.styleProfileId : null,
      styleName: typeof body?.styleName === 'string' ? body.styleName : null,
      idempotencyKey: typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : req.headers.get('idempotency-key'),
    });
    if (result.status === 'drafted') {
      return NextResponse.json({ ok: true, draft: result.draft, issues: result.issues, result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({
      ok: false,
      error: result.code,
      message: result.message,
      preflight: result.preflight,
      issues: result.issues,
      result,
    }, {
      status: result.status === 'blocked' ? 422 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.message === 'NATIVE_DRAFT_PRIVACY_SUPPRESSED') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_PRIVACY_SUPPRESSED' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_DRAFT_GENERATION_IN_PROGRESS') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_GENERATION_IN_PROGRESS' }, { status: 409 });
    }
    console.error('[native-drafts] create failed:', error);
    if (isNativeDraftSetupError(error)) {
      return NextResponse.json({
        error: 'NATIVE_DRAFT_SETUP_REQUIRED',
        message: 'Estamos terminando la configuración para crear borradores. Inténtalo nuevamente en unos minutos.',
      }, { status: 503 });
    }
    return NextResponse.json({ error: 'NATIVE_DRAFT_CREATE_FAILED', message: error?.message || 'No se pudo crear el borrador.' }, { status: 500 });
  }
}
