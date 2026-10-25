'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Pencil } from 'lucide-react';
import { EmailReviewNote, ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote, ReviewPaper, type EmailReview } from './ReviewParts';
import { CwButton } from './ui';
import { cn } from '@/lib/utils';

type Preview = {
  from: string; provider: string;
  to: string | null; toName: string | null; subject: string | null; text: string | null;
  revision: number; versionId: string; matches: boolean; label: string;
  /** Whether «Editar» can save a correction now (COW-29): the proposal waits on this version. */
  editable?: boolean;
  /** What the automatic read found in the email (COWORK_EMAIL_REVIEW); absent when it is off or did not answer. */
  review?: EmailReview | null;
};

const field = 'w-full rounded-lg border border-cw-border-strong bg-cw-elevated px-2.5 text-[13.5px] text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-60';

/** Version-bound send review: shows the live draft and whether it still
 * matches the approved version. A mismatch blocks approval. «Editar» corrects the subject or the body in the card and the
 * approval moves to that version (COW-29), instead of a whole new turn of the model for a comma. */
export function SendReview({ runId, draftId, onApprove, onReject, resolving }: {
  runId: string; draftId: string;
  onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const ids = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ subject: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [edited, setEdited] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/cowork/runs/${runId}/send-preview?draftId=${encodeURIComponent(draftId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
    return data as Preview;
  }, [runId, draftId]);
  useEffect(() => {
    let disposed = false;
    load().then(data => { if (!disposed) setPreview(data); })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [load]);
  const save = async () => {
    if (!draft || !preview) return;
    setSaving(true); setSaveError('');
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/send-preview`, {
        method: 'PATCH', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, expectedVersionId: preview.versionId, subject: draft.subject, text: draft.text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar el cambio del correo.');
      setPreview(await load());
      setDraft(null);
      setEdited(Boolean(data.changed));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar el cambio del correo.');
    } finally {
      setSaving(false);
    }
  };
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando versión exacta a enviar…" />;
  const complete = Boolean(draft?.subject.trim() && draft.text.trim());
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="De">{preview.from} · {preview.provider === 'google' ? 'Gmail' : 'Outlook'}</ReviewField>
      <ReviewField label="Para">{preview.toName ? `${preview.toName} · ` : ''}{preview.to || 'Sin destinatario'}</ReviewField>
      {draft ? null : <ReviewField label="Asunto"><span className="font-medium">{preview.subject || 'Sin asunto'}</span></ReviewField>}
    </ReviewFields>
    {draft ? <div className="space-y-3">
      <div>
        <label htmlFor={`${ids}-subject`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Asunto</label>
        <input id={`${ids}-subject`} className={cn(field, 'h-9')} value={draft.subject} maxLength={200} autoFocus disabled={saving}
          onChange={event => setDraft({ ...draft, subject: event.target.value })} />
      </div>
      <div>
        <label htmlFor={`${ids}-text`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Correo</label>
        <textarea id={`${ids}-text`} className={cn(field, 'min-h-48 resize-y py-2 leading-6')} value={draft.text} maxLength={10_000} disabled={saving}
          onChange={event => setDraft({ ...draft, text: event.target.value })} />
      </div>
      {!complete && <p role="alert" className="text-[12.5px] text-cw-danger">El correo necesita asunto y texto.</p>}
      {saveError && <ReviewError message={saveError} />}
      <div className="flex flex-wrap justify-end gap-2">
        <CwButton variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(null); setSaveError(''); }}>Cancelar</CwButton>
        <CwButton size="sm" variant="primary" disabled={saving || !complete} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar cambios'}</CwButton>
      </div>
    </div> : <>
      <ReviewPaper>{preview.text || 'Sin contenido'}</ReviewPaper>
      {preview.editable && <div className="flex justify-end">
        <CwButton variant="secondary" size="xs" onClick={() => { setEdited(false); setDraft({ subject: preview.subject || '', text: preview.text || '' }); }}>
          <Pencil aria-hidden="true" />Editar correo
        </CwButton>
      </div>}
      <EmailReviewNote review={preview.review} against="contra tu oferta" />
    </>}
    {/* In plain words what the send checks again (COW-29); before: «Revisión 3 · …se verificará supresión, dominio, conexión y cuota». */}
    <ReviewNote ok={preview.matches}>{preview.matches
      ? `${edited ? 'Se enviará con tus cambios.' : 'Es el correo que Cowork propuso.'} Antes de enviarlo revisamos otra vez que la persona no haya pedido dejar de recibir correos, que su empresa no esté excluida, que tu correo siga conectado y que te quede cupo hoy.`
      : 'El borrador cambió después de la propuesta. Descártala y pídele a Cowork una nueva.'}</ReviewNote>
    {draft ? null : <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={edited ? 'Aprobar con cambios y enviar' : 'Aprobar y enviar'} disabled={!preview.matches} resolving={resolving} />}
  </div>;
}
