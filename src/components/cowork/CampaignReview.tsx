'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = {
  kind: string; label: string; name: string;
  objective?: string; provider?: string;
  messages?: Array<{ subject: string; body: string; delayDays: number }>;
  emails?: string[]; matched?: number;
  status?: string; revision?: number; recipients?: number; matches?: boolean;
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
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!preview) return <p role="status" className="text-sm text-muted-foreground">Cargando propuesta de campaña…</p>;
  const approveLabel = preview.kind === 'campaign_create' ? 'Crear borrador pausado'
    : preview.kind === 'campaign_activate' ? 'Aprobar y activar' : 'Pausar campaña';
  const blocked = preview.kind !== 'campaign_create' && preview.matches === false;
  return <div className="space-y-3">
    <p className="text-sm font-medium">{preview.name}</p>
    {preview.kind === 'campaign_create' ? <>
      {preview.objective ? <p className="text-sm text-muted-foreground">{preview.objective}</p> : null}
      <dl className="space-y-2 text-sm">
        <div><dt className="font-medium">Destinatarios ({preview.matched} de {(preview.emails || []).length} disponibles)</dt><dd className="break-words">{(preview.emails || []).join(', ')}</dd></div>
      </dl>
      {(preview.messages || []).map((message, index) => <div key={index} className="space-y-1 rounded-lg bg-muted/50 p-4">
        <p className="text-sm font-medium">{index + 1}. {message.subject}{message.delayDays > 0 ? ` (+${message.delayDays}d)` : ''}</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
      </div>)}
      <p className="text-xs text-muted-foreground">Se crea pausada como borrador en {(preview.provider === 'outlook' ? 'Outlook' : 'Gmail')}. Activarla requiere otra revisión.</p>
    </> : <>
      <p className="text-sm text-muted-foreground">Estado actual: {preview.status} · {preview.recipients} destinatarios · rev {preview.revision}</p>
      {(preview.emails || []).length > 0 && <p className="break-words text-sm text-muted-foreground">{(preview.emails || []).join(', ')}</p>}
      <p className="text-xs text-muted-foreground">{blocked
        ? 'La campaña cambió desde la propuesta. Descártala y pide una nueva revisión.'
        : 'Al aprobar se verifican de nuevo audiencia, bajas y cada mensaje.'}</p>
    </>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={resolving} onClick={onReject}>Descartar</Button>
      <Button disabled={resolving || blocked} onClick={onApprove}>{resolving ? 'Guardando…' : approveLabel}</Button>
    </div>
  </div>;
}
