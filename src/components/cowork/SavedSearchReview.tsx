'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = {
  op: 'create' | 'update' | 'delete'; matches: boolean;
  name?: string | null; criteria?: unknown; isShared?: boolean;
  current?: { id: string; name: string; is_shared: boolean } | null;
  label: string;
};

/** Saved-search review card: shows the exact staged change pinned by the
 * proposal target. A mismatch blocks approval. Never runs a search. */
export function SavedSearchReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    fetch(`/api/cowork/runs/${runId}/savedsearch-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando cambio exacto de la búsqueda…</p>;
  const title = preview.op === 'create' ? 'Guardar búsqueda'
    : preview.op === 'update' ? 'Actualizar búsqueda' : 'Eliminar búsqueda';
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      <div><dt className="font-medium">Acción</dt><dd>{title}</dd></div>
      {(preview.name || preview.current?.name) && <div><dt className="font-medium">Nombre</dt>
        <dd className="break-words">{preview.name || preview.current?.name}</dd></div>}
      {preview.op !== 'delete' && <div><dt className="font-medium">Compartida</dt>
        <dd>{preview.isShared ? 'Sí' : 'No'}</dd></div>}
      {preview.criteria !== undefined && preview.criteria !== null && <div><dt className="font-medium">Criterios</dt>
        <dd className="whitespace-pre-wrap break-words font-mono text-[13px] text-muted-foreground">{JSON.stringify(preview.criteria, null, 2)}</dd></div>}
    </dl>
    <p className="text-xs text-muted-foreground">{preview.matches
      ? 'Coincide con la propuesta. No se ejecutará ninguna búsqueda ni se consumirán créditos.'
      : 'La propuesta cambió desde la revisión. Descártala y pide una nueva.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : title}</Button>
    </div>
  </div>;
}
