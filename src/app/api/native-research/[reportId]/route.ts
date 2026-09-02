import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import {
  findNativeResearchJob,
  getNativeSnapshot,
  nativeResearchJobToResult,
} from '@/lib/server/native-research';
import {
  ensureResearchReportDocument,
  researchReportDocumentMetadata,
} from '@/lib/server/research-report-documents';
import { loadSellerProfile } from '@/lib/server/seller-profile';

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

    const access = { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id };
    const snapshotRow = job.researchSnapshotId
      ? await getNativeSnapshot({ snapshotId: job.researchSnapshotId, access })
      : null;
    const snapshot = snapshotRow?.payload ? ResearchSnapshotV1Schema.parse(snapshotRow.payload) : null;
    const reportDocument = snapshot
      ? await ensureResearchReportDocument({
        snapshot,
        access,
        sellerProfile: await loadSellerProfile(auth.user.id),
      })
      : null;
    return NextResponse.json({
      ok: true,
      ...nativeResearchJobToResult(job),
      snapshot: snapshot || null,
      reportDocument: reportDocument?.document || null,
      reportSynthesis: reportDocument ? researchReportDocumentMetadata(reportDocument) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[native-research] poll failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_POLL_FAILED', message: error?.message || 'No se pudo consultar la investigación.' }, { status: 500 });
  }
}
