import { loadResearchReportDocumentV2 } from './research-report-v2-documents';
import { loadResearchReportSynthesisState, publicResearchReportSynthesisState, RESEARCH_REPORT_V2_SCHEMA_VERSION } from './research-report-synthesis-state';

// Read the same validated, visible document used by the research workspace.
// Polling never triggers model generation or changes persisted research.
export async function extensionResearchReport(research: any, access: { organizationId: string; userId: string }, dependencies = {
  loadState: loadResearchReportSynthesisState, loadDocument: loadResearchReportDocumentV2,
}) {
  if (!research?.researchSnapshotId) return research;
  const state = await dependencies.loadState({ researchSnapshotId: research.researchSnapshotId, schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION, access });
  const stored = state?.reportDocumentId ? await dependencies.loadDocument({ researchSnapshotId: research.researchSnapshotId, reportDocumentId: state.reportDocumentId, access }) : null;
  return { ...research, reportDocumentV2: stored?.document || null,
    reportSynthesisV2: publicResearchReportSynthesisState(state),
    reportVersion: stored ? `${stored.id}:${stored.document.revision}` : null };
}
