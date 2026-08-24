import { NextRequest, NextResponse } from 'next/server';

import { NativeResearchReprocessRequestSchema } from '@/lib/native-research-contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { isNativeResearchEnabled, processNativeResearchQueue } from '@/lib/server/native-research';
import { reprocessCurrentNativeResearch } from '@/lib/server/native-research-runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!isNativeResearchEnabled()) {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_DISABLED' }, { status: 404 });
    }
    const body = NativeResearchReprocessRequestSchema.parse(await req.json());
    const run = await reprocessCurrentNativeResearch({
      access: { organizationId: auth.organizationId, userId: auth.user.id },
      limit: body.limit,
    });
    if (run.count === 0 || !run.runId) {
      return NextResponse.json({ ok: true, runId: null, count: 0, items: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (process.env.NODE_ENV !== 'production' || String(process.env.NATIVE_RESEARCH_INLINE || '').toLowerCase() === 'true') {
      void processNativeResearchQueue({ limit: run.count, organizationId: auth.organizationId, userId: auth.user.id })
        .catch((error) => console.error('[native-research] inline reprocess worker failed:', error));
    }
    return NextResponse.json({ ok: true, runId: run.runId, count: run.count, items: run.items }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.message === 'NATIVE_RESEARCH_DISABLED') {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_DISABLED' }, { status: 404 });
    }
    if (error?.name === 'ZodError') return NextResponse.json({ error: 'NATIVE_RESEARCH_REPROCESS_INVALID', details: error.issues }, { status: 400 });
    console.error('[native-research] reprocess enqueue failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_REPROCESS_FAILED', message: error?.message || 'No se pudo actualizar la investigación.' }, { status: 500 });
  }
}
