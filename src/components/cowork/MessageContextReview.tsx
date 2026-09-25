'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  patch: Record<string, unknown>; current: Record<string, unknown> | null;
  matches: boolean; fresh: boolean; label: string;
};

const LABELS: Record<string, string> = {
  voice_examples: 'Cómo suenan tus correos',
  prohibited_terms: 'Términos prohibidos',
  required_terms: 'Términos obligatorios',
  approved_claims: 'Afirmaciones aprobadas',
  trial_offer: 'Oferta de prueba',
  default_style_profile_id: 'Estilo por defecto',
  role_cta: 'Pedidos por rol',
  vertical_notes: 'Notas por sector',
};

/** Renderiza el parche como texto legible: nunca JSON crudo al usuario. */
function renderPatchItem(item: unknown, index: number) {
  if (typeof item === 'string') return <li key={index} className="whitespace-pre-wrap break-words">{item}</li>;
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    const text = ['text', 'note', 'claim', 'term', 'label', 'sector', 'evidence', 'cta'].map(key => record[key]).filter(value => typeof value === 'string' && value.trim());
    const detail = ['label', 'sector', 'role'].map(key => record[key]).filter(value => typeof value === 'string' && value.trim() && !text.includes(value as string));
    return <li key={index} className="whitespace-pre-wrap break-words">{text.join(' — ')}{detail.length > 0 ? <span className="text-cw-muted"> ({detail.join(', ')})</span> : null}</li>;
  }
  return <li key={index} className="whitespace-pre-wrap break-words">{String(item ?? '')}</li>;
}

function renderPatchValue(value: unknown) {
  if (typeof value === 'string') return <p className="whitespace-pre-wrap break-words">{value}</p>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-cw-muted">Sin cambios en este campo.</p>;
    return <ul className="list-disc space-y-1 pl-5">{value.map((item, index) => renderPatchItem(item, index))}</ul>;
  }
  if (value && typeof value === 'object') {
    return <ul className="list-disc space-y-1 pl-5">{Object.entries(value as Record<string, unknown>).map(([key, item], index) => <li key={index} className="whitespace-pre-wrap break-words"><span className="font-medium">{key}:</span> {typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul>;
  }
  return <p className="whitespace-pre-wrap break-words">{String(value ?? '')}</p>;
}

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
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando cambio exacto del contexto…" />;
  const entries = Object.entries(preview.patch || {});
  const isEmpty = (value: unknown) => value == null || (Array.isArray(value) && value.length === 0) || value === '';
  return <div className="space-y-4">
    <dl className="space-y-3 text-[13.5px]">
      {entries.map(([key, value]) => <div key={key} className="rounded-xl border border-cw-border bg-cw-panel px-3.5 py-3">
        <dt className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-cw-muted">{LABELS[key] || key}</dt>
        <dd className="mt-1.5 text-cw-text">{renderPatchValue(value)}</dd>
        <div className="mt-2 border-t border-cw-border pt-2 text-[12px] text-cw-muted">Actual: {preview.current && !isEmpty(preview.current[key]) ? renderPatchValue(preview.current[key]) : 'sin configurar'}</div>
      </div>)}
    </dl>
    <ReviewNote ok={preview.matches && preview.fresh}>{!preview.matches || !preview.fresh
      ? 'El contexto cambió desde la revisión. Descártala y pide una nueva.'
      : 'Coincide con la propuesta. Al aprobar se aplicarán exactamente estos valores al contexto de redacción de tu organización.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y actualizar" disabled={!preview.matches || !preview.fresh} resolving={resolving} />
  </div>;
}
