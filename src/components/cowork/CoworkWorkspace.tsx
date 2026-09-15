'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Download, FileText, History, Loader2, Plus, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { coworkDocumentSchema, type CoworkEvent, type CoworkRun } from '@/lib/cowork/contracts';

const labels: Record<CoworkRun['status'], string> = {
  queued: 'En cola', running: 'Preparando respuesta', waiting_approval: 'Esperando tu aprobación',
  completed: 'Completado', cancelled: 'Cancelado', failed: 'No se pudo completar',
};
type State = { run: CoworkRun; events: CoworkEvent[] };

export function CoworkWorkspace() {
  const [runs, setRuns] = useState<CoworkRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [ready, setReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<{ message: string; requestId: string; parentRunId: string | null } | null>(null);
  const documentButton = useRef<HTMLButtonElement>(null);
  const documentHeading = useRef<HTMLHeadingElement>(null);
  const active = state && ['queued', 'running', 'waiting_approval'].includes(state.run.status);
  const completed = state?.events.slice().reverse().find(event => event.kind === 'run.completed')?.payload;
  const result = coworkDocumentSchema.safeParse(completed ? { reply: completed.reply, document: completed.document } : null);
  const output = result.success ? result.data : null;
  const proposal = state?.run.status === 'waiting_approval'
    ? state.events.slice().reverse().find(event => event.kind === 'approval.requested')?.payload : null;
  const hasContacts = state?.events.some(event => event.kind === 'tool.completed'
    && event.payload.result && typeof event.payload.result === 'object'
    && Array.isArray((event.payload.result as { items?: unknown }).items)
    && ((event.payload.result as { items: unknown[] }).items.length > 0));

  async function request(url: string, options?: RequestInit) {
    const response = await fetch(url, { ...options, cache: 'no-store' });
    const data = await response.json();
    if (response.status === 401 || response.status === 403) {
      setRuns([]); setState(null); setReady(false); setDocumentOpen(false);
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
    return data;
  }

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    request('/api/cowork/runs').then(data => {
      if (disposed) return;
      setRuns(data.runs); setReady(data.canSubmit); setError('');
    }).catch(error => { if (!disposed) setError(error.message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const data = await request(`/api/cowork/runs/${selected}`, { signal: controller.signal });
        if (disposed) return;
        setState(data);
        setRuns(previous => previous.map(run => run.id === data.run.id ? data.run : run));
        if (['queued', 'running', 'waiting_approval'].includes(data.run.status)) timer = setTimeout(poll, 3000);
      } catch (error) {
        if (!disposed) setError(error instanceof Error ? error.message : 'No se pudo actualizar el trabajo.');
      }
    }
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [selected, refresh]);

  useEffect(() => { if (documentOpen) documentHeading.current?.focus(); }, [documentOpen]);

  function choose(id: string | null) {
    setState(null); setSelected(id); setDocumentOpen(false); setHistoryOpen(false); setError('');
  }

  async function send() {
    const text = message.trim();
    if (!text || sending || !ready) return;
    const parentRunId = state?.run.status === 'completed' ? state.run.id : null;
    if (pending.current?.message !== text || pending.current?.parentRunId !== parentRunId) pending.current = { message: text, requestId: crypto.randomUUID(), parentRunId };
    setSending(true); setError('');
    try {
      const data = await request('/api/cowork/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pending.current, mode: 'approval' }),
      });
      setMessage(''); pending.current = null; choose(data.id); setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo guardar la solicitud.'); }
    finally { setSending(false); }
  }

  async function cancel() {
    if (!selected || cancelling) return;
    setCancelling(true);
    try { await request(`/api/cowork/runs/${selected}`, { method: 'DELETE' }); setRefresh(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : 'No se pudo cancelar.'); }
    finally { setCancelling(false); }
  }

  async function resolveNote(approve: boolean) {
    if (!selected || resolving) return;
    setResolving(true);
    try {
      await request(`/api/cowork/runs/${selected}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }) });
      setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo resolver el cambio.'); }
    finally { setResolving(false); }
  }

  function download() {
    if (!output?.document) return;
    const url = URL.createObjectURL(new Blob([output.document.content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cowork-documento.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section aria-label="Cowork" className="flex min-h-[75dvh] min-w-0 flex-col rounded-2xl bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Mostrar trabajos" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History /></Button>
          <h1 className="truncate text-sm font-medium">{state ? state.run.message.slice(0, 70) : 'Cowork'}</h1>
        </div>
        <Button variant="ghost" onClick={() => choose(null)}><Plus />Nuevo trabajo</Button>
      </header>
      {error && <div role="alert" className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted p-3 text-sm"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>Reintentar</Button></div>}
      <div className="flex min-h-0 flex-1 flex-col gap-5 pt-5 lg:flex-row">
        {historyOpen && <nav aria-label="Trabajos recientes" className="max-h-72 w-full shrink-0 overflow-y-auto border-b border-border pb-4 lg:max-h-[65dvh] lg:w-56 lg:border-b-0 lg:border-r lg:pr-3">
          <h2 className="mb-3 text-sm font-medium">Trabajos recientes</h2>
          {runs.length === 0 && <p className="text-sm text-muted-foreground">Tus trabajos aparecerán aquí.</p>}
          {runs.map(run => <Button key={run.id} variant="ghost" className="mb-1 w-full justify-start overflow-hidden" aria-current={selected === run.id ? 'page' : undefined} onClick={() => choose(run.id)}><span className="truncate">{run.message}</span></Button>)}
        </nav>}
        <div className={cn('flex min-w-0 flex-1 flex-col', documentOpen && 'hidden lg:flex')}>
          {!selected ? <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-10 md:py-16">
            <h2 className="mb-8 text-center text-3xl font-medium tracking-tight md:text-4xl">¿En qué trabajamos hoy?</h2>
            <form onSubmit={event => { event.preventDefault(); void send(); }} className="rounded-2xl border border-border bg-muted/30 p-4 shadow-sm">
              <Label htmlFor="cowork-message" className="sr-only">Describe tu trabajo</Label>
              <Textarea id="cowork-message" value={message} maxLength={20000} onChange={event => setMessage(event.target.value)} placeholder="Describe lo que necesitas preparar…" className="min-h-28 resize-y border-0 bg-transparent text-base shadow-none" disabled={sending} />
              <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Consulta tus contactos guardados o prepara un documento</span><Button type="submit" size="icon" className="rounded-xl" aria-label="Crear trabajo" disabled={!ready || !message.trim() || sending}>{sending ? <Loader2 className="motion-safe:animate-spin" /> : <ArrowUp />}</Button></div>
            </form>
            {!ready && !loading && <p className="mt-3 text-sm text-muted-foreground">El procesamiento todavía no está disponible. Puedes consultar los trabajos guardados.</p>}
            <div className="mt-10"><h3 className="mb-3 text-sm text-muted-foreground">Recientes</h3>
              {loading ? <p role="status" className="text-sm text-muted-foreground">Cargando trabajos…</p> : runs.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay trabajos. Describe tu primer objetivo arriba.</p> : runs.slice(0, 6).map(run => <button key={run.id} onClick={() => choose(run.id)} className="flex w-full items-center justify-between gap-4 border-b border-border/60 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 truncate">{run.message}</span><span className="shrink-0 text-xs text-muted-foreground">{labels[run.status]}</span></button>)}
            </div>
          </div> : !state ? <p role="status" className="p-6 text-sm text-muted-foreground">Cargando conversación…</p> : <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-5">
            <p className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-5 py-4">{state.run.message}</p>
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{active ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : state.run.status === 'completed' ? <Check className="h-4 w-4" /> : null}{labels[state.run.status]}</p>
            {output && <p className="whitespace-pre-wrap break-words text-base leading-7">{output.reply}</p>}
            {proposal && <section aria-label="Revisar cambio de nota" className="space-y-4 rounded-xl border border-border p-5">
              <h3 className="font-medium">Reemplazar nota comercial</h3>
              <p className="text-sm font-medium">{String(proposal.leadName || proposal.leadId || '')}</p>
              <p className="text-sm text-muted-foreground">Se reemplazará la nota de este contacto en el CRM. Revisa el texto completo antes de guardar.</p>
              <div><h4 className="text-sm font-medium">Nota actual</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{String(proposal.previousNote || 'Sin nota')}</p></div>
              <div><h4 className="text-sm font-medium">Nueva nota</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm">{String(proposal.proposedNote || '')}</p></div>
              <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={resolving} onClick={() => void resolveNote(false)}>Descartar</Button><Button disabled={resolving} onClick={() => void resolveNote(true)}>{resolving ? 'Guardando decisión…' : 'Guardar nueva nota'}</Button></div>
            </section>}
            {state.run.status === 'failed' && <p className="text-sm text-muted-foreground">Tu solicitud sigue guardada. Puedes crear un nuevo trabajo para intentarlo otra vez.</p>}
            {hasContacts && <Button asChild variant="outline" className="self-start"><a href={`/api/cowork/runs/${state.run.id}/export`}><Download />Descargar contactos CSV</a></Button>}
            {output?.document && <div className="flex items-center gap-3 rounded-xl border border-border p-4"><FileText className="h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="break-words font-medium">{output.document.title}</h3><p className="text-xs text-muted-foreground">Documento · Solo tú</p></div><Button ref={documentButton} variant="secondary" onClick={() => setDocumentOpen(true)}>Abrir</Button></div>}
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">Actividad del trabajo</summary><ol className="mt-3 space-y-2">{state.events.map(event => <li key={event.sequence}>{event.kind === 'tool.completed' ? (event.payload.action === 'leads.get' ? 'Consultó una ficha de tus contactos guardados' : 'Buscó en tus contactos guardados') : ({ 'work.created': 'Solicitud guardada', 'run.started': 'Comenzó la preparación', 'run.completed': 'Resultado guardado', 'run.failed': 'La preparación no terminó', 'run.cancelled': 'Trabajo cancelado' } as Record<string, string>)[event.kind] || 'Actualización del trabajo'}</li>)}</ol></details>
            <div className="mt-auto flex justify-end pt-6">{active ? <Button variant="outline" disabled={cancelling} onClick={() => void cancel()}><Square />{cancelling ? 'Cancelando…' : 'Detener trabajo'}</Button> : <Button variant="outline" onClick={() => choose(null)}>Nuevo trabajo</Button>}</div>
            {state.run.status === 'completed' && <form onSubmit={event => { event.preventDefault(); void send(); }} className="rounded-2xl border border-border bg-muted/30 p-4">
              <Label htmlFor="cowork-followup">Continúa este trabajo</Label>
              <Textarea id="cowork-followup" value={message} maxLength={20000} onChange={event => setMessage(event.target.value)} placeholder="Pide un ajuste o el siguiente paso…" disabled={sending} className="mt-2 min-h-24" />
              <div className="mt-3 flex justify-end"><Button type="submit" disabled={!ready || !message.trim() || sending}>{sending ? 'Guardando…' : 'Continuar'}<ArrowUp /></Button></div>
            </form>}
          </div>}
        </div>
        {documentOpen && output?.document ? <aside aria-label="Documento" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-muted/20 lg:basis-1/2">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4"><h2 ref={documentHeading} tabIndex={-1} className="min-w-0 truncate font-medium focus-visible:outline-none">{output.document.title}</h2><div className="flex shrink-0"><Button variant="ghost" size="icon" aria-label="Descargar Markdown" onClick={download}><Download /></Button><Button variant="ghost" size="icon" aria-label="Cerrar documento" onClick={() => { setDocumentOpen(false); requestAnimationFrame(() => documentButton.current?.focus()); }}><X /></Button></div></div>
          <pre className="max-h-[65dvh] overflow-y-auto whitespace-pre-wrap break-words p-5 font-sans text-sm leading-7 md:p-8">{output.document.content}</pre>
        </aside> : state && <aside aria-label="Resumen del trabajo" className="hidden w-64 shrink-0 self-start rounded-2xl border border-border bg-muted/25 p-5 xl:block"><h2 className="font-medium">Progreso</h2><p className="mt-2 text-sm text-muted-foreground">{labels[state.run.status]}</p><h2 className="mt-6 font-medium">Resultados</h2><p className="mt-2 text-sm text-muted-foreground">{output?.document ? output.document.title : 'Los documentos aparecerán aquí.'}</p><h2 className="mt-6 font-medium">Contexto</h2><p className="mt-2 text-sm text-muted-foreground">Tu mensaje</p></aside>}
      </div>
    </section>
  );
}
