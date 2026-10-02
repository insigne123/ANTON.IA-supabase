import type { ResearchReportDetail, ResearchReportSynthesisViewState, ResearchWorkspaceStatus, ResearchWorkspaceRunItem } from '@/lib/research-workspace';

// Measured in production (2 Oct, last 30 days, 24 written reports): the research takes 7 s (half of them) to 14 s (9 in 10);
// writing the report 151 s to 378 s; the whole run 157 s to 505 s (Plan 6, PR-C3). The bar and the messages use those times:
// they say what usually happens, never a promise.
export const RESEARCH_REPORT_ESTIMATE_MS = 160_000;
/** Slower than 9 in 10 runs: only then does the screen say it is taking longer than usual. */
export const RESEARCH_REPORT_SLOW_MS = 510_000;

export type ResearchReportPhase = 'research' | 'writing' | 'retry';

/** The step a pending report is in, from what the app knows: the research job first, then the written report. */
export function researchReportPhase(input: {
  status?: ResearchWorkspaceStatus | string | null;
  synthesis?: Pick<ResearchReportSynthesisViewState, 'status'> | null;
}): ResearchReportPhase {
  if (input.synthesis?.status === 'retry_scheduled') return 'retry';
  if (input.status === 'queued' || input.status === 'running') return 'research';
  return 'writing';
}

/** «45 s», «2 min», «2 min 10 s». */
export function researchElapsedLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export function researchReportLoadingState(input: {
  status: ResearchWorkspaceStatus;
  snapshotId?: string | null;
  document?: unknown;
  synthesis?: Pick<ResearchReportSynthesisViewState, 'status'> | null;
}) {
  const failed = input.synthesis?.status === 'failed_permanent';
  const researchFailed = input.status === 'failed' || input.status === 'cancelled';
  const terminalSynthesis = ['completed', 'partial'].includes(input.synthesis?.status || '');
  const pending = !failed && !researchFailed && (
    ['queued', 'running', 'retry_scheduled'].includes(input.synthesis?.status || '')
    || ['queued', 'running'].includes(input.status)
    || (!input.document && !terminalSynthesis && Boolean(input.snapshotId)
      && ['completed', 'partial', 'insufficient_data'].includes(input.status))
  );
  return {
    pending,
    failed,
    // An existing final document survives a failed refresh, but never substitute
    // raw evidence (or a lower-version document) for pending editorial output.
    showReport: Boolean(input.document) && !pending,
    unavailable: !pending && !input.document,
  };
}

export function researchDetailLoadingState(detail: ResearchReportDetail) {
  return researchReportLoadingState({
    status: detail.result.status,
    snapshotId: detail.result.researchSnapshotId,
    document: detail.preferredReportDocument,
    synthesis: detail.preferredReportSynthesis,
  });
}

export function researchItemPresentation(item: ResearchWorkspaceRunItem, detail?: ResearchReportDetail | null, loadError = false): ResearchWorkspaceRunItem {
  const state = detail ? researchDetailLoadingState(detail) : researchReportLoadingState({ status: item.status, snapshotId: item.researchSnapshotId, synthesis: item.result?.reportSynthesis });
  if (loadError || state.failed || (detail && state.unavailable)) return { ...item, status: 'failed', readiness: 'needs_attention', canCreateDraft: false };
  if (state.pending) return { ...item, status: 'running', readiness: 'in_progress', canCreateDraft: false };
  return { ...item, readiness: !detail && item.readiness === 'ready' ? 'review' : item.readiness, canCreateDraft: item.canCreateDraft && Boolean(detail && state.showReport) };
}

export function estimatedResearchProgress(startedAt: string | null | undefined, now: number, typicalMs = RESEARCH_REPORT_ESTIMATE_MS) {
  const start = Date.parse(startedAt || '');
  if (!Number.isFinite(start)) return { value: 0, longRunning: false, slow: false, elapsedMs: null, hasStart: false };
  const elapsed = Math.max(0, now - start);
  const duration = Number.isFinite(typicalMs) && typicalMs > 0 ? typicalMs : RESEARCH_REPORT_ESTIMATE_MS;
  return {
    value: Math.min(95, 95 * elapsed / (elapsed + duration / 4)),
    longRunning: elapsed >= duration,
    slow: elapsed >= RESEARCH_REPORT_SLOW_MS,
    elapsedMs: elapsed,
    hasStart: true,
  };
}
