'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewChips, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  op: 'create' | 'update' | 'delete'; matches: boolean;
  name?: string | null; criteria?: unknown; isShared?: boolean;
  current?: { id: string; name: string; is_shared: boolean } | null;
  label: string;
};

const CRITERIA_LABELS: Record<string, string> = {
  title: 'Cargo', titles: 'Cargos', industries: 'Sectores', industry: 'Sector', locations: 'Ubicación', location: 'Ubicación',
  seniorities: 'Nivel', employeeRanges: 'Empleados', companyDomains: 'Dominios', companyLocations: 'Ubicación de la empresa',
  keywords: 'Palabras clave', limit: 'Límite', target: 'Buscar',
};

function CriteriaValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <ReviewChips values={value} />;
  if (value && typeof value === 'object') return <span className="font-cw-mono text-[12.5px] text-cw-muted">{JSON.stringify(value)}</span>;
  return <span>{String(value ?? '')}</span>;
}

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
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando cambio exacto de la búsqueda…" />;
  const title = preview.op === 'create' ? 'Guardar búsqueda'
    : preview.op === 'update' ? 'Actualizar búsqueda' : 'Eliminar búsqueda';
  const criteria = preview.criteria && typeof preview.criteria === 'object' && !Array.isArray(preview.criteria)
    ? Object.entries(preview.criteria as Record<string, unknown>).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))
    : [];
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Acción">{title}</ReviewField>
      {(preview.name || preview.current?.name) && <ReviewField label="Nombre"><span className="font-medium">{preview.name || preview.current?.name}</span></ReviewField>}
      {preview.op !== 'delete' && <ReviewField label="Compartida">{preview.isShared ? 'Sí, con tu equipo' : 'No, solo tú'}</ReviewField>}
      {criteria.map(([key, value]) => <ReviewField key={key} label={CRITERIA_LABELS[key] || key}><CriteriaValue value={value} /></ReviewField>)}
    </ReviewFields>
    <ReviewNote ok={preview.matches}>{preview.matches
      ? 'Coincide con la propuesta. No se ejecutará ninguna búsqueda ni se consumirán créditos.'
      : 'La propuesta cambió desde la revisión. Descártala y pide una nueva.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={title} disabled={!preview.matches} resolving={resolving} />
  </div>;
}
