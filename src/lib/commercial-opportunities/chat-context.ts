import type { OpportunityReport } from './expedient';
import { humanDate } from './report-view';
import { milestoneDate } from './report-marks';

/**
 * What the chat may lean on besides the fragments it retrieved: the report's decision and what it already established, its
 * requirements with their status and its dates. Without them an answer said «no aparecen las garantías» right under a
 * report that listed them.
 */
export function opportunityChatReportContext(report: Partial<OpportunityReport> | null | undefined) {
  if (!report) return null;
  return {
    decision: report.recommendation, executive: String(report.executive || '').slice(0, 4000),
    nextSteps: report.nextSteps || [], questions: (report.questions || []).slice(0, 8),
    requisitos: (report.requirements || []).slice(0, 20).map(r => ({ requisito: String(r.title || '').slice(0, 300), estado: r.status })),
    fechas: (report.milestones || []).slice(0, 12).map(m => ({ hito: String(m.label || '').slice(0, 160), fecha: milestoneDate(m.date) })),
  };
}

/** The deadline as a person in Chile reads it; the stored value is UTC and the model repeated «12:00 (UTC)». */
export function opportunityChatDeadline(value: string | null | undefined) {
  const date = humanDate(value, true);
  return date ? `${date} (hora de Chile)` : null;
}
