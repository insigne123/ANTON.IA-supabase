'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type DraftState =
  | { status: 'none' }
  | { status: 'pending' | 'executing' }
  | { status: 'completed'; draft: { id: string; subject: string | null; text: string | null } | null }
  | { status: 'failed' };

export function ResearchDraft({ runId, snapshotId, onAccessDenied }: {
  runId: string; snapshotId: string; onAccessDenied: () => void;
}) {
  const [state, setState] = useState<DraftState>({ status: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [runId, snapshotId]);

  useEffect(() => {
    const poll = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function fetchStatus() {
      try {
        const response = await fetch(
          `/api/cowork/runs/${runId}/draft?snapshotId=${snapshotId}`,
          { cache: 'no-store', signal: poll.signal },
        );
        if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (poll.signal.aborted) return;
        setState(data.status === 'completed' ? { status: 'completed', draft: data.draft ?? null } : { status: data.status });
        setError('');
        if (data.status === 'pending' || data.status === 'executing') timer = setTimeout(fetchStatus, 5000);
      } catch {
        if (!poll.signal.aborted) setError('No se pudo consultar el borrador.');
      }
    }
    void fetchStatus();
    return () => { poll.abort(); clearTimeout(timer); };
    // Parent handlers are intentionally not polling dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, snapshotId]);

  async function request() {
    if (controller.current) return;
    const current = new AbortController(); controller.current = current; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/draft`, {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId }), signal: current.signal,
      });
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo solicitar el borrador.');
      if (!current.signal.aborted) setState({ status: data.status === 'completed' ? 'completed' : data.status });
    } catch (error) {
      if (!current.signal.aborted) setError(error instanceof Error ? error.message : 'No se pudo solicitar el borrador.');
    } finally { controller.current = null; if (!current.signal.aborted) setBusy(false); }
  }

  if (state.status === 'completed' && state.draft) {
    return <div className="mt-4 space-y-3 border-t border-border pt-4">
      <section aria-label="Borrador guardado" className="space-y-3">
        <h4 className="font-medium">{state.draft.subject || 'Borrador guardado'}</h4>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{state.draft.text || 'El borrador está guardado en el editor de correos.'}</p>
        <p className="text-xs text-muted-foreground">Borrador guardado · No enviado</p>
      </section>
    </div>;
  }

  return <div className="mt-4 space-y-3 border-t border-border pt-4">
    {state.status === 'none' && <>
      <Button variant="outline" onClick={() => void request()} disabled={busy}>{busy ? 'Solicitando…' : 'Crear borrador con este informe'}</Button>
      <p className="text-xs text-muted-foreground">Usa tu perfil y las comprobaciones del editor de correos. No envía mensajes.</p>
    </>}
    {state.status === 'pending' && <p role="status" className="text-sm text-muted-foreground">Borrador en cola. Puedes cerrar esta pestaña y volver después.</p>}
    {state.status === 'executing' && <p role="status" className="text-sm text-muted-foreground">Preparando borrador…</p>}
    {state.status === 'failed' && <>
      <p role="alert" className="text-sm text-destructive">No se pudo preparar el borrador. Tu investigación sigue guardada.</p>
      <Button variant="outline" onClick={() => void request()} disabled={busy}>{busy ? 'Reintentando…' : 'Reintentar borrador'}</Button>
    </>}
    {state.status === 'completed' && !state.draft && <>
      <p className="text-sm text-muted-foreground">El borrador se generó, pero su contenido ya no está disponible aquí. Puedes solicitarlo de nuevo.</p>
      <Button variant="outline" onClick={() => void request()} disabled={busy}>Solicitar de nuevo</Button>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
