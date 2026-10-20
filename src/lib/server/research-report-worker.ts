import { RESEARCH_REPORT_PROMPT_VERSION, sellerProfileHash } from '@/ai/flows/synthesize-research-report';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { tryEnsureResearchReportDocument } from '@/lib/server/research-report-documents';
import { tryEnsureResearchReportDocumentV2 } from '@/lib/server/research-report-v2-documents';
import {
  RESEARCH_REPORT_V1_SCHEMA_VERSION,
  RESEARCH_REPORT_V2_SCHEMA_VERSION,
  enqueueResearchReportSynthesis,
  loadResearchReportSynthesisState,
  rejectResearchReportSynthesisCandidate,
  retryResearchReportSynthesis,
  type ResearchReportSchemaVersion,
} from '@/lib/server/research-report-synthesis-state';
import { loadReportV2SellerConfiguration, loadSellerProfile } from '@/lib/server/seller-profile';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  buildSynthesisActionableTask,
  resolveSynthesisRetryPolicy,
  SYNTHESIS_EDITORIAL_RETRY_LIMIT,
} from '@/lib/research-synthesis-retry-policy';
import { readResearchQueue } from '@/lib/server/research-queue-read';

export {
  buildSynthesisActionableTask,
  resolveSynthesisRetryPolicy,
  SYNTHESIS_EDITORIAL_RETRY_LIMIT,
} from '@/lib/research-synthesis-retry-policy';

type WorkerCandidate = {
  id: string;
  research_snapshot_id: string;
  organization_id: string;
  user_id: string;
  schema_version: ResearchReportSchemaVersion;
  attempt_count?: number | null;
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
  /** The V2 state of a snapshot: a visible workspace writes V1 only when V2 failed for good. */
  loadV2State?: (input: { researchSnapshotId: string; access: { organizationId: string; userId: string } }) => Promise<{ status: string } | null>;
  /** Queues the V1 report of a snapshot whose V2 report failed for good. */
  enqueueV1Fallback?: (candidate: WorkerCandidate) => Promise<void>;
};

/** V2 reports written together in one tick: each spends one to two minutes waiting on the model, so three take the time of one. */
const V2_REPORTS_PER_TICK = 3;

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

/**
 * When the V2 report fails for good (no company domain, evidence the review could not settle), the V1 report is written
 * instead: the person always gets a report to read and to write the email from. It is still labelled for what it is.
 */
export async function queueResearchReportV1Fallback(input: { researchSnapshotId: string; organizationId: string; userId: string }, admin: any = getSupabaseAdminClient()) {
  const sellerProfile = await loadSellerProfile(input.userId, input.organizationId);
  const state = await enqueueResearchReportSynthesis({
    researchSnapshotId: input.researchSnapshotId,
    schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
    promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
    sellerProfileHash: sellerProfileHash(sellerProfile),
  }, admin);
  // A V1 report set aside earlier («superseded» by V2) is given its attempts back.
  if (state.status === 'failed_permanent') {
    return retryResearchReportSynthesis({
      researchSnapshotId: input.researchSnapshotId,
      schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
      access: { organizationId: input.organizationId, userId: input.userId },
    }, admin);
  }
  return state;
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
  const readCandidates = () => {
    let query = admin
      .from('research_report_synthesis_states')
      .select('id,research_snapshot_id,organization_id,user_id,schema_version,attempt_count')
      .or(`and(status.in.(queued,retry_scheduled,partial),retryable.eq.true,attempt_count.lt.4,next_retry_at.lte.${dueAt}),and(status.eq.running,attempt_count.lt.4,claimed_at.lt.${staleAt})`)
      .order('next_retry_at', { ascending: true })
      .limit(limit);
    if (input.organizationId) query = query.eq('organization_id', input.organizationId);
    if (input.userId) query = query.eq('user_id', input.userId);
    return query;
  };
  const { data } = await readResearchQueue<any[]>('synthesis-candidates', readCandidates);

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  const v2Runs: Array<() => Promise<void>> = [];

  const failCandidate = async (candidate: WorkerCandidate, candidateError: unknown) => {
    failed += 1;
    const failure = candidateFailure(candidateError);
    const policy = resolveSynthesisRetryPolicy({
      attemptCount: candidate.attempt_count,
      retryable: failure.retryable,
    });
    const task = policy.shouldExposeTask
      ? buildSynthesisActionableTask({
          researchSnapshotId: candidate.research_snapshot_id,
          errorCode: failure.code,
        })
      : null;
    try {
      await (dependencies.rejectCandidate || rejectResearchReportSynthesisCandidate)({
        stateId: candidate.id,
        errorCode: failure.code,
        errorMessage: task ? `${failure.message} Tarea accionable: ${task.title}. ${task.howToFind}` : failure.message,
        retryable: policy.retryable,
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
  };

  const runV2 = async (
    candidate: WorkerCandidate,
    snapshot: ReturnType<typeof ResearchSnapshotV1Schema.parse>,
    access: { organizationId: string; userId: string },
    configuration: Awaited<ReturnType<typeof loadReportV2SellerConfiguration>>,
  ) => {
    try {
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
      else if (result.synthesis?.status === 'failed_permanent') {
        failed += 1;
        if (configuration.mode === 'visible') {
          try {
            await (dependencies.enqueueV1Fallback || ((value: WorkerCandidate) => queueResearchReportV1Fallback({
              researchSnapshotId: value.research_snapshot_id, organizationId: value.organization_id, userId: value.user_id,
            }, admin)))(candidate);
          } catch (fallbackError) {
            console.error('[research-report-worker] V1 fallback enqueue failed:', {
              researchSnapshotId: candidate.research_snapshot_id,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            });
          }
        }
      } else skipped += 1;
    } catch (candidateError) {
      await failCandidate(candidate, candidateError);
    }
  };

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
        const configuration = await (dependencies.loadV2Configuration || loadReportV2SellerConfiguration)(access, admin);
        if (configuration.mode === 'visible') {
          // Visible V2 writes the report; V1 only steps in when V2 failed for good (enqueueV1Fallback).
          const v2 = await (dependencies.loadV2State || ((input) => loadResearchReportSynthesisState({
            ...input, schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
          }, admin)))({ researchSnapshotId: candidate.research_snapshot_id, access });
          if (v2?.status !== 'failed_permanent') {
            await (dependencies.rejectCandidate || rejectResearchReportSynthesisCandidate)({
              stateId: candidate.id, errorCode: 'report_v1_superseded',
              errorMessage: 'Report V2 visible delivery supersedes V1 synthesis.', retryable: false, now: dueAt,
            }, admin);
            skipped += 1;
            continue;
          }
        }
        const sellerProfile = await (dependencies.loadV1SellerProfile || loadSellerProfile)(candidate.user_id, candidate.organization_id);
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
        // A bounded report can take several minutes: a few run together, the rest stay unclaimed for the next tick.
        if (v2Runs.length >= V2_REPORTS_PER_TICK) { skipped += 1; continue; }
        v2Runs.push(() => runV2(candidate, snapshot, access, configuration));
        continue;
      }
      skipped += 1;
    } catch (candidateError) {
      await failCandidate(candidate, candidateError);
    }
  }
  await Promise.all(v2Runs.map((run) => run()));
  return { claimed: (data || []).length, completed, failed, skipped };
}
