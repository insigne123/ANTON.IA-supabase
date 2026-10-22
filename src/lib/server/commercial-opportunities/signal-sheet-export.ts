// The commercial sheet of a signal as a download: the page's model (signal-sheet.ts) drawn on paper (signal-sheet-pdf.ts), with what the
// team ticked and wrote on it. A sheet with no written report still downloads: it is what the radar saw. Server only.
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { reportItemKey } from '@/lib/commercial-opportunities/report-marks';
import { humanDate } from '@/lib/commercial-opportunities/report-view';
import { buildSignalSheet, type SheetInput } from '@/lib/commercial-opportunities/signal-sheet';
import { signalSheetPdf, type SheetPdfOptions } from './signal-sheet-pdf';
import { teamNotes, type ExportMarks } from './workspace-exports';

/** The ticks and notes the PDF draws: the team's marks of the report, with who wrote each note. */
export function signalSheetOptions(report: OpportunityReport | null, marks: ExportMarks | undefined, radarDate?: string | null): SheetPdfOptions {
  return {
    done: (kind, text) => Boolean(marks?.items[reportItemKey(kind, text)]?.done),
    notes: report ? teamNotes(report, marks).map(({ label, note, by }) => ({ label, note, by })) : [],
    ...(radarDate ? { radarDate } : {}),
  };
}

export async function signalSheetDownload(input: { item: SheetInput['item'] & { updated_at?: string | null }; report: OpportunityReport | null; marks?: ExportMarks; decisionMakerTitles?: string[]; contactsCount?: number; now?: number }) {
  const sheet = buildSignalSheet({ item: input.item, report: input.report, decisionMakerTitles: input.decisionMakerTitles, contactsCount: input.contactsCount, now: input.now });
  if (!sheet) return null;
  return signalSheetPdf(sheet, signalSheetOptions(input.report, input.marks, humanDate(input.item.updated_at ?? new Date(input.now ?? Date.now()).toISOString())));
}
