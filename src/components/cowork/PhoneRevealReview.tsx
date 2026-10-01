'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  name: string; title: string | null; company: string | null; cost: number; matches: boolean;
  balance: { remaining: number; stale: boolean; capturedAt: string } | null;
  /** Whether the last reading of the credits reaches; null when it could not be read. */
  affordable: boolean | null;
  /** Why the request can no longer be approved as proposed; null when it still can. */
  unavailable: string | null;
};

const number = (value: number) => value.toLocaleString('es-CL');

/**
 * Review card of a phone reveal: who, what it costs and what is left of the credits. It is the one Cowork action with a price per person, so
 * the cost is the first thing it says. Approving asks the provider for one number: it arrives later, in the enriched contacts.
 */
export function PhoneRevealReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/enrichphone-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Revisando el costo y tu saldo…" />;
  const blocked = !preview.matches || preview.affordable === false;
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Persona">{preview.name}{preview.title ? ` · ${preview.title}` : ''}{preview.company ? ` · ${preview.company}` : ''}</ReviewField>
      <ReviewField label="Costo"><span className="font-medium">{preview.cost} créditos</span> por este teléfono</ReviewField>
      <ReviewField label="Tu saldo">{preview.balance
        ? `${number(preview.balance.remaining)} créditos${preview.balance.stale ? ' (dato de hace varias horas: puede haber cambiado)' : ''}`
        : 'No pude leer tu saldo ahora'}</ReviewField>
    </ReviewFields>
    {preview.affordable === false && <ReviewNote ok={false}>Tu saldo no alcanza para este teléfono. Descarta la propuesta.</ReviewNote>}
    {preview.unavailable && <ReviewNote ok={false}>{preview.unavailable}</ReviewNote>}
    <ReviewNote ok={preview.matches}>{preview.matches
      ? 'Al aprobar se pide un solo teléfono al proveedor. Llega en unos minutos a tus contactos enriquecidos; no se le llama ni se le escribe. Revisa que tengas una base legal para contactarlo por teléfono: ANTON.IA no la verifica.'
      : 'Descarta la propuesta y pide una nueva.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={`Aprobar y gastar ${preview.cost} créditos`} disabled={blocked} resolving={resolving} />
  </div>;
}
