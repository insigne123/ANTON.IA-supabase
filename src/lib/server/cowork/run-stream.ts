import type { CoworkRunDraft } from './live-draft';

export type CoworkRunCursor = { status: string; sequence: number };

const ACTIVE = new Set(['queued', 'running', 'waiting_approval', 'waiting_workers']);

/** tick: how often the run is read. draftTick: how often its live draft is read while it
 * runs. lifetime: one connection stays open at most this long; the browser reconnects on
 * its own after `retry`. */
export const COWORK_STREAM = { tickMs: 1000, draftTickMs: 400, lifetimeMs: 55000, heartbeatMs: 15000, retryMs: 3000 };

function frame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** What changed in a growing text: keep `from` characters of the previous one and add `text`.
 * A rewrite (the answer was corrected) starts earlier; a surrogate pair is never split. */
export function coworkDraftDelta(previous: string, next: string): { from: number; text: string } {
  const max = Math.min(previous.length, next.length);
  let from = 0;
  while (from < max && previous.charCodeAt(from) === next.charCodeAt(from)) from++;
  const code = next.charCodeAt(from);
  if (from > 0 && code >= 0xdc00 && code <= 0xdfff) from--;
  return { from, text: next.slice(from) };
}

/** Server-sent event frames for one run: `change` when its status or latest
 * event moves, `draft` with what the answer being written added, its cards and
 * whether it is being reviewed (only when readDraft is given), `end` once it
 * stops being active, a comment as heartbeat.
 * Ends when the reader leaves, the run is gone or unreadable, or the lifetime is up. */
export async function* coworkStreamFrames(input: {
  first: CoworkRunCursor;
  read: () => Promise<CoworkRunCursor | null>;
  readDraft?: () => Promise<CoworkRunDraft | null>;
  signal: AbortSignal;
  now?: () => number;
  options?: Partial<typeof COWORK_STREAM>;
}): AsyncGenerator<string, void, undefined> {
  const options = { ...COWORK_STREAM, ...input.options };
  const now = input.now || Date.now;
  const opened = now();
  let beat = opened;
  let cursor: CoworkRunCursor | null = input.first;
  let last = '';
  let drafts = Boolean(input.readDraft);
  let cursorAt = opened;
  let sent = '';
  let sentShape = '';
  let draftAt = '';
  yield `retry: ${options.retryMs}\n\n`;
  while (cursor && !input.signal.aborted) {
    const key = `${cursor.status}:${cursor.sequence}`;
    if (key !== last) {
      last = key;
      beat = now();
      yield frame('change', cursor);
    }
    if (!ACTIVE.has(cursor.status)) {
      yield frame('end', cursor);
      return;
    }
    if (drafts && input.readDraft && cursor.status === 'running') {
      try {
        const draft = await input.readDraft();
        const shape = JSON.stringify([draft?.cards || [], Boolean(draft?.reviewing)]);
        if (draft && draft.updatedAt !== draftAt && (draft.text !== sent || shape !== sentShape)) {
          draftAt = draft.updatedAt;
          const delta = coworkDraftDelta(sent, draft.text);
          sent = draft.text;
          sentShape = shape;
          beat = now();
          yield frame('draft', { ...delta, cards: draft.cards, reviewing: Boolean(draft.reviewing) });
        }
      } catch {
        // No draft table yet, or unreadable: the stream goes on as a doorbell only.
        drafts = false;
      }
    }
    if (now() - opened >= options.lifetimeMs) return;
    if (now() - beat >= options.heartbeatMs) {
      beat = now();
      yield ': ping\n\n';
    }
    await wait(drafts && cursor.status === 'running' ? Math.min(options.draftTickMs, options.tickMs) : options.tickMs, input.signal);
    if (input.signal.aborted) return;
    // With drafts the loop turns faster; the run itself is still read once per tick.
    if (drafts && now() - cursorAt < options.tickMs) continue;
    cursorAt = now();
    try { cursor = await input.read(); } catch { return; }
  }
}
