'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  matches: boolean; label: string; campaignName: string | null; campaignStatus: string | null;
  recipientName: string | null; recipientEmail: string | null; enrollmentStatus: string; stoppable: boolean;
};

/** Campaign-stop review card: shows the exact enrollment pinned by the
 * proposal target with its current state. A changed state blocks approval. */
export function CampaignStopReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    fetch(`/api/cowork/runs/${runId}/campaign-stop-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando seguimiento exacto a detener…" />;
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Campaña">{preview.campaignName || '—'} <span className="text-cw-muted">({preview.campaignStatus || '—'})</span></ReviewField>
      <ReviewField label="Destinatario">{preview.recipientName ? `${preview.recipientName} · ` : ''}{preview.recipientEmail}</ReviewField>
      <ReviewField label="Estado actual">{preview.enrollmentStatus}</ReviewField>
    </ReviewFields>
    <ReviewNote ok={preview.stoppable}>{preview.stoppable
      ? 'Se omitirán los pasos pendientes. Lo ya enviado no se revierte.'
      : 'El seguimiento ya cambió de estado; descarta la propuesta.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Detener seguimiento" disabled={!preview.matches || !preview.stoppable} resolving={resolving} />
  </div>;
}
