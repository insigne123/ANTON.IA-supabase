'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = {
  gid: string; patch: Record<string, unknown>; current: Record<string, unknown> | null;
  matches: boolean; fresh: boolean; label: string;
};

const LABELS: Record<string, string> = {
  stage: 'Etapa', owner: 'Responsable de ficha', notes: 'Notas',
  next_action: 'Próxima acción', next_action_type: 'Tipo de acción',
  next_action_due_at: 'Fecha de acción', meeting_link: 'Enlace de reunión',
};

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando cambio exacto de la ficha…</p>;
  const entries = Object.entries(preview.patch || {});
  return <div className="space-y-3">
    <p className="break-words text-sm text-muted-foreground">{preview.gid}</p>
    <dl className="space-y-2 text-sm">
      {entries.map(([key, value]) => <div key={key}>
        <dt className="font-medium">{LABELS[key] || key}</dt>
        <dd className="whitespace-pre-wrap break-words text-muted-foreground">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
      </div>)}
    </dl>
    <p className="text-xs text-muted-foreground">{!preview.matches
      ? 'La ficha cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se aplicarán exactamente estos valores. No reasigna responsables del equipo.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Aprobar y actualizar'}</Button>
    </div>
  </div>;
}
