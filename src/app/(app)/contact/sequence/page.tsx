'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { ResearchSequenceViewSchema, type ResearchSequenceView } from '@/lib/research-sequence-contracts';

const labels = { queued: 'En espera', running: 'Preparando', ready: 'Guardado', error: 'Pendiente de reintento' };
const stages = { brief: 'Definiendo el tema de los correos', initial: 'Preparando el contacto inicial', follow_ups: 'Preparando los seguimientos', editorial: 'Revisando la secuencia completa', done: 'Preparación terminada' };

type SequenceSlot = ResearchSequenceView['slots'][number];

function SequenceEmailEditor({ slot, onSaved }: { slot: SequenceSlot; onSaved: () => Promise<unknown> }) {
  const [saved, setSaved] = useState({ versionId: slot.versionId, subject: slot.subject || '', body: slot.body || '' });
  const [subject, setSubject] = useState(slot.subject || '');
  const [body, setBody] = useState(slot.body || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = subject !== saved.subject || body !== saved.body;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (dirty || slot.versionId === saved.versionId) return;
    const next = { versionId: slot.versionId, subject: slot.subject || '', body: slot.body || '' };
    setSaved(next);
    setSubject(next.subject);
    setBody(next.body);
  }, [dirty, saved.versionId, slot.versionId, slot.subject, slot.body]);

  async function save() {
    if (!slot.draftId || !saved.versionId || saving || !dirty) return;
    if (!subject.trim() || !body.trim()) { setFeedback('Completa el asunto y el mensaje antes de guardar.'); return; }
    setSaving(true);
    setFeedback('');
    try {
      const response = await fetch(`/api/native-drafts/${encodeURIComponent(slot.draftId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersionId: saved.versionId, subject: subject.trim(), text: body.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 409 && payload?.error === 'NATIVE_DRAFT_VERSION_CONFLICT') {
        setConflict(true);
        setFeedback('Este correo cambió en otra pantalla. Copia tus cambios antes de cargar la versión actual.');
        return;
      }
      if (!response.ok || !payload?.draft?.versionId) throw new Error(
        payload?.error === 'NATIVE_DRAFT_PRIVACY_SUPPRESSED' ? 'Este contacto ya no admite mensajes.'
          : payload?.error === 'NATIVE_DRAFT_ARCHIVED' ? 'Este correo está archivado y no se puede editar.'
            : payload?.message || 'No pudimos guardar este correo.',
      );
      setSaved({ versionId: payload.draft.versionId, subject: subject.trim(), body: body.trim() });
      setSubject(subject.trim());
      setBody(body.trim());
      setFeedback('Cambios guardados. La secuencia requiere una nueva revisión.');
      try { await onSaved(); } catch { setFeedback('Guardado, pero no pudimos actualizar el progreso. Usa «Actualizar progreso».'); }
    } catch (failure) { setFeedback(failure instanceof Error ? failure.message : 'No pudimos guardar este correo.'); }
    finally { setSaving(false); }
  }

  async function reload() {
    if (!slot.draftId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/native-drafts/${encodeURIComponent(slot.draftId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft?.versionId) throw new Error('No pudimos cargar la versión actual.');
      const next = { versionId: payload.draft.versionId, subject: payload.draft.content.subject || '', body: payload.draft.content.text || payload.draft.content.html || '' };
      setSaved(next); setSubject(next.subject); setBody(next.body); setConflict(false); setFeedback('Versión actual cargada.');
      await onSaved();
    } catch (failure) { setFeedback(failure instanceof Error ? failure.message : 'No pudimos cargar la versión actual.'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-3">
    <div className="space-y-1.5"><Label htmlFor={`sequence-subject-${slot.index}`}>Asunto</Label><Input id={`sequence-subject-${slot.index}`} value={subject} onChange={(event) => { setSubject(event.target.value); setFeedback(''); }} disabled={saving || conflict} maxLength={255} /></div>
    <div className="space-y-1.5"><Label htmlFor={`sequence-body-${slot.index}`}>Mensaje</Label><Textarea id={`sequence-body-${slot.index}`} className="min-h-40 resize-y" value={body} onChange={(event) => { setBody(event.target.value); setFeedback(''); }} disabled={saving || conflict} maxLength={20_000} /></div>
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={() => void save()} disabled={saving || conflict || !dirty || !subject.trim() || !body.trim()}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
      {dirty && !conflict && <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setSubject(saved.subject); setBody(saved.body); setFeedback(''); }}>Descartar cambios</Button>}
      {conflict && <Button size="sm" variant="outline" disabled={saving} onClick={() => void reload()}>Cargar versión actual</Button>}
      <span role={conflict ? 'alert' : 'status'} className={`text-xs ${conflict || dirty ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{feedback || (dirty ? 'Cambios sin guardar' : '')}</span>
    </div>
  </div>;
}

function SequencePreparation() {
  const jobId = useSearchParams().get('jobId');
  const router = useRouter();
  const [view, setView] = useState<ResearchSequenceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [steerInstruction, setSteerInstruction] = useState('');
  const [steering, setSteering] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/research-sequences?jobId=${encodeURIComponent(jobId || '')}`, { cache: 'no-store', signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No pudimos actualizar el progreso.');
    const next = ResearchSequenceViewSchema.parse(payload);
    if (!signal?.aborted) { setView(next); setError(null); }
    return next;
  }, [jobId]);

  useEffect(() => { setView(null); }, [jobId]);

  useEffect(() => {
    if (!jobId) { setError('Falta la preparación. Vuelve a la investigación para crearla.'); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let finished = false;
      try {
        const next = await load(controller.signal);
        finished = ['completed', 'failed', 'review_required'].includes(next.status);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No pudimos actualizar el progreso.');
      }
      if (!controller.signal.aborted && !finished) timer = setTimeout(poll, 5_000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, load, refreshKey]);

  async function retry() {
    setRetrying(true);
    try {
      const response = await fetch('/api/research-sequences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }) });
      if (!response.ok) throw new Error('No pudimos reanudar la preparación. Inténtalo nuevamente.');
      setRefreshKey((key) => key + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No pudimos reanudar.'); }
    finally { setRetrying(false); }
  }

  async function steer() {
    const instruction = steerInstruction.trim();
    if (!view?.researchSnapshotId || !instruction || steering) return;
    setSteering(true);
    setSteerError(null);
    try {
      const response = await fetch('/api/research-sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ researchSnapshotId: view.researchSnapshotId, styleProfileId: view.styleProfileId, followUpCount: view.followUpCount, instruction }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.id) throw new Error(payload?.error || 'No pudimos preparar otra versión.');
      router.push(`/contact/sequence?jobId=${encodeURIComponent(payload.id)}`);
    } catch (failure) { setSteerError(failure instanceof Error ? failure.message : 'No pudimos preparar otra versión.'); }
    finally { setSteering(false); }
  }

  const ready = view?.slots.filter((slot) => slot.status === 'ready').length || 0;
  const slots = view?.slots || [{ index: 0, name: 'Contacto inicial', status: 'queued' as const, subject: null, body: null, draftId: null, versionId: null }];
  const total = view?.slots.length || 1;
  const composeId = view?.slots[0].draftId;
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tu secuencia de contacto</h1>
        <p className="text-sm text-muted-foreground">Un correo inicial{view?.followUpCount ? ` y ${view.followUpCount} ${view.followUpCount === 1 ? 'seguimiento' : 'seguimientos'}` : ''}. Se guardan como borradores; preparar no envía ningún correo.</p>
      </header>
      <section aria-label="Progreso de preparación" className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <p role="status" aria-live="polite" className="text-sm text-foreground">
          {ready} de {total} {total === 1 ? 'correo guardado' : 'correos guardados'} · {view ? view.status === 'review_required' ? 'Hay ajustes para revisar' : view.status === 'failed' ? 'Preparación interrumpida' : view.status === 'retry_scheduled' ? 'Reintentaremos automáticamente' : stages[view.stage] : 'Cargando preparación'}
        </p>
        <Progress value={ready / total * 100} aria-label={`${ready} de ${total} correos guardados`} />
        <p className="text-sm text-muted-foreground">Puedes cerrar esta página y volver a esta dirección. El progreso queda guardado.</p>
        {view?.editorial?.passed && <p className="text-sm text-foreground">Revisión editorial completa. Los correos siguen pendientes de tu aprobación.</p>}
        {view?.editorial && view.editorial.issues.length > 0 && <ul className="list-disc space-y-2 pl-5 text-sm text-foreground">{view.editorial.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
        {view?.error && <p className="text-sm text-foreground">{view.error}</p>}
        <div className="flex flex-wrap gap-2">
          {composeId && view && ['completed', 'review_required', 'failed'].includes(view.status) && <Button asChild><Link href={`/contact/compose?draftId=${encodeURIComponent(composeId)}`}>Revisar y editar correos</Link></Button>}
          {view && ['failed', 'review_required', 'completed'].includes(view.status) && <Button variant={composeId ? 'outline' : 'default'} onClick={() => void retry()} disabled={retrying}>{retrying ? 'Reanudando…' : view.status === 'failed' ? 'Reintentar pendientes' : 'Revisar secuencia nuevamente'}</Button>}
        </div>
        {view?.researchSnapshotId && (
          <div className="space-y-2 border-t border-border pt-3">
            <Label htmlFor="sequence-steer">Pedir otra versión a la IA</Label>
            <Textarea
              id="sequence-steer"
              rows={2}
              maxLength={1000}
              value={steerInstruction}
              onChange={(event) => setSteerInstruction(event.target.value)}
              placeholder="Ej. más directa, sin tecnicismos, con otro ángulo…"
            />
            {steerError && <p role="alert" className="text-sm text-foreground">{steerError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void steer()} disabled={steering || !steerInstruction.trim()}>{steering ? 'Preparando…' : 'Preparar otra versión'}</Button>
              <p className="text-xs text-muted-foreground">Prepara una secuencia nueva con tus indicaciones; la actual se conserva.</p>
            </div>
          </div>
        )}
      </section>
      {error && <div role="alert" className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm text-foreground"><p>{error}</p><Button variant="outline" onClick={() => setRefreshKey((key) => key + 1)}>Actualizar progreso</Button></div>}
      <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {slots.map((slot) => <li key={slot.index} className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-medium text-foreground">{slot.index + 1}. {slot.name}</h2><span className="text-sm text-muted-foreground">{labels[slot.status]}</span></div>
          {slot.draftId && slot.versionId ? <SequenceEmailEditor key={slot.draftId} slot={slot} onSaved={() => load()} /> : <p className="text-sm text-muted-foreground">{slot.status === 'running' ? 'Estamos redactando este correo.' : 'El correo aparecerá aquí cuando esté guardado.'}</p>}
        </li>)}
      </ol>
    </main>
  );
}

export default function ResearchSequencePage() {
  return <Suspense fallback={<p role="status" className="p-6 text-muted-foreground">Cargando preparación…</p>}><SequencePreparation /></Suspense>;
}
