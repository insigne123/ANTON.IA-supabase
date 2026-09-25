'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote, ReviewPaper } from './ReviewParts';

type Preview = {
  from: string; provider: string;
  to: string | null; toName: string | null; subject: string | null; text: string | null;
  revision: number; versionId: string; matches: boolean; label: string;
};

/** Version-bound send review: shows the live draft and whether it still
 * matches the approved version. A mismatch blocks approval. */
export function SendReview({ runId, draftId, onApprove, onReject, resolving }: {
  runId: string; draftId: string;
  onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    fetch(`/api/cowork/runs/${runId}/send-preview?draftId=${encodeURIComponent(draftId)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId, draftId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando versión exacta a enviar…" />;
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="De">{preview.from} · {preview.provider === 'google' ? 'Gmail' : 'Outlook'}</ReviewField>
      <ReviewField label="Para">{preview.toName ? `${preview.toName} · ` : ''}{preview.to || 'Sin destinatario'}</ReviewField>
      <ReviewField label="Asunto"><span className="font-medium">{preview.subject || 'Sin asunto'}</span></ReviewField>
    </ReviewFields>
    <ReviewPaper>{preview.text || 'Sin contenido'}</ReviewPaper>
    <ReviewNote ok={preview.matches}>Revisión {preview.revision} · {preview.matches
      ? 'Coincide con la versión propuesta. Al aprobar se verificará supresión, dominio, conexión y cuota de nuevo.'
      : 'El borrador cambió desde la propuesta. Descártala y pide una nueva revisión.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y enviar" disabled={!preview.matches} resolving={resolving} />
  </div>;
}
