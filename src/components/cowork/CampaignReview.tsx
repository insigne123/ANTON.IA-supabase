'use client';

import { useEffect, useState } from 'react';
import { ReviewActions, ReviewChips, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = {
  kind: string; label: string; name: string;
  objective?: string; provider?: string;
  messages?: Array<{ subject: string; body: string; delayDays: number }>;
  emails?: string[]; matched?: number;
  status?: string; revision?: number; recipients?: number; matches?: boolean;
};

const STATUS: Record<string, string> = {
  draft: 'Borrador', paused: 'Pausada', active: 'Activa', approved: 'Aprobada', completed: 'Terminada', cancelled: 'Cancelada',
};

/** Campaign review card: staged definition with live audience for creation,
 * current state with hash match for activate/pause. */
export function CampaignReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    fetch(`/api/cowork/runs/${runId}/campaign-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando propuesta de campaña…" />;
  const approveLabel = preview.kind === 'campaign_create' ? 'Crear borrador pausado'
    : preview.kind === 'campaign_activate' ? 'Aprobar y activar' : 'Pausar campaña';
  const blocked = preview.kind !== 'campaign_create' && preview.matches === false;
  let day = 1;
  return <div className="space-y-4">
    <div>
      <p className="text-[15px] font-semibold tracking-tight">{preview.name}</p>
      {preview.kind === 'campaign_create' && preview.objective ? <p className="mt-1 text-[13.5px] leading-5 text-cw-muted">{preview.objective}</p> : null}
    </div>
    {preview.kind === 'campaign_create' ? <>
      <ReviewFields>
        <ReviewField label={`Destinatarios (${preview.matched} de ${(preview.emails || []).length})`}><ReviewChips values={preview.emails} empty="Sin destinatarios" /></ReviewField>
        <ReviewField label="Canal">{preview.provider === 'outlook' ? 'Outlook' : 'Gmail'}</ReviewField>
      </ReviewFields>
      <ol className="space-y-2">
        {(preview.messages || []).map((message, index) => {
          if (index > 0) day += message.delayDays;
          return <li key={index}>
            <details className="group rounded-xl border border-cw-border bg-cw-panel" open={index === 0}>
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cw-elevated text-[12px] font-semibold text-cw-muted ring-1 ring-cw-border">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{message.subject}</span>
                <span className="shrink-0 text-[12px] text-cw-muted">{index === 0 ? 'Día 1' : `Día ${day} · +${message.delayDays}d`}</span>
              </summary>
              <p className="whitespace-pre-wrap break-words border-t border-cw-border px-4 py-3 text-[14px] leading-6">{message.body}</p>
            </details>
          </li>;
        })}
      </ol>
      <ReviewNote>Se crea pausada como borrador en {preview.provider === 'outlook' ? 'Outlook' : 'Gmail'}. Activarla requiere otra revisión.</ReviewNote>
    </> : <>
      <ReviewFields>
        <ReviewField label="Estado actual">{STATUS[String(preview.status)] || preview.status} · revisión {preview.revision}</ReviewField>
        <ReviewField label="Destinatarios">{preview.recipients}</ReviewField>
        {(preview.emails || []).length > 0 && <ReviewField label="Correos"><ReviewChips values={preview.emails} /></ReviewField>}
      </ReviewFields>
      <ReviewNote ok={!blocked}>{blocked
        ? 'La campaña cambió desde la propuesta. Descártala y pide una nueva revisión.'
        : 'Al aprobar se verifican de nuevo audiencia, bajas y cada mensaje.'}</ReviewNote>
    </>}
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={approveLabel} disabled={blocked} resolving={resolving} resolvingLabel="Guardando…" />
  </div>;
}
