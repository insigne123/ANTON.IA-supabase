import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import {
  findNativeResearchJob,
  getNativeSnapshot,
  nativeResearchJobToResult,
} from '@/lib/server/native-research';
import {
  loadResearchReportDocument,
  researchReportDocumentMetadata,
} from '@/lib/server/research-report-documents';
import {
  loadResearchReportDocumentV2,
  researchReportDocumentV2Metadata,
} from '@/lib/server/research-report-v2-documents';
import { processResearchReportSynthesisQueue } from '@/lib/server/research-report-worker';
import {
  RESEARCH_REPORT_V1_SCHEMA_VERSION,
  RESEARCH_REPORT_V2_SCHEMA_VERSION,
  loadResearchReportSynthesisState,
  publicResearchReportSynthesisState,
  retryResearchReportSynthesis,
} from '@/lib/server/research-report-synthesis-state';

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
    const [reportSynthesisState, reportSynthesisStateV2] = snapshot
      ? await Promise.all([
        loadResearchReportSynthesisState({
          researchSnapshotId: snapshot.id,
          schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
          access,
        }),
        loadResearchReportSynthesisState({
          researchSnapshotId: snapshot.id,
          schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
          access,
        }),
      ])
      : [null, null];
    const [reportDocument, reportDocumentV2] = snapshot
      ? await Promise.all([
        reportSynthesisState?.reportDocumentId
          ? loadResearchReportDocument({
              researchSnapshotId: snapshot.id,
              reportDocumentId: reportSynthesisState.reportDocumentId,
              access,
            })
          : Promise.resolve(null),
        reportSynthesisStateV2?.reportDocumentId
          ? loadResearchReportDocumentV2({
              researchSnapshotId: snapshot.id,
              reportDocumentId: reportSynthesisStateV2.reportDocumentId,
              access,
            })
          : Promise.resolve(null),
      ])
      : [null, null];
    const reportDocuments = [
      ...(reportDocument ? [{
        schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
        document: reportDocument.document,
        metadata: { id: reportDocument.id, schemaVersion: reportDocument.schemaVersion, revision: reportDocument.document.revision, ...researchReportDocumentMetadata(reportDocument) },
      }] : []),
      ...(reportDocumentV2 ? [{
        schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
        document: reportDocumentV2.document,
        metadata: researchReportDocumentV2Metadata(reportDocumentV2),
      }] : []),
    ];
    const reportSyntheses = [
      ...(reportSynthesisState ? [{ schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION, synthesis: publicResearchReportSynthesisState(reportSynthesisState) }] : []),
      ...(reportSynthesisStateV2 ? [{ schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION, synthesis: publicResearchReportSynthesisState(reportSynthesisStateV2) }] : []),
    ];
    const legacySynthesisState = publicResearchReportSynthesisState(reportSynthesisState);
    const legacySynthesis = legacySynthesisState && ['queued', 'running', 'retry_scheduled', 'failed_permanent'].includes(legacySynthesisState.status)
      ? legacySynthesisState
      : reportDocument
        ? researchReportDocumentMetadata(reportDocument)
        : legacySynthesisState;
    return NextResponse.json({
      ok: true,
      ...nativeResearchJobToResult(job),
      snapshot: snapshot || null,
      reportDocument: reportDocument?.document || null,
      reportSynthesis: legacySynthesis,
      reportDocuments,
      reportSyntheses,
      preferredReportSchemaVersion: reportDocumentV2
        ? RESEARCH_REPORT_V2_SCHEMA_VERSION
        : reportDocument
          ? RESEARCH_REPORT_V1_SCHEMA_VERSION
          : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[native-research] poll failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_POLL_FAILED', message: error?.message || 'No se pudo consultar la investigación.' }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  try {
    const auth = await requireAuth();
    const { reportId } = await context.params;
    const access = { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id };
    const job = await findNativeResearchJob({ reportId: String(reportId || '').trim(), access });
    if (!job?.id || !job.researchSnapshotId) {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_NOT_FOUND' }, { status: 404 });
    }

    const states = await Promise.all([
      loadResearchReportSynthesisState({ researchSnapshotId: job.researchSnapshotId, schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION, access }),
      loadResearchReportSynthesisState({ researchSnapshotId: job.researchSnapshotId, schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION, access }),
    ]);
    const target = states.find((state) => state?.status === 'failed_permanent');
    if (!target) return NextResponse.json({ error: 'REPORT_SYNTHESIS_NOT_RETRYABLE' }, { status: 409 });
    await retryResearchReportSynthesis({
      researchSnapshotId: job.researchSnapshotId,
      schemaVersion: target.schemaVersion,
      access,
    });
    void processResearchReportSynthesisQueue({ limit: 1, organizationId: job.organizationId, userId: auth.user.id })
      .catch((error) => console.error('[native-research] report synthesis retry worker failed:', error));
    return NextResponse.json({
      ok: true,
      schemaVersion: target.schemaVersion,
      reportSynthesis: { status: 'queued', retryable: false },
    });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.message === 'REPORT_SYNTHESIS_NOT_RETRYABLE') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('[native-research] report synthesis retry failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_REPORT_RETRY_FAILED' }, { status: 500 });
  }
}
