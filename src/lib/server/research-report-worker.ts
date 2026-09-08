import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { tryEnsureResearchReportDocument } from '@/lib/server/research-report-documents';
import { tryEnsureResearchReportDocumentV2 } from '@/lib/server/research-report-v2-documents';
import {
  RESEARCH_REPORT_V1_SCHEMA_VERSION,
  RESEARCH_REPORT_V2_SCHEMA_VERSION,
  rejectResearchReportSynthesisCandidate,
  type ResearchReportSchemaVersion,
} from '@/lib/server/research-report-synthesis-state';
import { loadReportV2SellerConfiguration, loadSellerProfile } from '@/lib/server/seller-profile';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type WorkerCandidate = {
  id: string;
  research_snapshot_id: string;
  organization_id: string;
  user_id: string;
  schema_version: ResearchReportSchemaVersion;
};

export type ResearchReportWorkerDependencies = {
  admin?: any;
  processV1?: typeof tryEnsureResearchReportDocument;
  processV2?: typeof tryEnsureResearchReportDocumentV2;
  loadV1SellerProfile?: typeof loadSellerProfile;
  loadV2Configuration?: typeof loadReportV2SellerConfiguration;
  rejectCandidate?: typeof rejectResearchReportSynthesisCandidate;
  recordV2Metrics?: (input: {
    candidate: WorkerCandidate;
    result: Awaited<ReturnType<typeof tryEnsureResearchReportDocumentV2>>;
  }) => Promise<void> | void;
  now?: () => Date;
};

function terminal(status: string | undefined, retryable: boolean | undefined) {
  return status === 'completed' || status === 'partial' && retryable !== true;
}

function candidateFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = !(
    error instanceof Error && error.name === 'ZodError'
    || /RESEARCH_REPORT_SNAPSHOT_(?:NOT_FOUND|INVALID)|REPORT_V2_ICP_CONFIGURATION_INVALID/.test(message)
  );
  return {
    code: retryable ? 'research_report_candidate_failed' : 'research_report_candidate_invalid',
    message,
    retryable,
  };
}

async function recordReportV2Metrics(input: {
  candidate: WorkerCandidate;
  result: Awaited<ReturnType<typeof tryEnsureResearchReportDocumentV2>>;
}) {
  if (!input.result.metrics) return;
  const durationMs = input.result.metrics.modelTelemetry?.reduce((total, item) => total + item.durationMs, 0) || null;
  await safeAppendAntoniaEvent({
    eventKey: `report-v2:${input.candidate.research_snapshot_id}:${input.result.document?.document.revision || 'unknown'}`,
    eventType: 'research.report_v2.synthesized',
    organizationId: input.candidate.organization_id,
    actorType: 'worker',
    actorUserId: input.candidate.user_id,
    entityType: 'research_snapshot',
    entityId: input.candidate.research_snapshot_id,
    sourceSystem: 'native-research',
    provider: 'openai',
    operationId: input.candidate.research_snapshot_id,
    attemptNumber: input.result.synthesis?.attemptCount || 1,
    status: input.result.synthesis?.status || input.result.document?.status || null,
    outcome: input.result.document ? 'persisted' : 'not_persisted',
    durationMs,
    metrics: input.result.metrics,
    privacyClass: 'operational',
  });
}

