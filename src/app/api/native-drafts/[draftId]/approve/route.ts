import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  NativeDraftPreflightError,
  approveNativeDraft,
  isNativeDraftVersionConflict,
  resolveNativeDraftOrganization,
} from '@/lib/server/native-drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, context: { params: Promise<{ draftId: string }> }) {
  try {
    const auth = await requireAuth();
    const { draftId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const versionId = String(body?.versionId || '').trim();
    if (!versionId) return NextResponse.json({ error: 'NATIVE_DRAFT_VERSION_REQUIRED' }, { status: 400 });
    const organizationId = await resolveNativeDraftOrganization({ draftId, userId: auth.user.id, organizationIds: auth.organizationIds });
    if (!organizationId) return NextResponse.json({ error: 'NATIVE_DRAFT_NOT_FOUND' }, { status: 404 });
    const draft = await approveNativeDraft({
      organizationId,
      userId: auth.user.id,
      draftId,
      versionId,
      warnings: Array.isArray(body?.warnings) ? body.warnings.map(String).slice(0, 20) : [],
    });
    return NextResponse.json({ ok: true, draft }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error instanceof NativeDraftPreflightError) {
      return NextResponse.json({
        error: 'NATIVE_DRAFT_PREFLIGHT_FAILED',
        message: error.message,
        preflight: error.preflight,
      }, { status: 422 });
    }
    if (isNativeDraftVersionConflict(error)) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_VERSION_CONFLICT' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_DRAFT_PRIVACY_SUPPRESSED') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_PRIVACY_SUPPRESSED' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_DRAFT_GENERATION_IN_PROGRESS') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_GENERATION_IN_PROGRESS' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_RESEARCH_SNAPSHOT_NOT_FOUND') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_SNAPSHOT_NOT_FOUND' }, { status: 404 });
    }
    console.error('[native-drafts] approve failed:', error);
    return NextResponse.json({ error: 'NATIVE_DRAFT_APPROVE_FAILED', message: 'No se pudo aprobar el borrador.' }, { status: 500 });
  }
}
