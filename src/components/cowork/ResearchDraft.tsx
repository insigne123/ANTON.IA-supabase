'use client';

import { useEffect, useRef, useState } from 'react';
import { FilePenLine, LoaderCircle, RotateCcw } from 'lucide-react';
import { CwButton } from './ui';

type DraftState =
  | { status: 'none' }
  | { status: 'pending' | 'executing' }
  | { status: 'completed'; draft: { id: string; subject: string | null; text: string | null } | null }
  | { status: 'failed'; message?: string | null; uncertain?: boolean };

export function ResearchDraft({ runId, snapshotId, onAccessDenied }: {
  runId: string; snapshotId: string; onAccessDenied: () => void;
}) {
  const [state, setState] = useState<DraftState>({ status: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
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
        setState(data.status === 'completed' ? { status: 'completed', draft: data.draft ?? null }
          : data.status === 'failed' ? { status: 'failed', message: data.message, uncertain: data.uncertain } : { status: data.status });
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
  }, [runId, snapshotId, refresh]);

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
      if (!current.signal.aborted) {
        setState(data.status === 'completed' ? { status: 'completed', draft: null } : { status: data.status });
        setRefresh(value => value + 1);
      }
    } catch (error) {
      if (!current.signal.aborted) setError(error instanceof Error ? error.message : 'No se pudo solicitar el borrador.');
    } finally { controller.current = null; if (!current.signal.aborted) setBusy(false); }
  }

  if (state.status === 'completed' && state.draft) {
    return <section aria-label="Borrador guardado" className="space-y-3 rounded-2xl border border-cw-border bg-cw-elevated p-4">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-cw-muted">Borrador guardado</p>
      <h4 className="text-[15px] font-semibold tracking-tight">{state.draft.subject || 'Borrador guardado'}</h4>
      <p className="whitespace-pre-wrap break-words text-[14px] leading-6">{state.draft.text || 'El borrador está guardado en el editor de correos.'}</p>
      <p className="text-[12px] text-cw-muted">Versión actual del borrador. Crear este borrador no envía mensajes.</p>
      <div className="flex flex-wrap gap-2">
        <a href={`/contact/compose?draftId=${encodeURIComponent(state.draft.id)}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-cw-accent px-3 text-[13px] font-medium text-cw-on-accent hover:bg-cw-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">Abrir en el editor de correos</a>
        <CwButton size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)}><RotateCcw aria-hidden="true" />Actualizar versión</CwButton>
      </div>
    </section>;
  }

  return <div className="space-y-2 rounded-2xl border border-dashed border-cw-border-strong p-4">
    {state.status === 'none' && <>
      <CwButton variant="secondary" size="sm" onClick={() => void request()} disabled={busy}><FilePenLine aria-hidden="true" />{busy ? 'Solicitando…' : 'Crear borrador con este informe'}</CwButton>
      <p className="text-[12px] text-cw-muted">Usa tu perfil y las comprobaciones del editor de correos. No envía mensajes.</p>
    </>}
    {state.status === 'pending' && <p role="status" className="flex items-center gap-1.5 text-[13px] text-cw-muted"><LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Borrador en cola. Puedes cerrar esta pestaña y volver después.</p>}
    {state.status === 'executing' && <p role="status" className="flex items-center gap-1.5 text-[13px] text-cw-muted"><LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Preparando borrador…</p>}
    {state.status === 'failed' && <>
      <p role="alert" className="text-[13px] text-cw-danger">{state.message || 'No se pudo preparar el borrador. Tu investigación sigue guardada.'}</p>
      {!state.uncertain && <CwButton variant="secondary" size="sm" onClick={() => void request()} disabled={busy}>{busy ? 'Reintentando…' : 'Reintentar borrador'}</CwButton>}
    </>}
    {state.status === 'completed' && !state.draft && <>
      <p className="text-[13px] text-cw-muted">El borrador está registrado. Actualiza para recuperar su contenido.</p>
      <CwButton variant="secondary" size="sm" onClick={() => setRefresh(value => value + 1)} disabled={busy}>Actualizar borrador</CwButton>
    </>}
    {error && <div className="space-y-1"><p role="alert" className="text-[13px] text-cw-danger">{error}</p><CwButton variant="ghost" size="sm" onClick={() => setRefresh(value => value + 1)}>Actualizar estado</CwButton></div>}
  </div>;
}
