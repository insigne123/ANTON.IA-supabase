'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
  return <div className="space-y-2 text-xs sm:col-span-2">
    {['completed', 'partial', 'insufficient_data'].includes(status) ? <Button variant="outline" size="sm" onClick={onUseReport}>Consultar informe en el chat</Button>
      : ['queued', 'running'].includes(status) ? <p role="status" className="text-muted-foreground">Investigación {status === 'queued' ? 'en cola' : 'en curso'}. Puedes volver después.</p>
      : status === 'loading' ? <p className="text-muted-foreground">Consultando investigación…</p>
      : status === 'not_started' ? <Button variant="ghost" size="sm" onClick={() => setConfirm(!confirm)}>Investigar contacto</Button>
      : <Button variant="ghost" size="sm" onClick={() => setRefresh(value => value + 1)}>Actualizar estado de investigación</Button>}
    {confirm && <div className="rounded-lg border border-border p-3"><p>Solicitar investigación estándar. El servicio aplicará tus cuotas y puede consultar proveedores externos. No enviará mensajes.</p><Button className="mt-2" size="sm" disabled={busy} onClick={() => void start()}>{busy ? 'Solicitando…' : 'Confirmar investigación'}</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
