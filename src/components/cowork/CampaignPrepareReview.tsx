'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = {
  stepId: string; current: { state: string; nativeDraftId: string | null } | null;
  matches: boolean; fresh: boolean; label: string;
};

/** Campaign prepare review card: confirms the step is still awaiting a draft
 * before approving preparation. Never sends anything. */
export function CampaignPrepareReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/campaignprepare-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando estado exacto del paso…</p>;
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">Paso</dt><dd className="break-all font-mono text-[13px]">{preview.stepId}</dd></div>
      <div><dt className="font-medium">Estado actual</dt><dd>{preview.current ? preview.current.state : 'No disponible'}</dd></div>
      <div><dt className="font-medium">Borrador</dt><dd>{preview.current?.nativeDraftId ? 'Ya existe: usa la pantalla de campañas' : 'Aún no preparado'}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">{!preview.matches
      ? 'El paso cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se preparará el borrador para tu revisión; no se enviará nada.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Aprobar y preparar'}</Button>
    </div>
  </div>;
}
