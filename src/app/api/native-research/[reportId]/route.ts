import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  findNativeResearchJob,
  getNativeSnapshot,
  nativeResearchJobToResult,
} from '@/lib/server/native-research';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  try {
    const auth = await requireAuth();
    const { reportId } = await context.params;
    const job = await findNativeResearchJob({
      reportId: String(reportId || '').trim(),
      access: { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id },
    });
    if (!job) return NextResponse.json({ error: 'NATIVE_RESEARCH_NOT_FOUND' }, { status: 404 });

    const snapshot = job.researchSnapshotId
      ? await getNativeSnapshot({
        snapshotId: job.researchSnapshotId,
        access: { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id },
      })
      : null;
    return NextResponse.json({
      ok: true,
      ...nativeResearchJobToResult(job),
      snapshot: snapshot?.payload || null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[native-research] poll failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_POLL_FAILED', message: error?.message || 'No se pudo consultar la investigación.' }, { status: 500 });
  }
}
