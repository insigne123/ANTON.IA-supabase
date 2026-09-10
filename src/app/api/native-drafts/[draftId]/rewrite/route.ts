import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { normalizeEmailStyleSelection } from '@/lib/outsourcing-email-style-presets';
import { resolveCampaignStepRewriteContext } from '@/lib/server/campaigns-v2/rewrite-context';
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

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_INVALID_JSON' }, { status: 400 });
    }
    const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
    if (body.previewOnly !== undefined && typeof body.previewOnly !== 'boolean') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_PREVIEW_INVALID' }, { status: 400 });
    }
    const rawStyleProfileId = typeof body?.styleProfileId === 'string' ? body.styleProfileId : null;
    const styleProfileId = rawStyleProfileId ? normalizeEmailStyleSelection(rawStyleProfileId) : null;
    const expectedVersionId = typeof body?.expectedVersionId === 'string' ? body.expectedVersionId.trim() : '';
    const campaignStepId = typeof body?.campaignStepId === 'string' ? body.campaignStepId.trim() : '';
    if (!instruction || instruction.length > 1_000) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_REWRITE_INSTRUCTION_INVALID' }, { status: 400 });
    }
    if (rawStyleProfileId?.trim() && !styleProfileId) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_STYLE_INVALID' }, { status: 400 });
    }
    if (!expectedVersionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedVersionId)) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_EXPECTED_VERSION_REQUIRED' }, { status: 400 });
    }
    if (draft.versionId !== expectedVersionId) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_VERSION_CONFLICT' }, { status: 409 });
    }
    if (campaignStepId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignStepId)) {
      return NextResponse.json({ error: 'CAMPAIGN_V2_STEP_INVALID' }, { status: 400 });
    }
    const sequenceContext = campaignStepId
      ? await resolveCampaignStepRewriteContext({
          organizationId,
          userId: auth.user.id,
          campaignStepId,
          draft,
        })
      : undefined;

    const result = await rewriteNativeDraft({
      organizationId,
      userId: auth.user.id,
      draft,
      instruction,
      previewOnly: body.previewOnly === true,
      expectedVersionId,
      styleProfileId,
      ...(sequenceContext ? { sequenceContext } : {}),
    });
    return NextResponse.json({ ok: true, ...result }, {
      status: body.previewOnly === true ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.name === 'SyntaxError') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_INVALID_JSON' }, { status: 400 });
    }
    if (error instanceof NativeDraftPreflightError) {
      return NextResponse.json({
        error: 'NATIVE_DRAFT_PREFLIGHT_FAILED',
        message: 'El ajuste no cumple los controles de evidencia y calidad.',
        preflight: error.preflight,
        issues: error.issues,
      }, { status: 422 });
    }
    if (isNativeDraftVersionConflict(error)) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_VERSION_CONFLICT' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_DRAFT_ARCHIVED') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_ARCHIVED' }, { status: 409 });
    }
    if (error?.message === 'NATIVE_DRAFT_PREVIEW_STYLE_CHANGE_UNSUPPORTED') {
      return NextResponse.json({
        error: error.message,
        message: 'La propuesta debe usar el estilo actual del borrador. Conserva ese estilo para continuar.',
      }, { status: 409 });
    }
    if (error?.message === 'EMAIL_STYLE_FORBIDDEN') {
      return NextResponse.json({ error: 'EMAIL_STYLE_FORBIDDEN' }, { status: 403 });
    }
    if (error?.message === 'NATIVE_DRAFT_STYLE_NOT_FOUND') {
      return NextResponse.json({ error: 'NATIVE_DRAFT_STYLE_NOT_FOUND' }, { status: 404 });
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
