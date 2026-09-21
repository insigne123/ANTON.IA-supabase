'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando cambio exacto de colaboración…</p>;
  const title = preview.op === 'assign' ? 'Asignar contacto' : preview.op === 'claim' ? 'Reservar contacto' : 'Liberar reserva';
  const nameOf = (id: string | null) => (id ? preview.names[id] || id : 'Nadie');
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">Acción</dt><dd>{title}</dd></div>
      {preview.op === 'assign' && <div><dt className="font-medium">Asignar a</dt><dd>{preview.assignedToName || preview.assignedToUserId}</dd></div>}
      {preview.op === 'claim' && <div><dt className="font-medium">Reserva</dt><dd>{preview.minutes} minutos</dd></div>}
      <div><dt className="font-medium">Responsable actual</dt><dd>{nameOf(preview.current?.assigned_to_user_id || null)}</dd></div>
      <div><dt className="font-medium">Reserva actual</dt><dd>{nameOf(preview.current?.claimed_by_user_id || null)}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">{!preview.matches
      ? 'La colaboración cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Se aplicará la misma regla que usa la pantalla de colaboración.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : title}</Button>
    </div>
  </div>;
}
