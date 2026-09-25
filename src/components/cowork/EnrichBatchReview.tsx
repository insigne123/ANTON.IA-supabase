'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  leadIds: string[]; costEstimate: number;
  contacts: Array<{ id: string; name?: string | null; company?: string | null; hasEmail: boolean }>;
  contactsComplete: boolean; matches: boolean; label: string;
};

/** Enrich-batch review card: exact staged contacts and cost pinned by the
 * proposal target. Drift or missing contacts block approval. */
export function EnrichBatchReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/enrichbatch-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando lote exacto…" />;
  const ready = preview.matches && preview.contactsComplete;
  return <div className="space-y-4">
    <p className="text-[13.5px]">Costo estimado: <span className="font-semibold">{preview.costEstimate} crédito{preview.costEstimate === 1 ? '' : 's'}</span> de enriquecimiento <span className="text-cw-muted">(máximo 1 por contacto)</span></p>
    <ul className="divide-y divide-cw-border overflow-hidden rounded-xl border border-cw-border bg-cw-panel text-[13.5px]">
      {preview.contacts.map(contact => <li key={contact.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <span className="min-w-0 truncate"><span className="font-medium">{contact.name || 'Contacto'}</span><span className="text-cw-muted">{contact.company ? ` · ${contact.company}` : ''}</span></span>
        {contact.hasEmail && <span className="shrink-0 rounded-md bg-cw-success-soft px-1.5 py-0.5 text-[11.5px] font-medium text-cw-success">Ya tiene correo</span>}
      </li>)}
    </ul>
    <ReviewNote ok={ready}>{!ready
      ? 'El lote cambió desde la revisión o falta un contacto. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se consultará el correo de cada contacto; cada resultado queda con su estado individual y nada se inventa.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y enriquecer" disabled={!ready} resolving={resolving} />
  </div>;
}
