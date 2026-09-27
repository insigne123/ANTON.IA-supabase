'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { ReviewActions, ReviewChips, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';
import { CoworkEmailFields } from './CoworkBlocks';
import { CwButton } from './ui';

type Preview = {
  kind: string; label: string; name: string;
  objective?: string; provider?: string;
  messages?: Array<{ subject: string; body: string; delayDays: number }>;
  emails?: string[]; matched?: number; edits?: number;
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
  // Editing the emails before approving: only subjects and bodies change.
  const [draft, setDraft] = useState<Array<{ subject: string; body: string }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/cowork/runs/${runId}/campaign-preview`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
    return data as Preview;
  }, [runId]);
  useEffect(() => {
    let disposed = false;
    load().then(data => { if (!disposed) setPreview(data); })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [load]);
  async function save() {
    if (!draft || saving) return;
    setSaving(true); setSaveError('');
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/campaign-preview`, {
        method: 'PATCH', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: draft.map(item => ({ subject: item.subject.trim(), body: item.body.trim() })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar la edición.');
      setPreview(await load());
      setDraft(null);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar la edición.');
    } finally { setSaving(false); }
  }
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando propuesta de campaña…" />;
  const complete = !draft || draft.every(item => item.subject.trim() && item.body.trim());
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
      {draft
        ? <div className="space-y-4">
          {draft.map((item, index) => <div key={index} className="rounded-xl border border-cw-border bg-cw-panel p-3.5">
            <CoworkEmailFields step={item} index={index} total={draft.length} idPrefix={`cw-campaign-${runId}`}
              onChange={next => setDraft(draft.map((current, at) => at === index ? next : current))} />
          </div>)}
          {saveError && <p role="alert" className="text-[12.5px] text-cw-danger">{saveError}</p>}
          {!complete && <p role="alert" className="text-[12.5px] text-cw-danger">Cada correo necesita asunto y cuerpo.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <CwButton variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(null); setSaveError(''); }}>Cancelar</CwButton>
            <CwButton size="sm" variant="primary" disabled={saving || !complete} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar cambios'}</CwButton>
          </div>
        </div>
        : <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-medium text-cw-muted">{(preview.messages || []).length === 1 ? 'Correo' : `${(preview.messages || []).length} correos`}{preview.edits ? ' · editados por ti' : ''}</p>
          <CwButton variant="secondary" size="xs" onClick={() => { setSaved(false); setDraft((preview.messages || []).map(message => ({ subject: message.subject, body: message.body }))); }}>
            <Pencil aria-hidden="true" />Editar correos
          </CwButton>
        </div>
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
      {saved && <p role="status" className="text-[12.5px] text-cw-muted">Guardaste tus cambios: la campaña se crea con esta versión.</p>}
      </>}
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
    {draft && <p className="text-right text-[12px] text-cw-muted">Guarda o cancela tus cambios antes de aprobar.</p>}
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={approveLabel} disabled={blocked || Boolean(draft)} resolving={resolving} resolvingLabel="Guardando…" />
  </div>;
}
