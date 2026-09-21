'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = {
  targetStatus: 'paused' | 'active';
  current: { title: string | null; status: string } | null;
  matches: boolean; fresh: boolean; label: string;
};

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando estado exacto de la misión…</p>;
  const title = preview.targetStatus === 'paused' ? 'Pausar misión' : 'Reactivar misión';
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">Misión</dt><dd className="break-words">{preview.current?.title || 'Sin título'}</dd></div>
      <div><dt className="font-medium">Estado actual</dt><dd>{preview.current?.status || 'No disponible'}</dd></div>
      {preview.targetStatus === 'paused' && <div><dt className="font-medium">Efecto</dt>
        <dd className="text-muted-foreground">Las tareas pendientes de prospección y contacto quedarán omitidas.</dd></div>}
    </dl>
    <p className="text-xs text-muted-foreground">{!preview.matches
      ? 'La misión cambió desde la revisión. Descártala y pide una nueva.'
      : `Coincide con la propuesta. Al aprobar, la misión quedará ${preview.targetStatus === 'paused' ? 'pausada' : 'activa'}.`}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : title}</Button>
    </div>
  </div>;
}
