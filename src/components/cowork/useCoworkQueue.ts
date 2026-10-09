'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { coworkQueueKey, readCoworkQueue, type CoworkQueuedMessage } from '@/lib/cowork/queued-message';
const storage = () => { try { return window.sessionStorage; } catch { return null; } };
export function useCoworkQueue(scope: Parameters<typeof coworkQueueKey>[0]) {
  const key = coworkQueueKey(scope), keyRef = useRef(key);
  keyRef.current = key;
  const [state, setState] = useState<{ key: string | null; entry: CoworkQueuedMessage | null }>({ key, entry: null });
  const current = useRef(state); current.current = state;
  useEffect(() => { const entry = readCoworkQueue(storage(), key); current.current = { key, entry }; setState({ key, entry }); }, [key]);
  const set = useCallback((text: string | null) => {
    const key = keyRef.current;
    const previous = current.current.key === key ? current.current.entry : null;
    const entry = text ? { text, requestId: previous?.text === text ? previous.requestId : crypto.randomUUID() } : null;
    try { if (key) { if (entry) storage()?.setItem(key, JSON.stringify(entry)); else storage()?.removeItem(key); } } catch { /* The in-memory queue still works. */ }
    current.current = { key, entry }; setState({ key, entry });
  }, []);
  const persist = useCallback((key: string | null, entry: CoworkQueuedMessage | null) => {
    try { if (key) { if (entry) storage()?.setItem(key, JSON.stringify(entry)); else storage()?.removeItem(key); } } catch { /* Memory still preserves the message. */ }
    if (keyRef.current === key) { current.current = { key, entry }; setState({ key, entry }); }
  }, []);
  const bind = useCallback((meta: { key: string | null; entry: CoworkQueuedMessage }, parentRunId: string | null) => {
    const bound = { key: meta.key, entry: { ...meta.entry, parentRunId: meta.entry.parentRunId === undefined ? parentRunId : meta.entry.parentRunId, state: 'sending' as const } };
    persist(bound.key, bound.entry); return bound;
  }, [persist]);
  const acknowledge = useCallback((meta: { key: string | null; entry: CoworkQueuedMessage }, success: boolean) => {
    const stored = meta.key ? readCoworkQueue(storage(), meta.key) : current.current.entry;
    if (stored?.requestId === meta.entry.requestId) persist(meta.key, success ? null : { ...meta.entry, state: 'failed' });
  }, [persist]);
  const entry = state.key === key ? state.entry : null;
  return [entry?.text ?? null, set, entry ? { key, entry } : null, bind, acknowledge] as const;
}
