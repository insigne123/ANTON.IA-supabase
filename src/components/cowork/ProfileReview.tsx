'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  patch: Record<string, unknown>; matches: boolean; fresh: boolean; label: string;
};

const LABELS: Record<string, string> = {
  full_name: 'Nombre', job_title: 'Cargo', company_name: 'Empresa',
  company_domain: 'Dominio', signatures: 'Perfil comercial y firmas',
};

/** Profile review card: shows the exact staged values pinned by the proposal
 * target. A mismatch or external edit blocks approval. */
export function ProfileReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/profile-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando cambios exactos del perfil…" />;
  const entries = Object.entries(preview.patch || {});
  return <div className="space-y-4">
    <ReviewFields>
      {entries.map(([key, value]) => <ReviewField key={key} label={LABELS[key] || key}>
        {key === 'signatures'
          ? <SignatureValues value={value} />
          : <span className="whitespace-pre-wrap">{typeof value === 'string' ? value : JSON.stringify(value)}</span>}
      </ReviewField>)}
    </ReviewFields>
    <ReviewNote ok={preview.matches && preview.fresh}>{!preview.matches
      ? 'Los valores cambiaron desde la propuesta. Descártala y pide una nueva revisión.'
      : !preview.fresh
        ? 'Tu perfil cambió desde la revisión. Descártala y pide una nueva revisión.'
        : 'Coincide con la propuesta. Al aprobar se aplicarán exactamente estos valores.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel="Aprobar y actualizar" disabled={!preview.matches || !preview.fresh} resolving={resolving} />
  </div>;
}

function SignatureValues({ value }: { value: unknown }) {
  const signatures = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const extended = signatures.profile_extended && typeof signatures.profile_extended === 'object'
    ? signatures.profile_extended as Record<string, unknown> : {};
  const labels: Record<string, string> = { role: 'Cargo', sector: 'Sector', description: 'Descripción',
    services: 'Servicios', valueProposition: 'Propuesta de valor', proofPoints: 'Evidencias' };
  return <div className="space-y-3">
    {Object.entries(labels).map(([key, label]) => extended[key] ? <p key={key} className="whitespace-pre-wrap">
      <span className="font-medium">{label}: </span>{Array.isArray(extended[key])
        ? (extended[key] as unknown[]).join('\n') : String(extended[key])}</p> : null)}
    {(['gmail', 'outlook'] as const).map(channel => {
      const config = signatures[channel] as { html?: unknown; enabled?: unknown } | undefined;
      if (!config || typeof config.html !== 'string') return null;
      const source = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" '
        + 'content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
        + '<style>:root{color-scheme:light dark}body{font:14px system-ui;overflow-wrap:anywhere}a{pointer-events:none}</style>'
        + '</head><body>' + config.html + '</body></html>';
      return <div key={channel} className="space-y-2">
        <p className="font-medium">Firma {channel === 'gmail' ? 'Gmail' : 'Outlook'} · {config.enabled === true ? 'Activada' : 'Desactivada'}</p>
        <iframe title={`Vista previa de la firma de ${channel}`} sandbox="" referrerPolicy="no-referrer"
          srcDoc={source} className="h-48 w-full rounded-xl border border-cw-border bg-cw-elevated" />
        <details><summary className="cursor-pointer rounded-sm text-[12.5px] text-cw-muted focus-visible:outline focus-visible:outline-2">Ver HTML guardado</summary>
          <pre className="cw-scroll mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-cw-panel p-3 font-cw-mono text-xs">{config.html}</pre>
        </details>
      </div>;
    })}
  </div>;
}
