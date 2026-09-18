'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando versión exacta a enviar…</p>;
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">De</dt><dd className="break-words">{preview.from} · {preview.provider === 'google' ? 'Gmail' : 'Outlook'}</dd></div>
      <div><dt className="font-medium">Para</dt><dd>{preview.toName ? `${preview.toName} · ` : ''}{preview.to || 'Sin destinatario'}</dd></div>
      <div><dt className="font-medium">Asunto</dt><dd>{preview.subject || 'Sin asunto'}</dd></div>
    </dl>
    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-4 text-sm leading-6">{preview.text || 'Sin contenido'}</div>
    <p className="text-xs text-muted-foreground">Revisión {preview.revision} · {preview.matches
      ? 'Coincide con la versión propuesta. Al aprobar se verificará supresión, dominio, conexión y cuota de nuevo.'
      : 'El borrador cambió desde la propuesta. Descártala y pide una nueva revisión.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Aprobar y enviar'}</Button>
    </div>
  </div>;
}
