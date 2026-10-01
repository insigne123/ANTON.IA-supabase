'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { ReviewActions, ReviewChips, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';
import { CoworkEmailFields } from './CoworkBlocks';
import { CampaignPeople, type CampaignPerson } from './CampaignPeople';
import { CwButton } from './ui';

type Preview = {
  kind: string; label: string; name: string;
  objective?: string; provider?: string;
  messages?: Array<{ subject: string; body: string; delayDays: number }>;
  emails?: string[]; matched?: number; edits?: number;
  status?: string; revision?: number; recipients?: number; matches?: boolean;
  definitionHash?: string;
  /** Each recipient with the first email they will receive (servers before Plan 5 PR-6 send only `emails`). */
  people?: CampaignPerson[];
  relationship?: 'never_contacted' | 'previously_contacted';
};

const STATUS: Record<string, string> = {
  draft: 'Borrador · no envía nada', paused: 'Pausada · no envía nada', active: 'Activa', approved: 'Aprobada', completed: 'Terminada', cancelled: 'Cancelada',
};

/** Campaign review card: staged definition with each person's first email and the
 * live audience for creation, current state with hash match for activate/pause. */
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
  // One person's first email open for editing (CampaignPeople): approving waits for it.
  const [editingPerson, setEditingPerson] = useState(false);
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
        body: JSON.stringify({ expectedHash: preview?.definitionHash, messages: draft.map(item => ({ subject: item.subject.trim(), body: item.body.trim() })) }),
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
  const approveLabel = preview.kind === 'campaign_create' ? 'Crear campaña sin enviar'
    : preview.kind === 'campaign_activate' ? 'Aprobar y activar' : 'Pausar campaña';
  const blocked = preview.kind !== 'campaign_create' && preview.matches === false;
  const channel = preview.provider === 'outlook' ? 'Outlook' : 'Gmail';
  const people = preview.people;
  const total = (preview.emails || []).length;
  const unavailable = people ? people.filter(person => !person.available || !person.first).length : total - (preview.matched ?? total);
  const own = (people || []).filter(person => person.personal).length;
  let day = 1;
  return <div className="space-y-4">
    <div>
      <p className="text-[15px] font-semibold tracking-tight">{preview.name}</p>
      {preview.kind === 'campaign_create' && preview.objective ? <p className="mt-1 text-[13.5px] leading-5 text-cw-muted">{preview.objective}</p> : null}
    </div>
    {preview.kind === 'campaign_create' ? <>
      <ReviewFields>
        {people
          ? <ReviewField label="Para">{total === 1 ? '1 persona' : `${total} personas`}{unavailable ? ` · ${unavailable === 1 ? '1 necesita' : `${unavailable} necesitan`} revisión` : ''}</ReviewField>
          : <ReviewField label={`Destinatarios (${preview.matched} de ${total})`}><ReviewChips values={preview.emails} empty="Sin destinatarios" /></ReviewField>}
        <ReviewField label="Canal">{channel}</ReviewField>
      </ReviewFields>
      {people && people.length > 0 && <CampaignPeople runId={runId} people={people} objective={preview.objective || ''}
        relationship={preview.relationship || 'never_contacted'} definitionHash={preview.definitionHash} locked={Boolean(draft)}
        onSaved={async () => { setPreview(await load()); }} onEditingChange={setEditingPerson} />}
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
          <h3 className="text-[12.5px] font-medium text-cw-muted">{people
            ? `Secuencia para todos · ${(preview.messages || []).length === 1 ? '1 correo' : `${(preview.messages || []).length} correos`}`
            : (preview.messages || []).length === 1 ? 'Correo' : `${(preview.messages || []).length} correos`}{preview.edits ? ' · editada por ti' : ''}</h3>
          <CwButton variant="secondary" size="xs" disabled={editingPerson} onClick={() => { setSaved(false); setDraft((preview.messages || []).map(message => ({ subject: message.subject, body: message.body }))); }}>
            <Pencil aria-hidden="true" />{people ? 'Editar secuencia' : 'Editar correos'}
          </CwButton>
        </div>
        {people && <p className="text-[12.5px] leading-5 text-cw-muted">
          {'{{nombre}}, {{empresa}} y {{cargo}} se completan con los datos de cada persona.'}
          {own === 0 ? '' : own === people.length ? ' Cada persona tiene su propio correo 1, así que el de la secuencia no se usa.'
            : ' El correo 1 de la secuencia va solo a quienes no tienen uno propio.'}
        </p>}
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
      <ReviewNote>Al aprobar, la campaña queda guardada sin enviar en {channel}: nada sale hasta que la actives, y activarla pide otra aprobación.</ReviewNote>
    </> : <>
      <ReviewFields>
        <ReviewField label="Estado actual">{STATUS[String(preview.status)] || preview.status} · revisión {preview.revision}</ReviewField>
        <ReviewField label="Destinatarios">{preview.recipients}</ReviewField>
        {(preview.emails || []).length > 0 && <ReviewField label="Correos"><ReviewChips values={preview.emails} /></ReviewField>}
      </ReviewFields>
      <ReviewNote ok={!blocked}>{blocked
        ? 'La campaña cambió desde la propuesta. Descártala y pide una nueva revisión.'
        : preview.kind === 'campaign_activate'
          ? 'Al aprobar empiezan los envíos según su calendario. Antes se verifican de nuevo audiencia, bajas y cada mensaje.'
          : 'Al aprobar se detienen los envíos que faltan. Lo que ya se envió no se revierte.'}</ReviewNote>
    </>}
    {(draft || editingPerson) && <p className="text-right text-[12px] text-cw-muted">Guarda o cancela tus cambios antes de aprobar.</p>}
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={approveLabel} disabled={blocked || Boolean(draft) || editingPerson} resolving={resolving} resolvingLabel="Guardando…" />
  </div>;
}
