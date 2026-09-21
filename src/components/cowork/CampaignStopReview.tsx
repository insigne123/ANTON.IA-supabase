'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando seguimiento exacto a detener…</p>;
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">Campaña</dt><dd className="break-words">{preview.campaignName || '—'} <span className="text-muted-foreground">({preview.campaignStatus || '—'})</span></dd></div>
      <div><dt className="font-medium">Destinatario</dt><dd className="break-words">{preview.recipientName ? `${preview.recipientName} · ` : ''}{preview.recipientEmail}</dd></div>
      <div><dt className="font-medium">Estado actual</dt><dd>{preview.enrollmentStatus}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">{preview.stoppable
      ? 'Se omitirán los pasos pendientes. Lo ya enviado no se revierte.'
      : 'El seguimiento ya cambió de estado; descarta la propuesta.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches || !preview.stoppable} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Detener seguimiento'}</Button>
    </div>
  </div>;
}
