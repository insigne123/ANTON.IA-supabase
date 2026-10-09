'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { coworkEarlierPage, coworkJoinHistory, type CoworkHistoryTurnView } from '@/lib/cowork/history-pages';

/** Client-only history pagination. Uses existing scoped run reads; does not expand model context or wake workers. */
export function useCoworkHistory(recent: CoworkHistoryTurnView[], options: { selected: string | null; more: boolean;
  request: (url: string, init?: RequestInit) => Promise<unknown> }) {
  const [loaded, setLoaded] = useState<{ tip: string; turns: CoworkHistoryTurnView[]; more: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const selection = useRef(options.selected); selection.current = options.selected;
  const requestController = useRef<AbortController | null>(null);
  const compatible = loaded && recent.some(turn => turn.run.id === loaded.tip);
  const turns = compatible ? coworkJoinHistory(loaded.turns, recent) : recent;
  const retained = Boolean(compatible && turns.length > recent.length);
  const more = retained ? loaded!.more : options.more;
  const tip = recent.at(-1)?.run.id;
  useEffect(() => {
    if (compatible && loaded && tip && loaded.tip !== tip) setLoaded({ ...loaded, tip, turns });
    // Advance the proven branch anchor, so retained pages survive more than eight new continuations.
  }, [compatible, loaded, tip, turns]);
  useEffect(() => { requestController.current?.abort(); requestController.current = null; setBusy(false); setError(''); }, [options.selected]);
  useEffect(() => () => requestController.current?.abort(), []);
  const clear = useCallback(() => { requestController.current?.abort(); requestController.current = null; setLoaded(null); setError(''); setBusy(false); }, []);
  const load = async () => {
    const anchor = turns[0], tip = recent.at(-1)?.run.id, selected = options.selected;
    if (!anchor || !tip || !more || requestController.current || !selected) return;
    const controller = new AbortController(); requestController.current = controller; setBusy(true); setError('');
    try {
      const raw = await options.request(`/api/cowork/runs/${anchor.run.id}`, { signal: controller.signal });
      if (controller.signal.aborted || selection.current !== selected) return;
      const page = coworkEarlierPage(anchor, raw);
      const all = [...page.turns, ...turns];
      if (all.length > 400) throw new Error('Has abierto 400 mensajes de esta conversación. Abre un resultado antiguo directamente para seguir revisando.');
      setLoaded({tip,turns:all,more:page.more});
      return page;
    } catch (problem) {
      if (!controller.signal.aborted && selection.current === selected) setError(problem instanceof Error ? problem.message : 'No se pudieron recuperar los mensajes anteriores.');
    } finally { if (requestController.current === controller) { requestController.current = null; setBusy(false); } }
  };
  return { turns, more, busy, error, load, clear };
}
