'use client';
import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { CwButton } from './ui';

type EnrichResult = { email: string | null; emailStatus: string | null; found: boolean; reused: boolean };

/** Inline enrichment: confirm scope inline, run the provider call directly
 * (no chat roundtrip), then hand off to research. Names only, never raw IDs. */
export function EnrichContact({ runId, leadId, displayName, company, onAccessDenied, onEnriched }: {
  runId: string; leadId: string; displayName: string; company?: string | null;
  onAccessDenied: () => void; onEnriched: (email: string | null) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EnrichResult | null>(null);

  async function run() {
    if (running) return;
    setRunning(true); setError('');
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/enrich`, {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, confirm: true }),
      });
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo enriquecer.');
      setResult(data as EnrichResult);
      onEnriched(typeof data.email === 'string' ? data.email : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enriquecer.');
    } finally {
      setRunning(false);
    }
  }

  if (result) {
    return <div className="text-[12.5px]" role="status">
      {result.found && result.email
        ? <p className="flex items-start gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cw-success" aria-hidden="true" /><span>Correo encontrado: <span className="font-medium">{result.email}</span>{result.emailStatus === 'verified' ? ' (verificado)' : ''}{result.reused ? ' (reutilizado)' : ''}. Ya puedes investigarlo.</span></p>
        : <p className="text-cw-muted">El proveedor no devolvió correo para este contacto. No se inventó ningún dato; puedes investigar con lo disponible.</p>}
    </div>;
  }

  if (!confirm) {
    return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      <CwButton size="xs" variant="secondary" onClick={() => setConfirm(true)}><Sparkles aria-hidden="true" />Enriquecer contacto primero</CwButton>
      <span className="text-cw-muted">Sin correo, la investigación rinde menos.</span>
    </div>;
  }

  return <div className="space-y-2 rounded-xl border border-cw-border bg-cw-panel p-3 text-[12.5px]">
    <p><span className="font-medium">{displayName}</span>{company ? <span className="text-cw-muted"> · {company}</span> : ''}</p>
    <p className="leading-5 text-cw-muted">Busca el correo (solo email, 1 crédito de enriquecimiento). Sin teléfono en esta versión y sin datos inventados.</p>
    <div className="flex flex-wrap gap-2">
      <CwButton size="xs" variant="primary" disabled={running} onClick={() => void run()}>{running ? 'Enriqueciendo…' : 'Confirmar enriquecimiento'}</CwButton>
      <CwButton size="xs" variant="ghost" disabled={running} onClick={() => setConfirm(false)}>Volver</CwButton>
    </div>
    {running && <p role="status" className="text-cw-muted">Consultando al proveedor; tarda unos segundos.</p>}
    {error && <p role="alert" className="text-cw-danger">{error}</p>}
  </div>;
}
