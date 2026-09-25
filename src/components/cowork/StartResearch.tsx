'use client';
import { useEffect, useState } from 'react';
import { BookOpen, LoaderCircle, RotateCcw } from 'lucide-react';
import { CwButton } from './ui';

export function StartResearch({ runId, leadId, onAccessDenied, onUseReport }: {
  runId: string; leadId: string; onAccessDenied: () => void; onUseReport: () => void;
}) {
  const [status, setStatus] = useState('loading');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/cowork/runs/${runId}/research?leadId=${leadId}`, { cache: 'no-store', signal: controller.signal });
        if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        if (controller.signal.aborted) return;
        setStatus(data.status); setError('');
        if (['queued', 'running'].includes(data.status)) timer = setTimeout(poll, 5000);
      } catch { if (!controller.signal.aborted) { setStatus('error'); setError('No se pudo consultar la investigación.'); } }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
    // Parent handlers are intentionally not polling dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, leadId, refresh]);
  async function start() {
    if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/research`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId, confirm: true }) });
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setStatus(data.status); setConfirm(false); setRefresh(value => value + 1);
    } catch { setError('No se pudo confirmar la solicitud. Reintentar usa la misma investigación.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 text-[12.5px]">
    {['completed', 'partial', 'insufficient_data'].includes(status)
      ? <CwButton size="xs" variant="secondary" onClick={onUseReport}><BookOpen aria-hidden="true" />Consultar informe en el chat</CwButton>
      : ['queued', 'running'].includes(status)
        ? <p role="status" className="inline-flex items-center gap-1.5 text-cw-muted"><LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />Investigación {status === 'queued' ? 'en cola' : 'en curso'}. Puedes volver después.</p>
        : status === 'loading' ? <p className="text-cw-muted">Consultando investigación…</p>
          : status === 'not_started' ? <CwButton size="xs" variant="ghost" aria-expanded={confirm} onClick={() => setConfirm(!confirm)}><BookOpen aria-hidden="true" />Investigar contacto</CwButton>
            : <CwButton size="xs" variant="ghost" onClick={() => setRefresh(value => value + 1)}><RotateCcw aria-hidden="true" />Actualizar estado de investigación</CwButton>}
    {confirm && <div className="space-y-2 rounded-xl border border-cw-border bg-cw-panel p-3">
      <p className="leading-5">Solicitar investigación estándar. El servicio aplicará tus cuotas y puede consultar proveedores externos. No enviará mensajes.</p>
      <div className="flex gap-2">
        <CwButton size="xs" variant="primary" disabled={busy} onClick={() => void start()}>{busy ? 'Solicitando…' : 'Confirmar investigación'}</CwButton>
        <CwButton size="xs" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancelar</CwButton>
      </div>
    </div>}
    {error && <p role="alert" className="text-cw-danger">{error}</p>}
  </div>;
}
