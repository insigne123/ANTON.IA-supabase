'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewChips, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote, ReviewPaper } from './ReviewParts';

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
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando código exacto a ejecutar…" />;
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Lenguaje">{preview.language === 'python' ? 'Python' : 'Node.js'} · entorno aislado (2 GB, 1 vCPU, 120 s, sin red)</ReviewField>
      {preview.inputFiles.length > 0 && <ReviewField label="Archivos de entrada"><ReviewChips values={preview.inputFiles} /></ReviewField>}
    </ReviewFields>
    <ReviewPaper mono>{preview.code}</ReviewPaper>
    <ReviewNote ok={preview.matches}>{preview.matches
      ? 'Coincide con la propuesta. Al aprobar se ejecutará exactamente este código.'
      : 'El código cambió desde la propuesta. Descártala y pide una nueva revisión.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y ejecutar" disabled={!preview.matches} resolving={resolving} />
  </div>;
}
