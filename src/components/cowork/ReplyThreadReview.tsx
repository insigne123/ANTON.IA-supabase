'use client';

import { useEffect, useState } from 'react';
import { EmailReviewNote, ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote, ReviewPaper, type EmailReview } from './ReviewParts';

type Preview = {
  to: string; name: string | null; company: string | null; subject: string; body: string; matches: boolean;
  theirs: { text: string; complete: boolean } | null;
  /** Why the reply can no longer go out (someone answered meanwhile, the person unsubscribed…); null when it still can. */
  unavailable: string | null;
  /** What the automatic read found in the reply (COWORK_EMAIL_REVIEW); absent when it is off or did not answer. */
  review?: EmailReview | null;
};

/**
 * Review card of a reply to send inside a conversation: who it goes to, what they wrote and the exact text that would go out in
 * that thread. A staged reply that no longer matches the proposal, or a conversation that no longer takes a reply, blocks approval.
 */
export function ReplyThreadReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/replythread-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando la respuesta exacta a enviar…" />;
  const canApprove = preview.matches && !preview.unavailable;
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Para">{preview.name ? `${preview.name}${preview.company ? ` (${preview.company})` : ''} · ` : ''}<span className="break-all">{preview.to}</span></ReviewField>
      <ReviewField label="Asunto"><span className="font-medium">{preview.subject}</span></ReviewField>
    </ReviewFields>
    {preview.theirs?.text && <ReviewField label="Lo que escribió">
      <ReviewPaper>{preview.theirs.text}{preview.theirs.complete ? '' : ' (recortado)'}</ReviewPaper>
    </ReviewField>}
    <ReviewField label="Tu respuesta, tal como saldrá"><ReviewPaper>{preview.body}</ReviewPaper></ReviewField>
    {preview.unavailable && <ReviewNote ok={false}>{preview.unavailable} Descarta la propuesta.</ReviewNote>}
    <EmailReviewNote review={preview.review} against="contra lo que escribió y tu oferta" />
    <ReviewNote ok={preview.matches}>{preview.matches
      ? 'Coincide con la propuesta. Al aprobar se comprueba de nuevo que nadie la haya respondido ni se haya dado de baja, y sale en el hilo original desde tu correo.'
      : 'La respuesta cambió desde la propuesta. Descártala y pide una nueva.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y enviar en el hilo" disabled={!canApprove} resolving={resolving} />
  </div>;
}
