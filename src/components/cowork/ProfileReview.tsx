'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando cambios exactos del perfil…</p>;
  const entries = Object.entries(preview.patch || {});
  return <div className="space-y-3">
    <dl className="space-y-2 text-sm">
      {entries.map(([key, value]) => <div key={key}>
        <dt className="font-medium">{LABELS[key] || key}</dt>
        <dd className="whitespace-pre-wrap break-words text-muted-foreground">{key === 'signatures'
          ? <SignatureValues value={value} /> : typeof value === 'string' ? value : JSON.stringify(value)}</dd>
      </div>)}
    </dl>
    <p className="text-xs text-muted-foreground">{!preview.matches
      ? 'Los valores cambiaron desde la propuesta. Descártala y pide una nueva revisión.'
      : !preview.fresh
        ? 'Tu perfil cambió desde la revisión. Descártala y pide una nueva revisión.'
        : 'Coincide con la propuesta. Al aprobar se aplicarán exactamente estos valores.'}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || !preview.matches || !preview.fresh} onClick={onApprove}>{resolving ? 'Guardando aprobación…' : 'Aprobar y actualizar'}</Button>
    </div>
  </div>;
}

function SignatureValues({ value }: { value: unknown }) {
  const signatures = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const extended = signatures.profile_extended && typeof signatures.profile_extended === 'object'
    ? signatures.profile_extended as Record<string, unknown> : {};
  const labels: Record<string, string> = { role: 'Cargo', sector: 'Sector', description: 'Descripción',
    services: 'Servicios', valueProposition: 'Propuesta de valor', proofPoints: 'Evidencias' };
  return <div className="space-y-3">
    {Object.entries(labels).map(([key, label]) => extended[key] ? <p key={key}>
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
          srcDoc={source} className="h-48 w-full rounded-md border border-border bg-background" />
        <details><summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2">Ver HTML guardado</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{config.html}</pre>
        </details>
      </div>;
    })}
  </div>;
}
