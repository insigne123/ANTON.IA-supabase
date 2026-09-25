'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

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
    return <div className="space-y-1 text-xs sm:col-span-2" role="status">
      {result.found && result.email
        ? <p>Correo encontrado: <span className="font-medium">{result.email}</span>{result.emailStatus === 'verified' ? ' (verificado)' : ''}{result.reused ? ' (reutilizado)' : ''}. Ya puedes investigarlo.</p>
        : <p>El proveedor no devolvió correo para este contacto. No se inventó ningún dato; puedes investigar con lo disponible.</p>}
    </div>;
  }

  if (!confirm) {
    return <div className="space-y-1 text-xs sm:col-span-2">
      <button type="button" className="font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setConfirm(true)}>Enriquecer contacto primero</button>
      <p className="text-muted-foreground">Sin correo, la investigación rinde menos: primero el dato, después el informe.</p>
    </div>;
  }

  return <div className="space-y-2 rounded-lg border border-border p-3 text-xs sm:col-span-2">
    <p><span className="font-medium">{displayName}</span>{company ? ` · ${company}` : ''}</p>
    <p className="text-muted-foreground">Busca el correo (solo email, 1 crédito de enriquecimiento). Sin teléfono en esta versión y sin datos inventados.</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={running} onClick={() => void run()}>{running ? 'Enriqueciendo…' : 'Confirmar enriquecimiento'}</Button>
      <Button size="sm" variant="ghost" disabled={running} onClick={() => setConfirm(false)}>Volver</Button>
    </div>
    {running && <p role="status" className="text-muted-foreground">Consultando al proveedor; tarda unos segundos.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
