import type { ResearchReportDetail, ResearchReportSynthesisViewState, ResearchWorkspaceStatus, ResearchWorkspaceRunItem } from '@/lib/research-workspace';

// Local UX estimate: observed cold research (~34s) + editorial (~71s), rounded
// conservatively to 120s. Not a measured population average or a time guarantee.
export const RESEARCH_REPORT_ESTIMATE_MS = 120_000;

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
  if (!Number.isFinite(start)) return { value: 0, longRunning: false, hasStart: false };
  const elapsed = Math.max(0, now - start);
  const duration = Number.isFinite(typicalMs) && typicalMs > 0 ? typicalMs : RESEARCH_REPORT_ESTIMATE_MS;
  return {
    value: Math.min(95, 95 * elapsed / (elapsed + duration / 4)),
    longRunning: elapsed >= duration,
    hasStart: true,
  };
}
