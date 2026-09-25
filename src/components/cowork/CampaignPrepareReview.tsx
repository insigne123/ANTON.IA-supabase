'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  stepId: string; current: { state: string; nativeDraftId: string | null } | null;
  matches: boolean; fresh: boolean; label: string;
};

const STATES: Record<string, string> = {
  ready: 'Listo para preparar', pending: 'Pendiente', drafted: 'Borrador preparado', scheduled: 'Programado',
  sent: 'Enviado', skipped: 'Omitido', failed: 'Con error',
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
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando estado exacto del paso…" />;
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Estado actual">{preview.current ? STATES[preview.current.state] || preview.current.state : 'No disponible'}</ReviewField>
      <ReviewField label="Borrador">{preview.current?.nativeDraftId ? 'Ya existe: usa la pantalla de campañas' : 'Aún no preparado'}</ReviewField>
    </ReviewFields>
    <ReviewNote ok={preview.matches}>{!preview.matches
      ? 'El paso cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se preparará el borrador para tu revisión; no se enviará nada.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y preparar" disabled={!preview.matches} resolving={resolving} />
  </div>;
}
