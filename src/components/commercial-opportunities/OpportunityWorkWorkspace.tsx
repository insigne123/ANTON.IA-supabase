'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, Download, ExternalLink, FilePlus2, Loader2, Search, Settings, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { OpportunityWorkReport, SUGGESTED_QUESTIONS } from './OpportunityWorkReport';
import { OpportunityContacts } from './OpportunityContacts';
import {OpportunityTicketConnection} from './OpportunityTicketConnection';
import {OpportunityReconsiderDialog} from './OpportunityReconsiderDialog';
import { AdvicePill, ExclusionGroups, StartHere, TenderPrerequisites } from './OpportunityRadar';
import { ACCEPTED_FILES, DocumentList, ExpedientGuide, ReportProgress, usePublicLinks, type ExpedientDocument } from './OpportunityExpedient';
import { bySource, closesLabel, workAdvice } from '@/lib/commercial-opportunities/workspace-radar';
import { humanDate } from '@/lib/commercial-opportunities/report-view';
import { isSignalKind, type OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import type { WorkspaceOverview, WorkItem, WorkRecord, WorkspaceMember } from '@/lib/commercial-opportunities/workspace';

type Job = { id: string; kind: string; state: string; error: string | null; created_at: string };
type Detail = { item: WorkItem; work: WorkRecord | null; participants: WorkspaceMember[]; activity: any[]; tasks: any[]; documents: ExpedientDocument[]; reports: Array<{ id: string; created_at: string; report: OpportunityReport }>; jobs: Job[]; contacts: any[]; decisionMakerTitles: string[] };
const TYPES: Record<string, string> = { hiring: 'Ofertas laborales', linkedin_post: 'Publicación LinkedIn', tender: 'Licitación pública', compra_agil: 'Compra Ágil', private: 'Oportunidad privada', project: 'Proyecto' };
const STATES: Record<string, string> = { unassigned: 'Sin asignar', assigned: 'Asignada', working: 'En gestión', blocked: 'Bloqueada', submitted: 'Presentada', won: 'Ganada', lost: 'Perdida', archived: 'Archivada', queued: 'En cola', running: 'En curso', waiting: 'Continuando', ready: 'Terminado', failed: 'No terminó' };
const ACTIVE = ['queued', 'running', 'waiting'];
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin fecha';
const localDate = (value: string) => value ? new Date(value).toISOString() : null;
const money = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
const list = (s: string) => (s || '').split('\n').map(s => s.trim()).filter(Boolean);
async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }
/** Each opportunity has its own address (?op=…): the browser's back button returns to the list and a teammate can open the same link. */
const opportunityInUrl = () => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('op');

