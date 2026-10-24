/**
 * Where a report is, for the page's «oficina» (ReportOffice.tsx): what the job itself recorded in its payload while it worked
 * (workspace-research.ts), and the minutes its size suggested when it was asked for. Each stage is one character at the office.
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
  /** When reading started (ISO): with the parts read, the pace of this report, pauses between turns included. */
  readSince: string | null;
  /** About how many minutes the whole report takes, from the size of its documents when it was asked for (reportMinutes). */
  minutes: number | null;
};
type Stored = { stage?: unknown; read?: unknown; total?: unknown; document?: unknown; since?: unknown; readSince?: unknown };
export type ReportProgressNote =
  | { stage: 'buyer' }
  | { stage: 'read'; read: number; total: number; document: string | null }
  | { stage: 'write'; total: number };

/**
 * About how many minutes a report of `parts` takes (OPP-19). Measured in October 2026: a part takes about 20 s to read and the job
 * pauses about 90 s between its turns; read four at a time (workspace-research.ts), about 3 minutes to gather, look up the buyer and
 * write, and a fifth of a minute per part.
 */
export function reportMinutes(parts: number) {
  return Math.ceil(3 + Math.max(0, parts) / 5);
}
/** Writing the report once reading is done: the pause before its turn and the writing itself. */
const WRITING_MS = 3 * 60_000;
const isTime = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null);

/** The progress the page reads, from the job's state and the note in its payload. Nothing else of the payload leaves the server. */
export function reportJobProgress(state: string, payload: { progress?: Stored; estimate?: { minutes?: unknown } } | null | undefined): ReportJobProgress {
  const stored: Stored = payload?.progress && typeof payload.progress === 'object' ? payload.progress : {};
  const noted = REPORT_STAGES.find(stage => stage !== 'gather' && stage === stored.stage);
  const total = count(stored.total);
  const minutes = count(payload?.estimate?.minutes);
  return {
    stage: state === 'queued' ? 'queued' : noted ?? 'gather',
    read: Math.min(count(stored.read) ?? 0, total ?? Number.MAX_SAFE_INTEGER),
    total,
    document: typeof stored.document === 'string' && stored.document.trim() ? stored.document.trim().slice(0, 160) : null,
    since: isTime(stored.since) ? stored.since : null,
    readSince: isTime(stored.readSince) ? stored.readSince : null,
    minutes: minutes ? Math.min(minutes, 120) : null,
  };
}

/**
 * About how many minutes are left (OPP-19): while reading, from this report's own pace once a part is read, plus the writing; before,
 * the estimate of its size. Writing says nothing: the page shows how long it has been at it. Null: nothing honest to say.
 */
export function reportMinutesLeft(progress: ReportJobProgress, now: number): number | null {
  if (progress.stage === 'write') return null;
  if (progress.stage === 'read' && progress.total && progress.read > 0 && progress.readSince) {
    const pace = Math.max(0, now - Date.parse(progress.readSince)) / progress.read;
    return Math.max(1, Math.ceil(((progress.total - progress.read) * pace + WRITING_MS) / 60_000));
  }
  return progress.minutes;
}

/**
 * The note a job keeps in its payload as it goes. Reading never goes back: a job that resumes in its next tick reads its first
 * parts again (from results already paid for), and the page should not see 30 of 40 turn into 1 of 40. Reading and writing keep
 * the moment they started: the page says the pace of the one and how long the other has been at it.
 */
export function nextReportProgress(previous: Stored | null | undefined, note: ReportProgressNote, now: Date): Stored {
  if (note.stage === 'buyer') return { stage: 'buyer' };
  if (note.stage === 'read') {
    const same = previous?.stage === 'read' && count(previous.total) === note.total;
    const before = same ? count(previous!.read) ?? 0 : 0;
    // The pace counts from the first part, through the pauses between turns.
    const readSince = same && isTime(previous!.readSince) ? previous!.readSince : now.toISOString();
    return { stage: 'read', read: Math.min(Math.max(before, note.read), note.total), total: note.total, document: note.document, readSince };
  }
  const since = previous?.stage === 'write' && typeof previous.since === 'string' ? previous.since : now.toISOString();
  return { stage: 'write', read: note.total, total: note.total, since };
}
