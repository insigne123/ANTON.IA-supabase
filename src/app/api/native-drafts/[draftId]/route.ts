import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getCurrentNativeDraft, isNativeDraftVersionConflict, resolveNativeDraftOrganization, reviseNativeDraft } from '@/lib/server/native-drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, context: { params: Promise<{ draftId: string }> }) {
  try {
    const auth = await requireAuth();
    const { draftId } = await context.params;
    const organizationId = await resolveNativeDraftOrganization({ draftId, userId: auth.user.id, organizationIds: auth.organizationIds });
    if (!organizationId) return NextResponse.json({ error: 'NATIVE_DRAFT_NOT_FOUND' }, { status: 404 });
    const draft = await getCurrentNativeDraft({ organizationId, userId: auth.user.id, draftId });
    if (!draft) return NextResponse.json({ error: 'NATIVE_DRAFT_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true, draft }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    return NextResponse.json({ error: 'NATIVE_DRAFT_READ_FAILED', message: error?.message || 'No se pudo leer el borrador.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ draftId: string }> }) {
  try {
    const auth = await requireAuth();
    const { draftId } = await context.params;
    const organizationId = await resolveNativeDraftOrganization({ draftId, userId: auth.user.id, organizationIds: auth.organizationIds });
    if (!organizationId) return NextResponse.json({ error: 'NATIVE_DRAFT_NOT_FOUND' }, { status: 404 });
    const current = await getCurrentNativeDraft({ organizationId, userId: auth.user.id, draftId });
    if (!current) return NextResponse.json({ error: 'NATIVE_DRAFT_NOT_FOUND' }, { status: 404 });
    const body = await req.json();
    const draft = await reviseNativeDraft({
      organizationId,
      userId: auth.user.id,
      draft: current,
      subject: body?.subject,
      text: body?.text || body?.body,
    });
    return NextResponse.json({ ok: true, draft }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (isNativeDraftVersionConflict(error)) {
      return NextResponse.json({ error: 'NATIVE_DRAFT_VERSION_CONFLICT' }, { status: 409 });
    }
    return NextResponse.json({ error: 'NATIVE_DRAFT_UPDATE_FAILED', message: error?.message || 'No se pudo guardar la revisión.' }, { status: 500 });
  }
}
