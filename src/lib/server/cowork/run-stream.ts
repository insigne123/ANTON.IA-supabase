export type CoworkRunCursor = { status: string; sequence: number };

const ACTIVE = new Set(['queued', 'running', 'waiting_approval', 'waiting_workers']);

/** tick: how often the run is read. lifetime: one connection stays open at
 * most this long; the browser reconnects on its own after `retry`. */
export const COWORK_STREAM = { tickMs: 1000, lifetimeMs: 55000, heartbeatMs: 15000, retryMs: 3000 };

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

/** Server-sent event frames for one run: `change` when its status or latest
 * event moves, `end` once it stops being active, a comment as heartbeat. Ends
 * when the reader leaves, the run is gone or unreadable, or the lifetime is up. */
export async function* coworkStreamFrames(input: {
  first: CoworkRunCursor;
  read: () => Promise<CoworkRunCursor | null>;
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
    if (now() - opened >= options.lifetimeMs) return;
    if (now() - beat >= options.heartbeatMs) {
      beat = now();
      yield ': ping\n\n';
    }
    await wait(options.tickMs, input.signal);
    if (input.signal.aborted) return;
    try { cursor = await input.read(); } catch { return; }
  }
}
