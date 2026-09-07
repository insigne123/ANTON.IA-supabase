import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';
import {
  parseResearchWorkspaceRun,
  type ResearchWorkspaceLead,
  type ResearchWorkspaceRunItem,
} from '@/lib/research-workspace';

export const RESEARCH_RAIL_PAGE_SIZE = 40;

export function mergeResearchRunItems(
  persistedItems: ResearchWorkspaceRunItem[],
  activeItems: ResearchWorkspaceRunItem[],
): ResearchWorkspaceRunItem[] {
  const byLeadKey = new Map(persistedItems.map((item) => [item.lead.key, item]));
  activeItems.forEach((item) => byLeadKey.set(item.lead.key, item));
  return Array.from(byLeadKey.values());
}

export function researchItemsFromLeadStatuses(
  statuses: NativeResearchLeadStatus[],
  leads: ResearchWorkspaceLead[],
): ResearchWorkspaceRunItem[] {
  const leadById = new Map(
    leads
      .filter((lead) => String(lead.id || '').trim())
      .map((lead) => [String(lead.id).trim(), lead]),
  );
  const matched = statuses.flatMap((status) => {
    const lead = leadById.get(String(status.leadId || '').trim());
    return lead ? [{ lead, status }] : [];
  });
  if (matched.length === 0) return [];

  const parsed = parseResearchWorkspaceRun({
    id: 'persisted-research-statuses',
    status: 'completed',
    items: matched.map(({ lead, status }, position) => ({
      id: `persisted:${status.reportId || status.leadId}`,
      reportId: status.reportId || null,
      leadRef: lead.key,
      position,
      status: status.status,
      updatedAt: status.updatedAt,
      job: {
        status: status.status,
        providerReportId: status.reportId || null,
        researchSnapshotId: status.researchSnapshotId,
        resultPayload: status.result,
      },
    })),
  }, matched.map(({ lead }) => lead));

  return parsed?.items || [];
}

export function paginateResearchRail<T>(items: T[], requestedPage: number, pageSize = RESEARCH_RAIL_PAGE_SIZE) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage) || 1));
  const startIndex = (page - 1) * safePageSize;
  const pageItems = items.slice(startIndex, startIndex + safePageSize);

  return {
    items: pageItems,
    page,
    totalPages,
    totalItems: items.length,
    start: pageItems.length > 0 ? startIndex + 1 : 0,
    end: startIndex + pageItems.length,
  };
}
