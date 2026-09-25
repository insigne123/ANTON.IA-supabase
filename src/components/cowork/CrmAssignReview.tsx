'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  op: 'assign' | 'claim' | 'release'; leadId: string;
  assignedToUserId: string | null; assignedToName: string | null; minutes: number | null;
  current: { assigned_to_user_id: string | null; claimed_by_user_id: string | null;
    claim_expires_at: string | null; contact_state: string | null } | null;
  names: Record<string, string>;
  matches: boolean; fresh: boolean; label: string;
};

/** Collaboration review card: shows the exact staged change pinned by the
 * proposal target. Drift or concurrent edits block approval. */
export function CrmAssignReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/crmassign-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando cambio exacto de colaboración…" />;
  const title = preview.op === 'assign' ? 'Asignar contacto' : preview.op === 'claim' ? 'Reservar contacto' : 'Liberar reserva';
  const nameOf = (id: string | null) => (id ? preview.names[id] || 'Otro miembro del equipo' : 'Nadie');
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Acción">{title}</ReviewField>
      {preview.op === 'assign' && <ReviewField label="Asignar a"><span className="font-medium">{preview.assignedToName || 'Miembro del equipo'}</span></ReviewField>}
      {preview.op === 'claim' && <ReviewField label="Reserva">{preview.minutes} minutos</ReviewField>}
      <ReviewField label="Responsable actual">{nameOf(preview.current?.assigned_to_user_id || null)}</ReviewField>
      <ReviewField label="Reserva actual">{nameOf(preview.current?.claimed_by_user_id || null)}</ReviewField>
    </ReviewFields>
    <ReviewNote ok={preview.matches}>{!preview.matches
      ? 'La colaboración cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Se aplicará la misma regla que usa la pantalla de colaboración.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={title} disabled={!preview.matches} resolving={resolving} />
  </div>;
}
