'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando lote exacto…</p>;
  const ready = preview.matches && preview.contactsComplete;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Costo estimado: {preview.costEstimate} crédito{preview.costEstimate === 1 ? '' : 's'} de enriquecimiento (máximo 1 por contacto).</p>
    <ul className="space-y-2 text-sm">
      {preview.contacts.map(contact => <li key={contact.id} className="break-words">
        <span className="font-medium">{contact.name || 'Contacto'}</span>
        <span className="text-muted-foreground">{contact.company ? ` · ${contact.company}` : ''}{contact.hasEmail ? ' · ya tiene correo' : ''}</span>
      </li>)}
    </ul>
    <p className="text-xs text-muted-foreground">{!ready
      ? 'El lote cambió desde la revisión o falta un contacto. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se consultará el correo de cada contacto; cada resultado queda con su estado individual y nada se inventa.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !ready} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Aprobar y enriquecer'}</Button>
    </div>
  </div>;
}
