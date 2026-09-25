'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  targetStatus: 'paused' | 'active';
  current: { title: string | null; status: string } | null;
  matches: boolean; fresh: boolean; label: string;
};

const STATUS: Record<string, string> = { active: 'Activa', paused: 'Pausada', completed: 'Terminada', draft: 'Borrador' };

/** Mission control review card: confirms the state is unchanged before
 * approving pause or resume. Pausing omits pending tasks like manual pause. */
export function MissionReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/mission-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando estado exacto de la misión…" />;
  const title = preview.targetStatus === 'paused' ? 'Pausar misión' : 'Reactivar misión';
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Misión"><span className="font-medium">{preview.current?.title || 'Sin título'}</span></ReviewField>
      <ReviewField label="Estado actual">{preview.current ? STATUS[preview.current.status] || preview.current.status : 'No disponible'}</ReviewField>
      {preview.targetStatus === 'paused' && <ReviewField label="Efecto">Las tareas pendientes de prospección y contacto quedarán omitidas.</ReviewField>}
    </ReviewFields>
    <ReviewNote ok={preview.matches}>{!preview.matches
      ? 'La misión cambió desde la revisión. Descártala y pide una nueva.'
      : `Coincide con la propuesta. Al aprobar, la misión quedará ${preview.targetStatus === 'paused' ? 'pausada' : 'activa'}.`}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={title} disabled={!preview.matches} resolving={resolving} />
  </div>;
}