export async function processResearchReportSynthesisQueue(input: {
  limit?: number;
  organizationId?: string;
  userId?: string;
} = {}, dependencies: ResearchReportWorkerDependencies = {}) {
  const admin = dependencies.admin || getSupabaseAdminClient();
  const now = (dependencies.now || (() => new Date()))();
  const limit = Math.max(1, Math.min(25, Math.trunc(Number(input.limit) || 5)));
  const dueAt = now.toISOString();
  const staleAt = new Date(now.getTime() - 15 * 60_000).toISOString();
  let query = admin
    .from('research_report_synthesis_states')
    .select('id,research_snapshot_id,organization_id,user_id,schema_version')
    .or(`and(status.in.(queued,retry_scheduled,partial),retryable.eq.true,attempt_count.lt.4,next_retry_at.lte.${dueAt}),and(status.eq.running,attempt_count.lt.4,claimed_at.lt.${staleAt})`)
    .order('next_retry_at', { ascending: true })
    .limit(limit);
  if (input.organizationId) query = query.eq('organization_id', input.organizationId);
  if (input.userId) query = query.eq('user_id', input.userId);
  const { data, error } = await query;
  if (error) throw error;

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  for (const rawCandidate of data || []) {
    const candidate = rawCandidate as WorkerCandidate;
    try {
      const { data: snapshotRow, error: snapshotError } = await admin
        .from('research_snapshots')
        .select('payload')
        .eq('id', candidate.research_snapshot_id)
        .eq('organization_id', candidate.organization_id)
        .eq('user_id', candidate.user_id)
        .maybeSingle();
      if (snapshotError) throw snapshotError;
      if (!snapshotRow?.payload) {
        throw new Error('RESEARCH_REPORT_SNAPSHOT_NOT_FOUND');
      }
      const snapshot = ResearchSnapshotV1Schema.parse(snapshotRow.payload);
      const access = { organizationId: candidate.organization_id, userId: candidate.user_id };
      if (candidate.schema_version === RESEARCH_REPORT_V1_SCHEMA_VERSION) {
        const sellerProfile = await (dependencies.loadV1SellerProfile || loadSellerProfile)(candidate.user_id);
        const result = await (dependencies.processV1 || tryEnsureResearchReportDocument)({ snapshot, access, sellerProfile });
        if (terminal(result.synthesis?.status, result.synthesis?.retryable)) completed += 1;
        else if (result.synthesis?.status === 'failed_permanent') failed += 1;
        else skipped += 1;
        continue;
      }
      if (candidate.schema_version === RESEARCH_REPORT_V2_SCHEMA_VERSION) {
        const configuration = await (dependencies.loadV2Configuration || loadReportV2SellerConfiguration)(access, admin);
        if (configuration.mode === 'off') {
          await (dependencies.rejectCandidate || rejectResearchReportSynthesisCandidate)({
            stateId: candidate.id,
            errorCode: 'report_v2_rollout_off',
            errorMessage: 'Report V2 rollout is disabled for this organization.',
            retryable: false,
            now: dueAt,
          }, admin);
          skipped += 1;
          continue;
        }
        const result = await (dependencies.processV2 || tryEnsureResearchReportDocumentV2)({
          snapshot,
          access,
          sellerProfile: configuration.sellerProfile,
          icpRules: configuration.icpRules,
          synthesisContextHash: configuration.synthesisContextHash,
          deliveryState: configuration.mode === 'visible' ? 'visible' : 'suppressed',
        });
        if (result.metrics) {
          try {
            await (dependencies.recordV2Metrics || recordReportV2Metrics)({ candidate, result });
          } catch (metricsError) {
            console.error('[research-report-worker] metrics append failed:', {
              researchSnapshotId: candidate.research_snapshot_id,
              error: metricsError instanceof Error ? metricsError.message : String(metricsError),
            });
          }
        }
        if (terminal(result.synthesis?.status, result.synthesis?.retryable)) completed += 1;
        else if (result.synthesis?.status === 'failed_permanent') failed += 1;
        else skipped += 1;
        continue;
      }
      skipped += 1;
    } catch (candidateError) {
      failed += 1;
      const failure = candidateFailure(candidateError);
      try {
        await (dependencies.rejectCandidate || rejectResearchReportSynthesisCandidate)({
          stateId: candidate.id,
          errorCode: failure.code,
          errorMessage: failure.message,
          retryable: failure.retryable,
          now: dueAt,
        }, admin);
      } catch (stateError) {
        console.error('[research-report-worker] candidate state update failed:', {
          researchSnapshotId: candidate.research_snapshot_id,
          error: stateError instanceof Error ? stateError.message : String(stateError),
        });
      }
      console.error('[research-report-worker] candidate failed:', {
        researchSnapshotId: candidate.research_snapshot_id,
        schemaVersion: candidate.schema_version,
        error: failure.message,
      });
    }
  }
  return { claimed: (data || []).length, completed, failed, skipped };
}
