'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  gid: string; patch: Record<string, unknown>; current: Record<string, unknown> | null;
  matches: boolean; fresh: boolean; label: string;
};

const LABELS: Record<string, string> = {
  stage: 'Etapa', owner: 'Responsable de ficha', notes: 'Notas',
  next_action: 'Próxima acción', next_action_type: 'Tipo de acción',
  next_action_due_at: 'Fecha de acción', meeting_link: 'Enlace de reunión',
};

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return <span className="text-cw-muted">Vacío</span>;
  return <span className="whitespace-pre-wrap">{typeof value === 'string' ? value : JSON.stringify(value)}</span>;
}

/** CRM record review card: shows the exact staged change pinned by the
 * proposal target. Drift or concurrent edits block approval. Never reassigns
 * team collaboration; only the sheet-level record. */
export function CrmRecordReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/crmrecord-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando cambio exacto de la ficha…" />;
  const entries = Object.entries(preview.patch || {});
  return <div className="space-y-4">
    <ReviewFields>
      {entries.map(([key, value]) => <ReviewField key={key} label={LABELS[key] || key}>
        <span className="block">{display(value)}</span>
        {preview.current && key in preview.current && <span className="mt-0.5 block text-[12px] text-cw-muted">Antes: {display(preview.current[key])}</span>}
      </ReviewField>)}
    </ReviewFields>
    <ReviewNote ok={preview.matches}>{!preview.matches
      ? 'La ficha cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se aplicarán exactamente estos valores. No reasigna responsables del equipo.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y actualizar" disabled={!preview.matches} resolving={resolving} />
  </div>;
}
