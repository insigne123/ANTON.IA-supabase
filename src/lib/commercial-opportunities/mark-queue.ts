// Saving the team's marks without ever dropping a click. A tick shows at once; the server is told in order, one request at a time
// per item, so a second click on the same item («me equivoqué») is never lost while the first one is still on its way, and the
// other items stay free. If the last save of an item fails, it goes back to what the server last confirmed. Pure: the page, the
// hook and the tests share it.
import { emptyMark, type ReportMark, type ReportMarks } from './report-marks';

export type MarkInput = { key: string; label: string; done?: boolean; highlight?: boolean; note?: string };

/** The marks as they read the moment someone changes one: the change applied on top of what is on screen. */
export function applyMarkChange(marks: ReportMarks, input: MarkInput): ReportMarks {
  const current = marks[input.key] ?? emptyMark(input.key);
  return { ...marks, [input.key]: { ...current,
    ...(input.done !== undefined ? { done: input.done } : {}), ...(input.highlight !== undefined ? { highlight: input.highlight } : {}), ...(input.note !== undefined ? { note: input.note.trim() } : {}) } };
}

export type MarkQueueHooks = {
  /** Tells the server; null when it said no. */
  send: (input: MarkInput) => Promise<ReportMark | null>;
  /** What an item reads once its last change is settled: the server's mark, or the last one it confirmed (undefined: none) after a failure. */
  settled: (key: string, mark: ReportMark | undefined, failed: boolean) => void;
  /** The items with a change still on its way, whenever that set changes. */
  pending: (keys: ReadonlySet<string>) => void;
};

export class MarkQueue {
  private tails = new Map<string, Promise<void>>();
  private counts = new Map<string, number>();
  private confirmed: ReportMarks;
  constructor(private hooks: MarkQueueHooks, confirmed: ReportMarks = {}) { this.confirmed = { ...confirmed }; }

  /** What the server last said, when the page reads the whole expediente again. */
  confirm(marks: ReportMarks) { this.confirmed = { ...marks }; }
  isPending(key: string) { return (this.counts.get(key) ?? 0) > 0; }
  pendingKeys(): ReadonlySet<string> { return new Set([...this.counts].filter(([, count]) => count > 0).map(([key]) => key)); }

  /** Queues the change behind the earlier ones of the same item; resolves when this one is settled. */
  push(input: MarkInput): Promise<void> {
    const key = input.key;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.hooks.pending(this.pendingKeys());
    const run = (this.tails.get(key) ?? Promise.resolve()).then(async () => {
      const saved = await this.hooks.send(input).catch(() => null);
      if (saved) this.confirmed[key] = saved;
      const left = (this.counts.get(key) ?? 1) - 1;
      this.counts.set(key, left);
      // Only the last change of an item says how it ends: the ones before it already show on screen, and showing the server's
      // answer to each would flicker the check between its two states.
      if (left === 0) this.hooks.settled(key, this.confirmed[key], !saved);
      this.hooks.pending(this.pendingKeys());
    });
    this.tails.set(key, run);
    return run;
  }
}
