/**
 * Where a report is, for the page's «oficina» (ReportOffice.tsx): only what the job itself recorded in its payload while it
 * worked (workspace-research.ts), never an estimate. Each stage is one character at the office.
 */
export const REPORT_STAGES = ['gather', 'buyer', 'read', 'write'] as const;
export type ReportStage = (typeof REPORT_STAGES)[number];
export type ReportJobProgress = {
  /** queued: nobody started; gather until the job says otherwise, since gathering the files is what it does first. */
  stage: 'queued' | ReportStage;
  /** Parts of the documents read (four fragments each) out of total, once reading started. */
  read: number;
  total: number | null;
  /** The document the part being read comes from. */
  document: string | null;
  /** When writing started (ISO). */
  since: string | null;
};
type Stored = { stage?: unknown; read?: unknown; total?: unknown; document?: unknown; since?: unknown };
export type ReportProgressNote =
  | { stage: 'buyer' }
  | { stage: 'read'; read: number; total: number; document: string | null }
  | { stage: 'write'; total: number };

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null);

/** The progress the page reads, from the job's state and the note in its payload. Nothing else of the payload leaves the server. */
export function reportJobProgress(state: string, payload: { progress?: Stored } | null | undefined): ReportJobProgress {
  const stored: Stored = payload?.progress && typeof payload.progress === 'object' ? payload.progress : {};
  const noted = REPORT_STAGES.find(stage => stage !== 'gather' && stage === stored.stage);
  const total = count(stored.total);
  return {
    stage: state === 'queued' ? 'queued' : noted ?? 'gather',
    read: Math.min(count(stored.read) ?? 0, total ?? Number.MAX_SAFE_INTEGER),
    total,
    document: typeof stored.document === 'string' && stored.document.trim() ? stored.document.trim().slice(0, 160) : null,
    since: typeof stored.since === 'string' && !Number.isNaN(Date.parse(stored.since)) ? stored.since : null,
  };
}

/**
 * The note a job keeps in its payload as it goes. Reading never goes back: a job that resumes in its next tick reads its first
 * parts again (from results already paid for), and the page should not see 30 of 40 turn into 1 of 40. Writing keeps the moment
 * it started, so the page can say how long it has been at it.
 */
export function nextReportProgress(previous: Stored | null | undefined, note: ReportProgressNote, now: Date): Stored {
  if (note.stage === 'buyer') return { stage: 'buyer' };
  if (note.stage === 'read') {
    const before = previous?.stage === 'read' && count(previous.total) === note.total ? count(previous.read) ?? 0 : 0;
    return { stage: 'read', read: Math.min(Math.max(before, note.read), note.total), total: note.total, document: note.document };
  }
  const since = previous?.stage === 'write' && typeof previous.since === 'string' ? previous.since : now.toISOString();
  return { stage: 'write', read: note.total, total: note.total, since };
}
