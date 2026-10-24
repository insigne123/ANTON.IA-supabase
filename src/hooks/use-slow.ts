'use client';

import { useEffect, useState } from 'react';

/** How long a screen may show only its skeleton before it says so (APP-02). */
export const SLOW_LOAD_MS = 8000;

/**
 * Whether something has been waiting for longer than `ms`: a read that hangs, or one that cannot start (the organization never
 * arrived). The screen then says it is taking long and offers to retry, instead of leaving the skeleton up forever.
 */
export function useSlow(waiting: boolean, ms = SLOW_LOAD_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(timer);
  }, [waiting, ms]);
  return waiting && slow;
}
