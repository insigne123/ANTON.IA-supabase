'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = {
  patch: Record<string, unknown>; matches: boolean; fresh: boolean; label: string;
};

const LABELS: Record<string, string> = {
  voice_examples: 'Ejemplos de voz',
  prohibited_terms: 'Términos prohibidos',
  required_terms: 'Términos obligatorios',
  approved_claims: 'Afirmaciones aprobadas',
  trial_offer: 'Oferta de prueba',
  default_style_profile_id: 'Estilo por defecto',
  role_cta: 'Pedidos por rol',
  vertical_notes: 'Notas por sector',
};

/** Messaging-context review card: shows the exact staged patch pinned by the
 * proposal target. Drift or concurrent edits block approval. */
export function MessageContextReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/messagecontext-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando cambio exacto del contexto…</p>;
  const entries = Object.entries(preview.patch || {});
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      {entries.map(([key, value]) => <div key={key}>
        <dt className="font-medium">{LABELS[key] || key}</dt>
        <dd className="whitespace-pre-wrap break-words text-muted-foreground">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
      </div>)}
    </dl>
    <p className="text-xs text-muted-foreground">{!preview.matches || !preview.fresh
      ? 'El contexto cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se aplicarán exactamente estos valores al contexto de redacción de tu organización.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches || !preview.fresh} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Aprobar y actualizar'}</Button>
    </div>
  </div>;
}
