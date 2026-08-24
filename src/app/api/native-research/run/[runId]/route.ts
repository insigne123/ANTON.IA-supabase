import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { listNativeResearchRun } from '@/lib/server/native-research';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const auth = await requireAuth();
    const { runId } = await context.params;
    const run = await listNativeResearchRun({
      runId: String(runId || '').trim(),
      access: { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id },
    });
    if (!run) return NextResponse.json({ error: 'NATIVE_RESEARCH_RUN_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true, run }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[native-research] run poll failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_RUN_POLL_FAILED', message: error?.message || 'No se pudo consultar la ejecución.' }, { status: 500 });
  }
}
