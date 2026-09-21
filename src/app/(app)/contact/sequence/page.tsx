'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { ResearchSequenceViewSchema, type ResearchSequenceView } from '@/lib/research-sequence-contracts';

const labels = { queued: 'En espera', running: 'Preparando', ready: 'Guardado', error: 'Pendiente de reintento' };
const stages = { brief: 'Definiendo el tema de los cuatro correos', initial: 'Preparando el contacto inicial', follow_ups: 'Preparando los seguimientos', editorial: 'Revisando la secuencia completa', done: 'Preparación terminada' };

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
        body: JSON.stringify({ researchSnapshotId: view.researchSnapshotId, styleProfileId: view.styleProfileId, instruction }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.id) throw new Error(payload?.error || 'No pudimos preparar otra versión.');
      router.push(`/contact/sequence?jobId=${encodeURIComponent(payload.id)}`);
    } catch (failure) { setSteerError(failure instanceof Error ? failure.message : 'No pudimos preparar otra versión.'); }
    finally { setSteering(false); }
  }

  const ready = view?.slots.filter((slot) => slot.status === 'ready').length || 0;
  const slots = view?.slots || ['Contacto inicial', 'Respaldo', 'Segundo ángulo', 'Cierre'].map((name, index) => ({ index, name, status: 'queued' as const, subject: null, body: null, draftId: null, versionId: null }));
  const composeId = view?.slots[0].draftId;
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tu secuencia de contacto</h1>
        <p className="text-sm text-muted-foreground">Un correo inicial y tres seguimientos. Se guardan como borradores; preparar no envía ningún correo.</p>
      </header>
      <section aria-label="Progreso de preparación" className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <p role="status" aria-live="polite" className="text-sm text-foreground">
          {ready} de 4 correos guardados · {view ? view.status === 'review_required' ? 'Hay ajustes para revisar' : view.status === 'failed' ? 'Preparación interrumpida' : view.status === 'retry_scheduled' ? 'Reintentaremos automáticamente' : stages[view.stage] : 'Cargando preparación'}
        </p>
        <Progress value={ready * 25} aria-label={`${ready} de 4 correos guardados`} />
        <p className="text-sm text-muted-foreground">Puedes cerrar esta página y volver a esta dirección. El progreso queda guardado.</p>
        {view?.editorial?.passed && <p className="text-sm text-foreground">Revisión editorial completa. Los cuatro correos siguen pendientes de tu aprobación.</p>}
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
          {slot.subject ? <><h3 className="break-words text-sm font-medium text-foreground">{slot.subject}</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{slot.body}</p></> : <p className="text-sm text-muted-foreground">{slot.status === 'running' ? 'Estamos redactando este correo.' : 'El correo aparecerá aquí cuando esté guardado.'}</p>}
        </li>)}
      </ol>
    </main>
  );
}

export default function ResearchSequencePage() {
  return <Suspense fallback={<p role="status" className="p-6 text-muted-foreground">Cargando preparación…</p>}><SequencePreparation /></Suspense>;
}
