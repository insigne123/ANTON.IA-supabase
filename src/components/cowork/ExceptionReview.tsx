'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote, ReviewPaper } from './ReviewParts';

type Preview = {
  action: 'resolved' | 'dismissed'; reason: string;
  current: { title: string | null; status: string } | null;
  matches: boolean; fresh: boolean; label: string;
};

/** Exception triage review card: confirms the exception is still open before
 * approving the reviewed outcome. Never claims the underlying issue is fixed. */
export function ExceptionReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/exception-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando estado exacto de la incidencia…" />;
  const title = preview.action === 'resolved' ? 'Marcar resuelta' : 'Descartar incidencia';
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Incidencia"><span className="font-medium">{preview.current?.title || 'Sin título'}</span></ReviewField>
      <ReviewField label="Estado actual">{preview.current?.status || 'No disponible'}</ReviewField>
    </ReviewFields>
    <div>
      <p className="mb-1.5 text-[12.5px] font-medium text-cw-muted">Motivo que quedará registrado</p>
      <ReviewPaper>{preview.reason}</ReviewPaper>
    </div>
    <ReviewNote ok={preview.matches}>{!preview.matches
      ? 'La incidencia cambió desde la revisión. Descártala y pide una nueva.'
      : 'Solo se registrará este resultado con su motivo; no se afirma que la causa quedó reparada.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={title} disabled={!preview.matches} resolving={resolving} />
  </div>;
}
