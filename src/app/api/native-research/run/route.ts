import { NextRequest, NextResponse } from 'next/server';

import { NativeResearchBatchRequestSchema } from '@/lib/native-research-contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { isNativeResearchEnabled, processNativeResearchQueue } from '@/lib/server/native-research';
import { enqueueNativeResearchRun } from '@/lib/server/native-research-runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!isNativeResearchEnabled()) {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_DISABLED' }, { status: 404 });
    }
    const parsed = NativeResearchBatchRequestSchema.parse(await req.json());
    const run = await enqueueNativeResearchRun({
      access: { organizationId: auth.organizationId, userId: auth.user.id },
      leads: parsed.leads,
      options: parsed.options,
    });

    if (process.env.NODE_ENV !== 'production' || String(process.env.NATIVE_RESEARCH_INLINE || '').toLowerCase() === 'true') {
      void processNativeResearchQueue({ limit: parsed.leads.length, organizationId: auth.organizationId, userId: auth.user.id })
        .catch((error) => console.error('[native-research] inline batch worker failed:', error));
    }

    return NextResponse.json({ ok: true, runId: run.runId, items: run.items }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.message === 'NATIVE_RESEARCH_DISABLED') {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_DISABLED' }, { status: 404 });
    }
    if (error?.name === 'ZodError') return NextResponse.json({ error: 'NATIVE_RESEARCH_INVALID_BATCH', details: error.issues }, { status: 400 });
    console.error('[native-research] batch enqueue failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_BATCH_FAILED', message: error?.message || 'No se pudo crear la ejecución.' }, { status: 500 });
  }
}
