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
import { processResearchReportSynthesisQueue, queueResearchReportV1Fallback } from '@/lib/server/research-report-worker';
import { loadReportV2SellerConfiguration } from '@/lib/server/seller-profile';
import { RESEARCH_REPORT_V2_RUNTIME_VERSION } from '@/lib/server/research-report-v2-documents';
import {
  RESEARCH_REPORT_V1_SCHEMA_VERSION,
  RESEARCH_REPORT_V2_SCHEMA_VERSION,
  enqueueResearchReportSynthesis,
  loadResearchReportSynthesisState,
  publicResearchReportSynthesisState,
  retryResearchReportSynthesis,
  type ResearchReportSynthesisState,
} from '@/lib/server/research-report-synthesis-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * The report the screen shows. A visible V2 workspace reads V2, except where V2 failed for good and V1 stepped in, and
 * where an older V1 report already exists without V2 (research written before the workspace moved to V2).
 */
function preferredReportSchema(input: { visible: boolean; v1: ResearchReportSynthesisState | null; v1Document: boolean; v2: ResearchReportSynthesisState | null }) {
  if (!input.visible) return RESEARCH_REPORT_V1_SCHEMA_VERSION;
  if (input.v2?.status === 'failed_permanent' && (input.v1 || input.v1Document)) return RESEARCH_REPORT_V1_SCHEMA_VERSION;
  return input.v2 || !input.v1Document ? RESEARCH_REPORT_V2_SCHEMA_VERSION : RESEARCH_REPORT_V1_SCHEMA_VERSION;
}

/**
 * Research opened in a visible V2 workspace that has no report to show yet gets one queued: V2 when it was never
 * written (research from before 20 oct 2026, when V2 became the default), V1 when V2 failed for good.
 */
async function queueMissingReport(input: {
  snapshotId: string;
  organizationId: string;
  userId: string;
  synthesisContextHash: string;
  v1: ResearchReportSynthesisState | null;
  v1Document: boolean;
  v2: ResearchReportSynthesisState | null;
}) {
  try {
    if (!input.v2 && !input.v1Document) {
      return {
        v2: await enqueueResearchReportSynthesis({
          researchSnapshotId: input.snapshotId,
          schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
          promptVersion: RESEARCH_REPORT_V2_RUNTIME_VERSION,
          sellerProfileHash: input.synthesisContextHash,
        }),
        v1: input.v1,
      };
    }
    if (input.v2?.status === 'failed_permanent' && !input.v1Document && (!input.v1 || input.v1.errorCode === 'report_v1_superseded')) {
      return {
        v2: input.v2,
        v1: await queueResearchReportV1Fallback({ researchSnapshotId: input.snapshotId, organizationId: input.organizationId, userId: input.userId }),
      };
    }
  } catch (error) {
    console.error('[native-research] missing report enqueue failed:', error instanceof Error ? error.message : String(error));
  }
  return null;
}

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
    const configuration = snapshot ? await loadReportV2SellerConfiguration({ organizationId: job.organizationId, userId: job.userId }) : null;
    let [reportSynthesisState, reportSynthesisStateV2] = snapshot
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
    if (snapshot && configuration?.mode === 'visible') {
      const queued = await queueMissingReport({
        snapshotId: snapshot.id, organizationId: job.organizationId, userId: job.userId,
        synthesisContextHash: configuration.synthesisContextHash,
        v1: reportSynthesisState, v1Document: Boolean(reportDocument), v2: reportSynthesisStateV2,
      });
      if (queued) {
        [reportSynthesisState, reportSynthesisStateV2] = [queued.v1, queued.v2];
        void processResearchReportSynthesisQueue({ limit: 1, organizationId: job.organizationId, userId: job.userId })
          .catch((error) => console.error('[native-research] missing report worker failed:', error));
      }
    }
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
      questionnaireEnabled: configuration?.questionnaireMode === 'visible',
      preferredReportSchemaVersion: preferredReportSchema({
        visible: configuration?.mode === 'visible', v1: reportSynthesisState, v1Document: Boolean(reportDocument), v2: reportSynthesisStateV2,
      }),
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
    const configuration = await loadReportV2SellerConfiguration({ organizationId: job.organizationId, userId: job.userId });
    const v1Document = states[1]?.reportDocumentId
      ? Boolean(await loadResearchReportDocument({ researchSnapshotId: job.researchSnapshotId, reportDocumentId: states[1].reportDocumentId, access }))
      : false;
    const preferredState = preferredReportSchema({ visible: configuration.mode === 'visible', v1: states[1], v1Document, v2: states[0] }) === RESEARCH_REPORT_V2_SCHEMA_VERSION
      ? states[0]
      : states[1];
    const target = preferredState?.status === 'failed_permanent' ? preferredState : null;
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
