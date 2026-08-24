import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  NativeDraftPreflightError,
  getCurrentNativeDraft,
  isNativeDraftVersionConflict,
  resolveNativeDraftOrganization,
  rewriteNativeDraft,
} from '@/lib/server/native-drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, context: { params: Promise<{ draftId: string }> }) {
  try {
    const auth = await requireAuth();
    const { draftId } = await context.params;
    const organizationId = await resolveNativeDraftOrganization({
      draftId,
      userId: auth.user.id,
      organizationIds: auth.organizationIds,
    });
    if (!organizationId) return NextResponse.json({ error: 'NATIVE_DRAFT_NOT_FOUND' }, { status: 404 });
    const draft = await getCurrentNativeDraft({ organizationId, userId: auth.user.id, draftId });
    if (!draft) return NextResponse.json({ error: 'NATIVE_DRAFT_NOT_FOUND' }, { status: 404 });

    const body = await req.json();
    const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
    const styleProfileId = typeof body?.styleProfileId === 'string' ? body.styleProfileId.trim() : null;
    if (!instruction || instruction.length > 1_000) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_REWRITE_INSTRUCTION_INVALID' }, { status: 400 });
    }
    if (styleProfileId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(styleProfileId)) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_STYLE_INVALID' }, { status: 400 });
    }

    const result = await rewriteNativeDraft({
      organizationId,
      userId: auth.user.id,
      draft,
      instruction,
      styleProfileId,
    });
    return NextResponse.json({ ok: true, ...result }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error instanceof NativeDraftPreflightError) {
      return NextResponse.json({
        error: 'NATIVE_DRAFT_PREFLIGHT_FAILED',
        message: 'El ajuste no cumple los controles de evidencia y calidad.',
        preflight: error.preflight,
      }, { status: 422 });
    }
    if (isNativeDraftVersionConflict(error)) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_VERSION_CONFLICT' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_DRAFT_PRIVACY_SUPPRESSED') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_PRIVACY_SUPPRESSED' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_DRAFT_OPENAI_REWRITE_FAILED') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_OPENAI_REWRITE_FAILED' }, { status: 503 });
    }
    console.error('[native-drafts] rewrite failed:', error);
    return NextResponse.json({
      error: 'NATIVE_DRAFT_REWRITE_FAILED',
      message: 'No se pudo ajustar el correo.',
    }, { status: 500 });
  }
}
