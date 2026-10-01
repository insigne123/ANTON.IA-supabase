'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  campaignName: string | null; count: number; matches: boolean;
  items: Array<{ email: string; touchNumber: number; status: string; error: string | null }>;
  /** Why the list can no longer be approved as proposed; null when it still is. */
  unavailable: string | null;
};

const STATUS: Record<string, string> = { failed: 'falló', deferred: 'quedó en espera', bounced: 'rebotó por algo pasajero' };

/**
 * Review card of a retry of failed sends: which ones would go back to the queue and why each one failed. The list is read again now: if
 * it is no longer the proposed one, approving is blocked. Approving sends nothing by itself: they go back to the queue of the campaign
 * sender, which keeps every guard it always has.
 */
export function CampaignRetryReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/campaignretry-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Revisando qué envíos se pueden reintentar…" />;
  return <div className="space-y-4">
    <ReviewField label={preview.campaignName ? `Campaña «${preview.campaignName}»` : 'Campaña'}>
      {preview.count} {preview.count === 1 ? 'envío vuelve' : 'envíos vuelven'} a la cola
    </ReviewField>
    <ul aria-label="Envíos a reintentar" className="divide-y divide-cw-border overflow-hidden rounded-xl border border-cw-border text-[13px]">
      {preview.items.map(item => <li key={`${item.email}-${item.touchNumber}`} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
        <span className="break-all font-medium text-cw-text">{item.email}</span>
        <span className="text-cw-muted">correo {item.touchNumber} · {STATUS[item.status] || 'no salió'}</span>
        {item.error && <span className="w-full text-[12px] text-cw-faint">{item.error}</span>}
      </li>)}
    </ul>
    {preview.unavailable && <ReviewNote ok={false}>{preview.unavailable}</ReviewNote>}
    <ReviewNote ok={preview.matches}>{preview.matches
      ? 'Al aprobar vuelven a la cola; no se envía nada en este momento. Salen con los frenos de siempre (cupo, una empresa por día, quien ya respondió o se dio de baja) y ninguno se envía dos veces.'
      : 'Descarta la propuesta y pide una nueva: la lista cambió.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y reintentar" disabled={!preview.matches || preview.count === 0} resolving={resolving} />
  </div>;
}
