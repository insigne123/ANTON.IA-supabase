'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = {
  language: string; code: string; inputFiles: string[]; matches: boolean; label: string;
};

/** Code review card: shows the exact staged code and input files pinned by the
 * proposal target. A mismatch blocks approval. Execution happens only after
 * approval, in the isolated remote executor. */
export function CodeReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    fetch(`/api/cowork/runs/${runId}/code-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando código exacto a ejecutar…</p>;
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">Lenguaje</dt><dd>{preview.language === 'python' ? 'Python' : 'Node.js'} · entorno aislado (2 GB, 1 vCPU, 120 s, sin red)</dd></div>
      {preview.inputFiles.length > 0 && <div><dt className="font-medium">Archivos de entrada</dt><dd className="break-words">{preview.inputFiles.join(', ')}</dd></div>}
    </dl>
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-4 font-mono text-[13px] leading-6">{preview.code}</pre>
    <p className="text-xs text-muted-foreground">{preview.matches
      ? 'Coincide con la propuesta. Al aprobar se ejecutará exactamente este código.'
      : 'El código cambió desde la propuesta. Descártala y pide una nueva revisión.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Aprobar y ejecutar'}</Button>
    </div>
  </div>;
}
