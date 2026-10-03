// «Por escribir» reloaded the whole list (contacts, saved contacts and research status) on every realtime event: a batch of
// 20 phone results meant 20 full reloads back to back. This runner turns a burst of requests into one run, and never runs
// twice at the same time: a request that arrives while a run is in flight queues exactly one more run after it.

type Timers = {
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

const browserTimers: Timers = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createCoalescedRunner(run: () => Promise<unknown> | unknown, { delayMs = 600, timers = browserTimers }: { delayMs?: number; timers?: Timers } = {}) {
  let timer: unknown = null;
  let running = false;
  let queued = false;
  let cancelled = false;

  const start = async () => {
    timer = null;
    if (cancelled) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await run();
    } catch {
      // The caller shows its own error state; a failed run must not stop the next one.
    } finally {
      running = false;
      if (queued && !cancelled) {
        queued = false;
        schedule();
      }
    }
  };

  /** Asks for a run; requests within `delayMs` of each other share one. */
  function schedule() {
    if (cancelled) return;
    if (timer !== null) timers.clearTimer(timer);
    timer = timers.setTimer(() => { void start(); }, delayMs);
  }

  /** Drops what is pending; for unmount. */
  function cancel() {
    cancelled = true;
    queued = false;
    if (timer !== null) timers.clearTimer(timer);
    timer = null;
  }

  return { schedule, cancel };
}