export function OpportunityWorkWorkspace() {
  const [overview, setOverview] = useState<(WorkspaceOverview & { suggestion?: any }) | null>(null);
  const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('recommended');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query, filter]);
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState('summary'); const [modal, setModal] = useState<'create' | 'context' | 'assign' | 'task' | 'criteria' | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({}); const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState(''); const [question, setQuestion] = useState(''); const [messages, setMessages] = useState<any[]>([]);
  const [feedback, setFeedback] = useState(''); const selectedRef = useRef(selected); selectedRef.current = selected;
  const [download, setDownload] = useState('pdf');
  const [reconsider,setReconsider]=useState(false);
  const watching = useRef<string | null>(null);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(''), 6000); return () => clearTimeout(timer); }, [feedback]);
  useEffect(() => { const read = () => setSelected(opportunityInUrl()); read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read); }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const result = await json(await fetch(`/api/commercial-opportunities/workspace?${new URLSearchParams({ view: filter, query, page: String(page) })}`, { cache: 'no-store', signal }));
      if (!signal?.aborted) { setOverview(result); setProblem(''); }
    } catch (e) { if (!signal?.aborted) { setProblem(e instanceof Error ? e.message : 'No se pudo cargar.'); setOverview(null); } }
  }, [filter, query, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); const timer = setInterval(() => void load(controller.signal), 15_000); return () => { controller.abort(); clearInterval(timer); }; }, [load]);
  const loadDetail = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      const value = await json(await fetch(`/api/commercial-opportunities/${id}/workspace`, { cache: 'no-store', signal }));
      const chat = await json(await fetch(`/api/commercial-opportunities/${id}/chat`, { cache: 'no-store', signal }));
      if (!signal?.aborted && selectedRef.current === id) { setDetail(value); setMessages(chat.messages || []); }
    } catch (e) { if (!signal?.aborted && selectedRef.current === id) { setDetail(null); setMessages([]); setProblem(e instanceof Error ? e.message : 'No se pudo abrir.'); } }
  }, []);
  useEffect(() => {
    setDetail(null); setMessages([]); setTab('summary'); setNote(''); setQuestion(''); watching.current = null;
    if (!selected) return; const controller = new AbortController(); void loadDetail(selected, controller.signal);
    const timer = setInterval(() => void loadDetail(selected, controller.signal), 8000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected, loadDetail]);
  const research = detail?.jobs.find(j => j.kind === 'research') ?? null;
  const researching = Boolean(research && ACTIVE.includes(research.state));
  // Say so when the report the person is waiting for arrives, then show it.
  useEffect(() => {
    if (!research) return;
    if (ACTIVE.includes(research.state)) { watching.current = research.id; return; }
    if (watching.current === research.id && research.state === 'ready') { watching.current = null; setTab('summary'); setFeedback(isSignalKind(detail?.item.kind) ? 'La ficha comercial está lista.' : 'Tu informe está listo.'); }
  }, [research, detail?.item.kind]);
  const admin = overview?.mode === 'management';
  const perform = async (action: string, data: unknown, id = selected, quiet = false) => {
    setBusy(true); setProblem(''); setFeedback('');
    try {
      const endpoint = id ? `/api/commercial-opportunities/${id}/workspace` : '/api/commercial-opportunities/workspace';
      const result = await json(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) }));
      await load(); if (id) await loadDetail(id); if (!quiet) setFeedback(result.jobId || result.queued ? 'Trabajo en cola. Puedes continuar y volver cuando termine.' : 'Cambios guardados.');
      return result;
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar.'); return null; }
    finally { setBusy(false); }
  };
  const open = (id: string) => {
    setProblem(''); setSelected(id);
    if (opportunityInUrl() !== id) window.history.pushState(null, '', `${window.location.pathname}?op=${encodeURIComponent(id)}`);
    window.scrollTo({ top: 0 });
    for (const n of overview?.notifications.filter(n => n.opportunity_id === id && !n.read_at) || []) void fetch('/api/commercial-opportunities/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notification', data: { id: n.id } }) });
  };
  const close = () => { setSelected(null); setProblem(''); if (opportunityInUrl()) window.history.pushState(null, '', window.location.pathname); };
  const generate = () => { if (!detail) return; if (admin && detail.item.data.evaluation === 'excluded' && !detail.reports.length) setReconsider(true); else { setTab('summary'); void perform('research', {}, selected, true); } };
  const ask = (text: string) => { setTab('chat'); setQuestion(''); void perform('chat', { question: text, requestId: crypto.randomUUID() }, selected, true); };
  const upload = async (picked: File[], report: (u: Array<{ name: string; state: 'uploading' | 'done' | 'error'; message?: string }>) => void) => {
    if (!selected) return;
    const states = picked.map(f => ({ name: f.name, state: 'uploading' as 'uploading' | 'done' | 'error', message: undefined as string | undefined })); report([...states]);
    setBusy(true);
    for (const [i, file] of picked.entries()) {
      try { const body = new FormData(); body.set('file', file); await json(await fetch(`/api/commercial-opportunities/${selected}/documents`, { method: 'POST', body })); states[i] = { ...states[i], state: 'done' }; }
      catch (e) { states[i] = { ...states[i], state: 'error', message: e instanceof Error ? e.message : 'No se pudo subir.' }; }
      report([...states]);
    }
    setBusy(false); await loadDetail(selected);
  };
  const openContext = () => {
    const c = overview?.context as any;
    setDraft({ offer: c?.offer || overview?.suggestion?.offer || '', services: (c?.services || overview?.suggestion?.services || []).join('\n'), territories: (c?.territories || []).join('\n'), exclusions: (c?.exclusions || []).join('\n'), priority: c?.priority || 'balanced', automation: c ? c.automation : true, hour: c?.hour ?? 8 }); setModal('context');
  };
  const openCriteria = () => {
    const c = (overview?.context as any)?.criteria || {};
    setDraft({ roles: (c.roles || []).join('\n'), keywords: (c.keywords || []).join('\n'), postQueries: (c.postQueries || []).join('\n'), decisionMakerTitles: (c.decisionMakerTitles || []).join('\n') }); setModal('criteria');
  };
  const field = (name: string, value: unknown) => setDraft(d => ({ ...d, [name]: value }));
  const saveModal = async () => {
    let result;
    if (modal === 'context') result = await perform('context', { offer: draft.offer, services: list(draft.services), territories: list(draft.territories), exclusions: list(draft.exclusions), priority: draft.priority,
      automation: Boolean(draft.automation), hour: Number(draft.hour), expectedRevision: Number((overview?.context as any)?.revision || 0) }, null);
    else if (modal === 'criteria') result = await perform('criteria', { criteria: { roles: list(draft.roles), keywords: list(draft.keywords), postQueries: list(draft.postQueries), decisionMakerTitles: list(draft.decisionMakerTitles) },
      expectedRevision: Number((overview?.context as any)?.revision || 0) }, null);
    else if (modal === 'assign') result = await perform('assign', { expectedRevision: detail?.work?.revision || 0, teamId: draft.teamId || null, participantIds: draft.participantIds || [], responsibleId: draft.responsibleId || null, objective: draft.objective || '', dueAt: localDate(draft.dueAt || '') });
    else if (modal === 'task') result = await perform('task', { title: draft.title, ownerId: draft.ownerId || null, dueAt: localDate(draft.dueAt || ''), status: 'pending', evidence: draft.evidence || '' });
    else {
      result = await perform('create', { requestId:draft.requestId,title: draft.title, company: draft.company, kind: draft.kind || 'private_tender', description: draft.description || '', url: draft.url || null, deadline: localDate(draft.deadline || ''), amount: draft.amount ? Number(draft.amount) : null, currency: draft.currency || 'CLP' }, null, true);
      if (result?.id) {
        setBusy(true); const failed: string[] = [];
        for (const file of files) { try { const body = new FormData(); body.set('file', file); await json(await fetch(`/api/commercial-opportunities/${result.id}/documents`, { method: 'POST', body })); } catch (e) { failed.push(e instanceof Error ? e.message : `«${file.name}» no se pudo subir.`); } }
        setBusy(false); open(result.id); await load();
        if (failed.length) setProblem(`La oportunidad quedó creada. ${failed.join(' ')} Puedes subirlos de nuevo en Documentos.`);
        else setFeedback('Oportunidad creada. Genera el informe cuando tengas todos los documentos.');
      }
    }
    if (result) { setModal(null); setFiles([]); }
  };
  const filters = admin ? [['recommended', 'Recomendadas'], ['review', 'Por revisar'], ['assigned', 'Asignadas'], ['excluded', 'No recomendadas'], ['pending', 'Por evaluar'], ['all', 'Todas']] : [['all', 'Mi trabajo'], ['assigned', 'Nuevas asignaciones'], ['working', 'En gestión'], ['blocked', 'Bloqueadas']];
  const items = (overview?.items || []).filter(item => {
    const work = overview?.work.find(w => w.opportunity_id === item.id);
    if (query && !`${item.title} ${item.company_name || item.buyer_name || ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (!admin) return filter === 'recommended' || filter === 'all' || (work?.state || 'assigned') === filter;
    if (filter === 'assigned') return Boolean(work && work.state !== 'unassigned');
    return filter === 'all' || (item.data.evaluation || (item.kind === 'private' ? 'review' : 'pending')) === filter;
  });
  const card = (item: WorkItem) => { const work = overview?.work.find(w => w.opportunity_id === item.id); const owner = overview?.members.find(m => m.user_id === work?.responsible_id); return <article key={item.id} className="rounded-xl border bg-background p-5"><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex flex-wrap items-center gap-2"><span>{TYPES[item.kind]}</span><AdvicePill item={item} /></span><span>{STATES[work?.state || 'unassigned']}</span></div><h3 className="mt-2 text-base font-semibold">{item.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.company_name || item.buyer_name}</p><p className="mt-3 text-sm leading-6">{item.reasons[0] || 'Pendiente de evaluación'}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{item.deadline_at && <span>Cierre: {date(item.deadline_at)}</span>}{item.amount ? <span>Monto: {money(item.amount)} {item.currency || ''}</span> : null}{work?.due_at && <span>Próxima acción: {date(work.due_at)}</span>}{owner && <span>Responsable: {owner.name}</span>}</div>{work?.objective && <p className="mt-3 text-sm">Objetivo: {work.objective}</p>}<Button variant="outline" size="sm" className="mt-4" onClick={() => open(item.id)}>Abrir y trabajar</Button></article>; };
  const title = admin ? 'Gestionar oportunidades' : 'Mis oportunidades asignadas';
  const item = detail?.item;
  const signal = isSignalKind(item?.kind);
  const latest = detail?.reports[0];
  const newerDocuments = latest ? (detail?.documents || []).filter(d => d.source_kind === 'upload' && Date.parse(d.created_at) > Date.parse(latest.created_at)) : [];
  const links = usePublicLinks(selected, item?.kind);
  const advice = item ? workAdvice(item) : null;
  const unread = overview?.notifications.filter(n => !n.read_at) || [];
  return <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 sm:p-6">
    {!selected && <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{admin ? 'Hallazgos y oportunidades recibidas, con un equipo y una siguiente acción.' : 'Tus asignaciones, el equipo de trabajo y lo que hay que hacer después.'}</p></div>
      {admin && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={openContext}><Settings className="mr-2 h-4 w-4" />Empresa del workspace</Button><Button onClick={() => { setDraft({ currency: 'CLP',requestId:crypto.randomUUID() }); setFiles([]); setModal('create'); }}><FilePlus2 className="mr-2 h-4 w-4" />Cargar oportunidad</Button></div>}
    </header>}
    {problem && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{problem}</p><Button size="sm" variant="outline" onClick={() => { setProblem(''); void load(); if (selected) void loadDetail(selected); }}>Reintentar</Button></div>}
    {feedback && <p role="status" className="rounded-xl border bg-muted/30 p-3 text-sm">{feedback}</p>}
    {!overview && !problem && <div role="status" className="rounded-xl border p-8"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Cargando oportunidades…</div>}
    {overview && !selected && <>
      {admin && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4"><div><p className="text-sm font-medium">{overview.context ? 'Oferta compartida confirmada' : 'Confirma qué ofrece tu empresa'}</p><p className="mt-1 text-xs text-muted-foreground">{overview.context ? `Búsqueda diaria ${(overview.context as any).automation && overview.sourceStatus.automation ? 'programada' : 'pausada'} · Límite mensual US$20 · US$${overview.budget.spent.toFixed(2)} usados` : 'La IA prepara los criterios desde tu oferta. No necesitas escribir palabras de búsqueda.'}</p></div>
        <div className="flex flex-wrap gap-2">{overview.context && (overview.context as any).criteria?.postQueries?.length ? <Button variant="ghost" onClick={openCriteria}><Search className="mr-2 h-4 w-4" />Qué buscamos</Button> : null}
          {overview.context ? <Button variant="outline" disabled={busy || !overview.sourceStatus.automation} onClick={() => void perform('discover', {}, null)}>Actualizar oportunidades</Button> : <Button onClick={openContext}>Confirmar oferta</Button>}</div></div>}
      {unread.length > 0 && <section aria-label="Novedades" className="rounded-xl border p-4"><h2 className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4" />Novedades</h2><div className="mt-3 space-y-2">{unread.map(n => <button key={n.id} onClick={() => open(n.opportunity_id)} className="block w-full rounded-lg border p-3 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{n.title}<span className="mt-1 block text-xs text-muted-foreground">{date(n.created_at)} · Abrir</span></button>)}</div></section>}
      <TenderPrerequisites />
      <div className="flex flex-wrap gap-3"><div className="flex min-w-0 flex-1 flex-wrap gap-1" aria-label="Filtrar oportunidades">{filters.map(([key, label]) => <Button key={key} size="sm" variant={filter === key ? 'secondary' : 'ghost'} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</Button>)}</div><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar en las oportunidades" aria-label="Buscar en las oportunidades" className="w-full sm:w-72" /></div>
      {!items.length && <section className="rounded-xl border p-8"><h2 className="font-semibold">{admin ? 'No hay oportunidades en esta vista' : 'Aún no tienes oportunidades en esta vista'}</h2><p className="mt-2 max-w-xl text-sm text-muted-foreground">{query ? 'Prueba otro texto o cambia el filtro.' : admin ? 'Confirma la oferta para recibir hallazgos o carga una oportunidad que haya recibido el equipo.' : 'Las oportunidades que te asigne un administrador aparecerán aquí con tu equipo y las próximas acciones.'}</p></section>}
      {admin && filter === 'recommended' && !query && <StartHere items={items} onOpen={open} />}
      {items.length > 0 && <div className="space-y-8">{bySource(items).map(group => <section key={group.key} aria-labelledby={`source-${group.key}`} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h2 id={`source-${group.key}`} className="text-lg font-semibold">{group.label} <span className="text-sm font-normal tabular-nums text-muted-foreground">{group.items.length}</span></h2><p className="text-xs text-muted-foreground">{group.note}</p></div>
        {admin && filter === 'excluded' ? <ExclusionGroups items={group.items} onOpen={open} /> : <div className="grid gap-3 xl:grid-cols-2">{group.items.map(card)}</div>}
      </section>)}</div>}
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><p className="text-xs text-muted-foreground">Página {page + 1} · hasta 100 oportunidades</p><Button variant="outline" disabled={overview.items.length < 100} onClick={() => setPage(p => p + 1)}>Siguiente</Button></div>
    </>}
    {selected && <>
      <Button variant="ghost" className="-ml-2 self-start" onClick={close}><ArrowLeft className="mr-2 h-4 w-4" />Oportunidades</Button>
      {!detail && !problem && <div role="status" className="rounded-xl border p-8"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Abriendo la oportunidad…</div>}
      {detail && item && <>
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{TYPES[item.kind]}</span><AdvicePill item={item} /><span>· {STATES[detail.work?.state || 'unassigned']}</span></div>
          <h1 className="max-w-4xl text-2xl font-semibold tracking-tight">{item.title}</h1>
          <p className="text-sm text-muted-foreground">{item.company_name || item.buyer_name}</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {!signal && <div><dt className="text-xs text-muted-foreground">Cierre</dt><dd className="font-medium">{humanDate(item.deadline_at, true) ?? 'Sin fecha informada'}{advice && closesLabel(advice) ? <span className={cn('ml-2 text-xs', advice.urgent ? 'text-destructive' : 'text-muted-foreground')}>{closesLabel(advice)}</span> : null}</dd></div>}
            {!signal && <div><dt className="text-xs text-muted-foreground">Monto</dt><dd className="font-medium">{item.amount ? `${money(item.amount)} ${item.currency || ''}` : 'No informado'}</dd></div>}
            {typeof (item.data as any)?.observed?.code === 'string' && <div><dt className="text-xs text-muted-foreground">Código</dt><dd className="font-medium">{(item.data as any).observed.code}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">Equipo</dt><dd className="font-medium">{detail.participants.length ? detail.participants.map(p => `${p.name}${p.user_id === detail.work?.responsible_id ? ' (responsable)' : ''}`).join(', ') : 'Sin asignar'}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {/* One main action per screen: while the guide shows its own «Generar», the header does not repeat it. */}
            {(latest || researching || tab !== 'summary') && <Button onClick={generate} disabled={busy || researching}>{researching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{researching ? 'Preparando…' : latest ? (signal ? 'Actualizar ficha comercial' : 'Actualizar informe') : (signal ? 'Generar ficha comercial' : 'Generar informe')}</Button>}
            {admin && <Button variant="outline" onClick={() => { setDraft({ teamId: detail.work?.team_id || '', participantIds: detail.participants.map(p => p.user_id), responsibleId: detail.work?.responsible_id || '', objective: detail.work?.objective || '' }); setModal('assign'); }}><Users className="mr-2 h-4 w-4" />Asignar equipo</Button>}
            {item.url && <Button asChild variant="ghost"><a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />{item.kind === 'tender' ? 'Ver en Mercado Público' : signal ? 'Ver en LinkedIn' : 'Ver fuente'}</a></Button>}
          </div>
          {detail.work?.objective && <p className="text-sm">Objetivo: {detail.work.objective}</p>}
        </header>
        <div className="flex flex-wrap gap-1 border-b pb-2" aria-label="Secciones de la oportunidad">{[['summary', signal ? 'Ficha comercial' : 'Informe'], ['documents', `Documentos${detail.documents.length ? ` · ${detail.documents.length}` : ''}`], ['chat', 'Preguntar a la IA'], ['tasks', 'Plan y tareas'], ['contacts', 'Contactos'], ['activity', 'Actividad']].map(([id, label]) => <Button key={id} size="sm" variant={tab === id ? 'secondary' : 'ghost'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Button>)}</div>
        {tab === 'summary' && <div className="space-y-5">
          {research && (researching || ['failed', 'blocked'].includes(research.state)) && <ReportProgress state={research.state} error={research.error} signal={signal} onRetry={generate} />}
          {latest && newerDocuments.length > 0 && !researching && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-4 text-sm"><p>Subiste {newerDocuments.length === 1 ? 'un documento nuevo' : `${newerDocuments.length} documentos nuevos`} después del informe. Actualízalo para incluir{newerDocuments.length === 1 ? 'lo' : 'los'}.</p><Button size="sm" onClick={generate} disabled={busy}>Actualizar informe</Button></div>}
          {latest && item.kind === 'tender' && !advice?.closed && !detail.documents.some(d => d.source_kind === 'upload') && !researching && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cw-warning-soft p-4 text-sm"><p>Este informe se hizo sin las bases. Súbelas para completarlo: la IA podrá revisar requisitos, criterios y garantías.</p><Button size="sm" variant="outline" onClick={() => setTab('documents')}>Subir bases</Button></div>}
          {!latest && !researching && <ExpedientGuide kind={item.kind} url={item.url} links={links} documents={detail.documents} onUpload={upload} onGenerate={generate} generating={researching} hasReport={false} busy={busy} closed={advice?.closed ? humanDate(item.deadline_at) : null} />}
          {!latest && !researching && item.reasons[0] && <div className="rounded-2xl border p-5"><h2 className="text-sm font-semibold">Por qué apareció</h2><p className="mt-2 text-sm leading-6">{item.reasons.join(' ')}</p></div>}
          {latest && <>
            <div className="flex flex-wrap items-center justify-end gap-2"><label className="sr-only" htmlFor="op-export">Formato de descarga</label><select id="op-export" value={download} onChange={e => setDownload(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring">{[['pdf', 'PDF'], ['docx', 'Word'], ['xlsx', 'Excel'], ['md', 'Markdown'], ['zip', 'Expediente completo (ZIP)']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button asChild variant="outline" size="sm"><a href={`/api/commercial-opportunities/${selected}/export?format=${download}`}><Download className="mr-2 h-4 w-4" />Descargar</a></Button></div>
            <OpportunityWorkReport report={latest.report} opportunity={{ title: item.title, buyer: item.buyer_name || item.company_name, deadline: item.deadline_at, amount: item.amount, currency: item.currency }}
              onTask={(title, evidence) => { setDraft({ title, evidence }); setModal('task'); }} onAsk={ask} onContacts={() => setTab('contacts')} />
          </>}
        </div>}
        {tab === 'documents' && <section className="space-y-5">
          {!signal && <ExpedientGuide kind={item.kind} url={item.url} links={links} documents={detail.documents} onUpload={upload} onGenerate={generate} generating={researching} hasReport={Boolean(latest)} busy={busy} closed={advice?.closed ? humanDate(item.deadline_at) : null} />}
          {signal && <p className="text-sm text-muted-foreground">Las señales de LinkedIn no tienen bases. Si recibiste algo de esta empresa (una invitación, un requerimiento), súbelo en <button type="button" className="underline" onClick={() => document.getElementById('op-document')?.click()}>Documentos</button>.</p>}
          {signal && <input id="op-document" type="file" multiple accept={ACCEPTED_FILES} className="sr-only" onChange={e => void upload(Array.from(e.target.files || []), () => undefined)} />}
          <div><h2 className="mb-3 font-semibold">En el expediente</h2><DocumentList id={selected} documents={detail.documents} kind={item.kind} /></div>
        </section>}
        {tab === 'tasks' && <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Plan de trabajo</h2><Button variant="outline" onClick={() => { setDraft({}); setModal('task'); }}>Crear tarea</Button></div>{!detail.tasks.length && <p className="rounded-xl border p-5 text-sm text-muted-foreground">{latest ? 'Crea la primera tarea o usa «Crear tarea» en los pasos del informe.' : 'Crea la primera tarea. Cuando generes el informe, podrás convertir sus pasos en tareas con un clic.'}</p>}{detail.tasks.map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-medium">{t.title}</p><p className="mt-1 text-xs text-muted-foreground">{date(t.due_at)} · {detail.participants.find(p => p.user_id === t.owner_id)?.name || 'Sin responsable'}</p>{t.evidence && <p className="mt-2 text-sm">{t.evidence}</p>}</div><select aria-label={`Estado de ${t.title}`} value={t.status} disabled={busy} onChange={e => void perform('task', { id: t.id, title: t.title, ownerId: t.owner_id, dueAt: t.due_at, status: e.target.value, evidence: t.evidence })} className="h-10 rounded-md border bg-background px-3 text-sm">{[['pending', 'Pendiente'], ['working', 'En curso'], ['done', 'Realizada'], ['blocked', 'Bloqueada']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}{detail.work && <div className="flex flex-wrap items-center gap-2 border-t pt-3"><span className="text-xs text-muted-foreground">Cambiar estado:</span>{['working', 'blocked', 'submitted', ...(admin ? ['won', 'lost', 'archived'] : [])].map(state => <Button variant="outline" size="sm" key={state} disabled={busy} onClick={() => void perform('state', { state, expectedRevision: detail.work!.revision })}>{STATES[state]}</Button>)}</div>}</section>}
        {tab === 'contacts' && <OpportunityContacts id={selected} company={item.company_name || item.buyer_name || item.title} domain={item.company_domain} titles={detail.decisionMakerTitles || []} />}
        {tab === 'activity' && <section className="space-y-4"><h2 className="font-semibold">Actividad del equipo</h2><form onSubmit={e => { e.preventDefault(); void perform('activity', { kind: 'note', text: note, dueAt: null }).then(r => { if (r) setNote(''); }); }} className="space-y-2"><Label htmlFor="op-note">Registrar avance o nota</Label><Textarea id="op-note" value={note} onChange={e => setNote(e.target.value)} maxLength={4000} placeholder="Ej.: enviamos las consultas al comprador; esperamos respuesta el 23 de octubre." /><Button disabled={busy || !note.trim()}>Guardar avance</Button></form><ol className="space-y-3">{detail.activity.map(a => <li key={a.id} className="rounded-xl border p-4"><p className="text-sm">{a.body}</p><p className="mt-2 text-xs text-muted-foreground">{detail.participants.find(p => p.user_id === a.actor_id)?.name || 'Administración'} · {date(a.created_at)}</p></li>)}</ol></section>}
        {tab === 'chat' && <section className="max-w-4xl space-y-4"><div><h2 className="font-semibold">Pregúntale a la IA sobre esta oportunidad</h2><p className="mt-1 text-sm text-muted-foreground">Responde con lo que dicen los documentos del expediente y te muestra la cita de donde lo sacó. {detail.documents.length ? `Tiene ${detail.documents.length === 1 ? '1 documento' : `${detail.documents.length} documentos`} para consultar.` : 'Todavía no hay documentos: genera el informe o sube las bases para mejores respuestas.'}</p></div>
          {!messages.length && <div className="flex flex-wrap gap-2">{(signal ? SUGGESTED_QUESTIONS.signal : SUGGESTED_QUESTIONS.tender).map(q => <Button key={q} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" disabled={busy} onClick={() => ask(q)}>{q}</Button>)}</div>}
          {messages.map(m => <div key={m.id} className="space-y-3 rounded-xl border p-4"><p className="font-medium">{m.question}</p>{m.answer?.answer ? <p className="whitespace-pre-wrap text-sm leading-7">{m.answer.answer}</p> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Buscando en los documentos… suele tardar menos de un minuto.</p>}{m.answer?.citations?.length ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Ver {m.answer.citations.length === 1 ? 'la cita' : `las ${m.answer.citations.length} citas`} de los documentos</summary><div className="mt-2 space-y-2">{m.answer.citations.map((c: any, i: number) => <blockquote key={i} className="border-l-2 pl-3">{c.quote}</blockquote>)}</div></details> : null}{m.answer?.missing?.map((text: string, i: number) => <p key={i} className="text-xs text-muted-foreground">{text}</p>)}</div>)}
          <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (question.trim().length >= 3) ask(question.trim()); }}><Label htmlFor="op-question">Tu pregunta</Label><Textarea id="op-question" value={question} onChange={e => setQuestion(e.target.value)} placeholder={signal ? '¿Qué cargo debería contactar primero?' : '¿Qué documentos faltan para preparar la propuesta?'} maxLength={2000} /><Button disabled={busy || question.trim().length < 3}>Preguntar</Button></form></section>}
      </>}
    </>}
    {admin&&selected&&<OpportunityReconsiderDialog open={reconsider} onOpenChange={setReconsider} busy={busy} onConfirm={async reason=>Boolean(await perform('reconsider',{reason}))}/>}
    <Dialog open={modal !== null} onOpenChange={open => { if (!open && !busy) setModal(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{modal === 'create' ? 'Cargar oportunidad recibida' : modal === 'context' ? 'Empresa del workspace' : modal === 'criteria' ? 'Qué buscamos para tu empresa' : modal === 'assign' ? 'Asignar equipo de trabajo' : 'Crear tarea'}</DialogTitle><DialogDescription>{modal === 'context' ? 'Cuéntale a la IA qué vende tu empresa. Con eso busca licitaciones y señales de LinkedIn y decide cuáles te convienen.' : modal === 'criteria' ? 'La IA los preparó desde tu oferta. Corrígelos si algo no calza: uno por línea. Se usan desde la próxima búsqueda.' : modal === 'assign' ? 'Los participantes recibirán la asignación y podrán trabajar en el expediente.' : 'Completa la información disponible; los datos faltantes se identificarán en el análisis.'}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void saveModal().catch(e => setProblem(e instanceof Error ? e.message : 'Revisa los datos.')); }}>
        {modal === 'context' ? <>{([['offer', 'Qué ofrece la empresa', 'Ej.: Automatizamos la consulta de causas judiciales de postulantes para empresas que contratan en volumen. Entregamos un reporte por persona en menos de 24 horas.'], ['services', 'Servicios o productos · uno por línea', 'Ej.:\nVerificación de antecedentes de postulantes\nMonitoreo de causas laborales'], ['territories', 'Territorios atendidos · opcional', 'Ej.: Chile'], ['exclusions', 'Qué no ofrece · opcional', 'Ej.: No hacemos reclutamiento ni vendemos software de terceros']] as const).map(([key, label, placeholder]) => <div key={key}><Label htmlFor={`op-${key}`}>{label}</Label><Textarea id={`op-${key}`} value={draft[key] || ''} onChange={e => field(key, e.target.value)} placeholder={placeholder} rows={key === 'offer' ? 5 : 3} required={key === 'offer' || key === 'services'} /></div>)}<Label htmlFor="op-priority">Prioridad de señales de LinkedIn</Label><select id="op-priority" value={draft.priority} onChange={e => field('priority', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="hiring">Ofertas laborales primero</option><option value="posts">Publicaciones comerciales primero</option><option value="balanced">Ambas por igual</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.automation)} onChange={e => field('automation', e.target.checked)} />Buscar oportunidades nuevas cada día</label><Label htmlFor="op-hour">Hora de la búsqueda diaria (Chile)</Label><Input id="op-hour" type="number" min={0} max={23} value={draft.hour} onChange={e => field('hour', e.target.value)} /></>
        : modal === 'criteria' ? <>{([['roles', 'Cargos en avisos de trabajo que revelan una necesidad'], ['keywords', 'Palabras para licitaciones y compras públicas'], ['postQueries', 'Búsquedas de publicaciones en LinkedIn'], ['decisionMakerTitles', 'Cargos de quienes deciden la compra']] as const).map(([key, label]) => <div key={key}><Label htmlFor={`op-criteria-${key}`}>{label}</Label><Textarea id={`op-criteria-${key}`} value={draft[key] || ''} onChange={e => field(key, e.target.value)} rows={key === 'postQueries' ? 5 : 4} required={key === 'postQueries'} /></div>)}</>
        : modal === 'assign' ? <><Label htmlFor="op-team">Equipo existente · opcional</Label><select id="op-team" value={draft.teamId || ''} onChange={e => field('teamId', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Seleccionar personas</option>{overview?.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><fieldset className="space-y-2"><legend className="text-sm font-medium">Participantes adicionales</legend>{overview?.members.map(m => <label key={m.user_id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={(draft.participantIds || []).includes(m.user_id)} onChange={e => field('participantIds', e.target.checked ? [...(draft.participantIds || []), m.user_id] : draft.participantIds.filter((id: string) => id !== m.user_id))} />{m.name}</label>)}</fieldset><Label htmlFor="op-responsible">Responsable principal</Label><select id="op-responsible" value={draft.responsibleId || ''} onChange={e => { field('responsibleId', e.target.value); if (e.target.value && !(draft.participantIds || []).includes(e.target.value)) field('participantIds', [...(draft.participantIds || []), e.target.value]); }} className="block h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Sin responsable individual aún</option>{overview?.members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select><Label htmlFor="op-objective">Objetivo</Label><Textarea id="op-objective" value={draft.objective || ''} onChange={e => field('objective', e.target.value)} /><Label htmlFor="op-due">Próxima acción · hora local</Label><Input id="op-due" type="datetime-local" value={draft.dueAt || ''} onChange={e => field('dueAt', e.target.value)} /></>
        : modal === 'task' ? <><Label htmlFor="op-task-title">Acción</Label><Input id="op-task-title" required value={draft.title || ''} onChange={e => field('title', e.target.value)} /><Label htmlFor="op-task-owner">Responsable</Label><select id="op-task-owner" value={draft.ownerId || ''} onChange={e => field('ownerId', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Sin asignar</option>{detail?.participants.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select><Label htmlFor="op-task-due">Fecha · hora local</Label><Input id="op-task-due" type="datetime-local" value={draft.dueAt || ''} onChange={e => field('dueAt', e.target.value)} /><Label htmlFor="op-task-evidence">Evidencia o resultado esperado</Label><Textarea id="op-task-evidence" value={draft.evidence || ''} onChange={e => field('evidence', e.target.value)} /></>
        : <>{[['title', 'Nombre de la oportunidad'], ['company', 'Cliente o entidad convocante'], ['url', 'Enlace · opcional']].map(([key, label]) => <div key={key}><Label htmlFor={`op-new-${key}`}>{label}</Label><Input id={`op-new-${key}`} type={key === 'url' ? 'url' : 'text'} required={key !== 'url'} value={draft[key] || ''} onChange={e => field(key, e.target.value)} /></div>)}<Label htmlFor="op-kind">Tipo</Label><select id="op-kind" value={draft.kind || 'private_tender'} onChange={e => field('kind', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="private_tender">Licitación privada</option><option value="proposal">Solicitud de propuesta</option><option value="quote">Solicitud de cotización</option><option value="commercial">Oportunidad comercial</option></select><Label htmlFor="op-invitation">Invitación o contexto recibido</Label><Textarea id="op-invitation" rows={6} value={draft.description || ''} onChange={e => field('description', e.target.value)} maxLength={40000} placeholder="Pega aquí el correo o mensaje con la invitación." /><Label htmlFor="op-new-deadline">Cierre · hora local, opcional</Label><Input id="op-new-deadline" type="datetime-local" value={draft.deadline || ''} onChange={e => field('deadline', e.target.value)} /><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="op-amount">Monto · opcional</Label><Input id="op-amount" type="number" min={0} value={draft.amount || ''} onChange={e => field('amount', e.target.value)} /></div><div><Label htmlFor="op-currency">Moneda</Label><Input id="op-currency" value={draft.currency || 'CLP'} onChange={e => field('currency', e.target.value)} /></div></div><Label htmlFor="op-new-files">Bases y anexos</Label><Input id="op-new-files" type="file" multiple accept={ACCEPTED_FILES} onChange={e => setFiles(Array.from(e.target.files || []))} /><p className="text-xs text-muted-foreground">PDF, Word o Excel, hasta 20 MB cada uno. También puedes subirlos después en Documentos.</p></>}
        {problem && modal && <p role="alert" className="text-sm text-destructive">{problem}</p>}<div className="flex justify-end gap-2"><Button variant="outline" type="button" disabled={busy} onClick={() => setModal(null)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{modal === 'context' ? 'Confirmar oferta' : modal === 'criteria' ? 'Guardar' : modal === 'assign' ? 'Asignar y notificar' : 'Guardar'}</Button></div>
      </form>
      {modal === 'context' && <div className="border-t pt-4"><OpportunityTicketConnection/></div>}
    </DialogContent></Dialog>
  </div>;
}
