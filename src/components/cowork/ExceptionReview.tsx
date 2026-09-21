'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando estado exacto de la incidencia…</p>;
  const title = preview.action === 'resolved' ? 'Marcar resuelta' : 'Descartar incidencia';
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">Incidencia</dt><dd className="break-words">{preview.current?.title || 'Sin título'}</dd></div>
      <div><dt className="font-medium">Estado actual</dt><dd>{preview.current?.status || 'No disponible'}</dd></div>
      <div><dt className="font-medium">Motivo aprobado</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{preview.reason}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">{!preview.matches
      ? 'La incidencia cambió desde la revisión. Descártala y pide una nueva.'
      : 'Solo se registrará este resultado con su motivo; no se afirma que la causa quedó reparada.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : title}</Button>
    </div>
  </div>;
}
