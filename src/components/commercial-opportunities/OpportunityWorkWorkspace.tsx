'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardCheck, Download, ExternalLink, FilePlus2, FileUp, Loader2, Search, Settings, Sparkles, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { OpportunityWorkReport, SUGGESTED_QUESTIONS } from './OpportunityWorkReport';
import { SubmissionKit } from './SubmissionKit';
import { OfferDraft } from './OfferDraft';
import { PublicMarket } from './PublicMarket';
import { WinPlan } from './WinPlan';
import type { OfferPrices, SavedOfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import { PipelineBoard, type PagedStage, type PipelineSuggestion } from './PipelineBoard';
import { PriorityStars } from './PriorityStars';
import { ProgressMarks } from './ProgressMarks';
import type { PrioritySort } from '@/lib/commercial-opportunities/priority';
import { isResearching, markOpened, openedKey, parseOpened, progressChips, type CardProgress } from '@/lib/commercial-opportunities/progress';
import { useAuth } from '@/context/AuthContext';
import { OpportunityFilters } from './OpportunityFilters';
import { WORK_STATE_LABELS } from '@/lib/commercial-opportunities/pipeline';
import { opportunitySummary } from '@/lib/commercial-opportunities/summaries';
import type { MarkChange } from './ReportMarks';
import type { ReportMark, ReportMarks } from '@/lib/commercial-opportunities/report-marks';
import { OpportunityContacts } from './OpportunityContacts';
import { OpportunityChat } from './OpportunityChat';
import { OpportunityAssistant } from './OpportunityAssistant';
import { TenderProfileSheet } from './TenderProfileSheet';
import type { OpportunityFitView } from './RequirementFit';
import { TeamOffice, TeamPicker } from './TeamOffice';
import { InitialsAvatar } from '@/components/initials-avatar';
import { OpportunityTicketConnection } from './OpportunityTicketConnection';
import { WorkspaceCompanyFields } from './WorkspaceCompanyFields';
import {OpportunityReconsiderDialog} from './OpportunityReconsiderDialog';
import { AdvicePill, ExclusionGroups, NewsList, StartHere, TenderPrerequisites } from './OpportunityRadar';
import { ACCEPTED_FILES, DocumentList, ExpedientGuide, ReportProgress, usePublicLinks, type ExpedientDocument } from './OpportunityExpedient';
import { expandZipUploads, isZip } from '@/lib/commercial-opportunities/zip-uploads';
import { OPPORTUNITY_SOURCES, bySource, closesLabel, sourceKinds, workAdvice, type OpportunitySource } from '@/lib/commercial-opportunities/workspace-radar';
import { humanDate, reportDecision } from '@/lib/commercial-opportunities/report-view';
import { isSignalKind, type OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import type { WorkspaceOverview, WorkItem, WorkRecord, WorkspaceMember } from '@/lib/commercial-opportunities/workspace';
import type { ReportJobProgress } from '@/lib/commercial-opportunities/report-progress';

type Job = { id: string; kind: string; state: string; error: string | null; created_at: string; progress?: ReportJobProgress; documentId?: string };
type Detail = { item: WorkItem; work: WorkRecord | null; participants: WorkspaceMember[]; members?: Array<{ user_id: string; name: string }>; activity: any[]; tasks: any[]; documents: ExpedientDocument[]; reports: Array<{ id: string; created_at: string; report: OpportunityReport }>; jobs: Job[]; contacts: any[]; decisionMakerTitles: string[];
  marks?: { available: boolean; items: ReportMarks }; offer?: { available: boolean; latest: SavedOfferDraft | null }; fit?: OpportunityFitView };
/** The kinds with bases to answer with an offer (server/commercial-opportunities/workspace-offer.ts). */
const OFFER_KINDS = ['tender', 'compra_agil', 'private'];
/** The kinds with a public buyer whose history ChileCompra keeps (server/commercial-opportunities/workspace-market.ts). */
const MARKET_KINDS = ['tender', 'compra_agil'];
const TYPES: Record<string, string> = { hiring: 'Ofertas laborales', linkedin_post: 'Publicación LinkedIn', tender: 'Licitación pública', compra_agil: 'Compra Ágil', private: 'Oportunidad privada', project: 'Proyecto' };
const STATES: Record<string, string> = { unassigned: 'Sin asignar', assigned: 'Asignada', working: 'En gestión', blocked: 'Bloqueada', submitted: 'Presentada', won: 'Ganada', lost: 'Perdida', archived: 'Archivada', queued: 'En cola', running: 'En curso', waiting: 'Continuando', ready: 'Terminado', failed: 'No terminó' };
const ACTIVE = ['queued', 'running', 'waiting'];
const date = (value: string | null | undefined) => humanDate(value, true) || 'Sin fecha';
const localDate = (value: string) => value ? new Date(value).toISOString() : null;
/** «Hoy», «Mañana», «En 3 días», «En una semana»: the next action at 9:00 local time, as the date field writes it. */
const QUICK_DUE: Array<[string, number]> = [['Hoy', 0], ['Mañana', 1], ['En 3 días', 3], ['En una semana', 7]];
const dueIn = (days: number) => { const at = new Date(); at.setDate(at.getDate() + days); at.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0'); return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T09:00`; };
const money = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
const list = (s: string) => (s || '').split('\n').map(s => s.trim()).filter(Boolean);
/** «el cierre, el monto y la hora» */
const listEs = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '';
async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }
/** Each opportunity has its own address (?op=…): the browser's back button returns to the list and a teammate can open the same link. */
const opportunityInUrl = () => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('op');
/** The pipeline's first page of each stage nobody works yet, and the size of «Cargar más» (workspace-pipeline.ts). */
const PAGE = 60;
const FIRST_PAGE: Record<PagedStage, number> = { found: PAGE, recommended: PAGE, excluded: 0 };

export function OpportunityWorkWorkspace() {
  const { user } = useAuth();
  // When this person opened each opportunity, kept in this browser (progress.ts): the cards say «Abierta hace 1 min» on the way back.
  const [opened, setOpened] = useState<Record<string, number>>({});
  const openedRef = useRef(opened); openedRef.current = opened;
  useEffect(() => { try { setOpened(parseOpened(window.localStorage.getItem(openedKey(user?.id)))); } catch { setOpened({}); } }, [user?.id]);
  const [overview, setOverview] = useState<(WorkspaceOverview & { suggestion?: any }) | null>(null);
  const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('recommended');
  // The pipeline and the list share the words searched (read 300 ms after the last key) and the source picked.
  const [search, setSearch] = useState(''); const [source, setSource] = useState<OpportunitySource>('all');
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [search, filter, source]);
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState('summary'); const [modal, setModal] = useState<'create' | 'context' | 'assign' | 'task' | 'criteria' | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({}); const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState(''); const [pendingQuestion, setPendingQuestion] = useState<string | null>(null); const [messages, setMessages] = useState<any[]>([]);
  const [feedback, setFeedback] = useState(''); const selectedRef = useRef(selected); selectedRef.current = selected; const busyRef = useRef(false);
  const [download, setDownload] = useState('pdf');
  const [reconsider,setReconsider]=useState(false);
  // The admin sees the pipeline first; «Lista» keeps the filters and cards; «Mercado público» reads ChileCompra (what the
  // State plans to buy, the contracts that end, the competitors); «Asistente» is the section's general conversation, for everyone.
  const [view, setView] = useState<'pipeline' | 'list' | 'market' | 'assistant'>('pipeline');
  const [assistantThread, setAssistantThread] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // A question the assistant hands to one opportunity's chat: asked there once its expediente is open.
  const handoff = useRef<{ id: string; question: string | null } | null>(null);
  const [pipeline, setPipeline] = useState<{ items: WorkItem[]; work: WorkRecord[]; totals: { found: number; recommended: number; excluded?: number };
    limits?: Partial<Record<PagedStage, number>>; summaries?: { waiting: number }; progress?: Record<string, CardProgress> } | null>(null);
  // How many of each stage nobody works yet the pipeline asks for: «Cargar más» adds a page; a new search, source or order starts over.
  const [sort, setSort] = useState<PrioritySort>('priority');
  const filterKey = `${source}|${search}|${sort}`;
  const [paging, setPaging] = useState<{ key: string; limits: Record<PagedStage, number> }>({ key: '', limits: FIRST_PAGE });
  const limits = paging.key === filterKey ? paging.limits : FIRST_PAGE;
  const [loadingMore, setLoadingMore] = useState<PagedStage | null>(null);
  // Which search and source the pipeline on screen answers: while a new one loads, the old cards fade.
  const [pipelineFor, setPipelineFor] = useState(filterKey);
  // «Cargar oportunidad»: from a document the AI reads (prefill.ts) or typed, and what the reading found.
  const [createMode, setCreateMode] = useState<'upload' | 'write'>('upload');
  const [prefill, setPrefill] = useState<{ status: 'idle' | 'reading' | 'done' | 'error'; name?: string; missing?: string[]; partial?: boolean; message?: string }>({ status: 'idle' });
  const [suggestions, setSuggestions] = useState<PipelineSuggestion[] | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const watching = useRef<string | null>(null);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(''), 6000); return () => clearTimeout(timer); }, [feedback]);
  useEffect(() => { const read = () => setSelected(opportunityInUrl()); read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read); }, []);
  // The list reads with the search and source only while it is on screen: typing in the pipeline does not read the list too.
  const listShown = view === 'list' || overview?.mode !== 'management';
  const listSearch = listShown ? search : ''; const listSource = listShown ? source : 'all';
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const result = await json(await fetch(`/api/commercial-opportunities/workspace?${new URLSearchParams({ view: filter, query: listSearch, page: String(page), source: listSource })}`, { cache: 'no-store', signal }));
      if (!signal?.aborted) { setOverview(result); setProblem(''); }
    } catch (e) { if (!signal?.aborted) { setProblem(e instanceof Error ? e.message : 'No se pudo cargar.'); setOverview(null); } }
  }, [filter, listSearch, page, listSource]);
  // The list is read again every minute while it is on view; an open opportunity or a hidden tab does not ask for it.
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal);
    const refresh = () => { if (!document.hidden && !selectedRef.current) void load(controller.signal); };
    const timer = setInterval(refresh, 60_000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);
  const loadDetail = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      const value = await json(await fetch(`/api/commercial-opportunities/${id}/workspace`, { cache: 'no-store', signal }));
      const chat = await json(await fetch(`/api/commercial-opportunities/${id}/chat`, { cache: 'no-store', signal }));
      if (!signal?.aborted && selectedRef.current === id) { setDetail(value); setMessages(chat.messages || []); }
    } catch (e) { if (!signal?.aborted && selectedRef.current === id) { setDetail(null); setMessages([]); setProblem(e instanceof Error ? e.message : 'No se pudo abrir.'); } }
  }, []);
  useEffect(() => {
    setDetail(null); setMessages([]); setTab('summary'); setNote(''); setPendingQuestion(null); watching.current = null;
    if (!selected) return; const controller = new AbortController(); void loadDetail(selected, controller.signal);
    // Every 8 s while a report or an answer is on its way, every 45 s otherwise, and never in a hidden tab.
    let last = Date.now();
    const timer = setInterval(() => {
      if (document.hidden || (!busyRef.current && Date.now() - last < 45_000)) return;
      last = Date.now(); void loadDetail(selected, controller.signal);
    }, 8000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected, loadDetail]);
  const research = detail?.jobs.find(j => j.kind === 'research') ?? null;
  const researching = Boolean(research && ACTIVE.includes(research.state));
  const offerJob = detail?.jobs.find(j => j.kind === 'offer') ?? null;
  const preparingOffer = Boolean(offerJob && ACTIVE.includes(offerJob.state));
  // Images and scanned pages the AI is reading (workspace-scans.ts).
  const scanning = (detail?.jobs || []).flatMap(j => j.documentId && ACTIVE.includes(j.state) ? [j.documentId] : []);
  busyRef.current = researching || preparingOffer || scanning.length > 0 || messages.some(m => !m.answer?.answer);
  const offerWatch = useRef<string | null>(null);
  // Same for the offer draft: say it is ready when the one the person asked for arrives.
  useEffect(() => {
    if (!offerJob) return;
    if (ACTIVE.includes(offerJob.state)) { offerWatch.current = offerJob.id; return; }
    if (offerWatch.current === offerJob.id && offerJob.state === 'ready') { offerWatch.current = null; setFeedback('Tu borrador de oferta está listo.'); }
  }, [offerJob]);
  // Say so when the report the person is waiting for arrives, then show it.
  useEffect(() => {
    if (!research) return;
    if (ACTIVE.includes(research.state)) { watching.current = research.id; return; }
    if (watching.current === research.id && research.state === 'ready') { watching.current = null; setTab('summary'); setFeedback(isSignalKind(detail?.item.kind) ? 'La ficha comercial está lista.' : 'Tu informe está listo.'); }
  }, [research, detail?.item.kind]);
  const admin = overview?.mode === 'management';
  // Only the latest reading lands: a search typed while another one loads does not get overwritten by the older answer.
  const pipelineRequest = useRef(0);
  const loadPipeline = useCallback(async () => {
    const request = ++pipelineRequest.current; const key = `${source}|${search}|${sort}`;
    try {
      const params = new URLSearchParams({ view: 'pipeline', source, query: search, sort, found: String(limits.found), recommended: String(limits.recommended), excluded: String(limits.excluded) });
      const result = await json(await fetch(`/api/commercial-opportunities/workspace?${params}`, { cache: 'no-store' }));
      if (request === pipelineRequest.current) { setPipeline(result); setPipelineFor(key); }
    }
    catch (e) { if (request === pipelineRequest.current) { setProblem(e instanceof Error ? e.message : 'No se pudo cargar el embudo.'); setPipelineFor(key); } }
    finally { if (request === pipelineRequest.current) setLoadingMore(null); }
  }, [source, search, sort, limits]);
  const loadMore = useCallback((stage: PagedStage) => { setLoadingMore(stage); setPaging({ key: filterKey, limits: { ...limits, [stage]: Math.min(600, limits[stage] + PAGE) } }); }, [filterKey, limits]);
  const clearFilters = () => { setQuery(''); setSearch(''); setSource('all'); };
  useEffect(() => { if (admin && view === 'pipeline' && !selected) void loadPipeline(); }, [admin, view, selected, loadPipeline]);
  // Cards still waiting for their line of summary: the pipeline is read again every 20 seconds, for five minutes at most; after
  // that the faint lines go away instead of promising something that is not coming while the page stays open.
  const summaryReloads = useRef(0);
  const [summariesStalled, setSummariesStalled] = useState(false);
  useEffect(() => {
    if (!pipeline?.summaries?.waiting) { summaryReloads.current = 0; setSummariesStalled(false); return; }
    if (view !== 'pipeline' || selected) return;
    if (summaryReloads.current >= 15) { setSummariesStalled(true); return; }
    const timer = setTimeout(() => { summaryReloads.current++; void loadPipeline(); }, 20_000);
    return () => clearTimeout(timer);
  }, [pipeline, view, selected, loadPipeline]);
  // Something is being researched: the cards say so and the pipeline is read again every 15 seconds (half an hour at most),
  // so «Investigando…» turns into «Informe listo» without anyone pressing anything.
  const anyResearching = Object.values(pipeline?.progress || {}).some(isResearching);
  const researchReloads = useRef(0);
  useEffect(() => {
    if (!anyResearching) { researchReloads.current = 0; return; }
    if (view !== 'pipeline' || selected || researchReloads.current >= 120) return;
    const timer = setTimeout(() => { researchReloads.current++; void loadPipeline(); }, 15_000);
    return () => clearTimeout(timer);
  }, [anyResearching, pipeline, view, selected, loadPipeline]);
  const readDocument = async (file: File) => {
    setPrefill({ status: 'reading', name: file.name }); setProblem('');
    try {
      const body = new FormData(); body.set('file', file);
      const result = await json(await fetch('/api/commercial-opportunities/workspace/prefill', { method: 'POST', body }));
      const found = Object.fromEntries(Object.entries(result.fields || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined));
      setDraft(current => ({ ...current, ...found }));
      // The document stays with the opportunity, as one of its bases.
      setFiles(current => [file, ...current.filter(item => item.name !== file.name)]);
      setPrefill({ status: 'done', name: file.name, missing: result.missing || [], partial: Boolean(result.partial) });
      setCreateMode('write');
    } catch (e) { setPrefill({ status: 'error', name: file.name, message: e instanceof Error ? e.message : 'No pudimos leer el documento. Escribe los datos.' }); }
  };
  const review = async () => {
    setReviewing(true); setProblem('');
    try { const result = await json(await fetch('/api/commercial-opportunities/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pipeline_review', data: {} }) }));
      setSuggestions(result.suggestions ?? []); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'La IA no pudo revisar el embudo.'); }
    finally { setReviewing(false); }
  };
  const moveTo = async (id: string, state: WorkRecord['state'], revision: number) => {
    const done = await perform('state', { state, expectedRevision: revision }, id, true);
    if (done) { setSuggestions(current => current?.filter(s => s.id !== id) ?? null); await loadPipeline(); setFeedback(`Movida a «${WORK_STATE_LABELS[state]}».`); }
  };
  const perform = async (action: string, data: unknown, id = selected, quiet = false) => {
    setBusy(true); setProblem(''); setFeedback('');
    try {
      const endpoint = id ? `/api/commercial-opportunities/${id}/workspace` : '/api/commercial-opportunities/workspace';
      const result = await json(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) }));
      // The open expediente first: it is what the person is looking at, and the list takes longer.
      if (id) await loadDetail(id); await load(); if (!quiet) setFeedback(result.jobId || result.queued ? 'Trabajo en cola. Puedes continuar y volver cuando termine.' : 'Cambios guardados.');
      return result;
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar.'); return null; }
    finally { setBusy(false); }
  };
  // A mark on the report saves on its own: no reload of the expediente and no «Cambios guardados» banner for a tick.
  const mark = async (change: MarkChange): Promise<ReportMark | null> => {
    if (!selected) return null;
    try {
      const saved = await json(await fetch(`/api/commercial-opportunities/${selected}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark', data: change }) })) as ReportMark;
      // The report and «Cómo postular» tick the same items: both read the saved mark when they open.
      setDetail(current => current?.marks ? { ...current, marks: { ...current.marks, items: { ...current.marks.items, [saved.key]: saved } } } : current);
      // Taking back the step to submit can take the opportunity back from «Presentada»: read the stage again, quietly.
      if (change.done === false && detail?.work?.state === 'submitted') void loadDetail(selected).then(() => load());
      return saved;
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar la marca.'); return null; }
  };
  const open = (id: string) => {
    setProblem(''); setSelected(id);
    const next = markOpened(openedRef.current, id); setOpened(next);
    try { window.localStorage.setItem(openedKey(user?.id), JSON.stringify(next)); } catch { /* private mode: it is remembered until the page closes */ }
    if (opportunityInUrl() !== id) window.history.pushState(null, '', `${window.location.pathname}?op=${encodeURIComponent(id)}`);
    window.scrollTo({ top: 0 });
    for (const n of overview?.notifications.filter(n => n.opportunity_id === id && !n.read_at) || []) void fetch('/api/commercial-opportunities/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notification', data: { id: n.id } }) });
  };
  const close = () => { setSelected(null); setProblem(''); if (opportunityInUrl()) window.history.pushState(null, '', window.location.pathname); };
  const prepareOffer = (instructions: string) => {
    void perform('offer', { requestId: crypto.randomUUID(), ...(instructions ? { instructions } : {}) }, selected, true)
      .then(result => { if (result) setFeedback('Preparando el borrador de oferta. Tarda unos minutos: te avisaremos cuando esté listo.'); });
  };
  // Prices save on their own, like the marks: no reload of the expediente.
  const saveOfferPrices = async (draftId: string, expectedRevision: number, prices: Record<string, string>) => {
    if (!selected) return null;
    try {
      const saved = await json(await fetch(`/api/commercial-opportunities/${selected}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'offer_prices', data: { draftId, expectedRevision, prices } }) })) as { revision: number; prices: OfferPrices };
      setDetail(current => current?.offer?.latest?.id === draftId ? { ...current, offer: { ...current.offer, latest: { ...current.offer.latest, revision: saved.revision, prices: saved.prices } } } : current);
      return saved;
    } catch (e) {
      // Prices a teammate saved meanwhile come in, so the next save starts from them.
      setProblem(e instanceof Error ? e.message : 'No se pudieron guardar los precios.'); void loadDetail(selected); return null;
    }
  };
  const generate = () => { if (!detail) return; if (admin && detail.item.data.evaluation === 'excluded' && !detail.reports.length) setReconsider(true); else { setTab('summary'); void perform('research', {}, selected, true); } };
  // The question shows at once; the answer arrives in the same wait (the server answers it now) or, if a worker took it, by polling.
  const ask = (text: string) => { setTab('chat'); setPendingQuestion(text); void perform('chat', { question: text, requestId: crypto.randomUUID() }, selected, true).finally(() => setPendingQuestion(null)); };
  // «¿Cumplimos?»: read now with the profile; an answer is saved in the profile first (workspace-fit.ts).
  const checkFit = async (action: 'fit' | 'fit_answer', data: Record<string, string>) => {
    const result = await perform(action, data, selected, true);
    if (result) setFeedback(action === 'fit_answer' ? 'Guardado en tu ficha para licitaciones. Revisamos los requisitos con tu respuesta.' : result.queued ? 'Revisando los requisitos con tu ficha. Tarda unos segundos.' : 'Requisitos revisados con tu ficha.');
  };
  const continueIn = (id: string, question: string | null) => { handoff.current = { id, question }; open(id); };
  useEffect(() => {
    const next = handoff.current;
    if (!detail || !next || next.id !== detail.item.id) return;
    handoff.current = null;
    if (next.question) ask(next.question); else setTab('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the expediente the assistant handed over opens.
  }, [detail]);
  const upload = async (picked: File[], report: (u: Array<{ name: string; state: 'uploading' | 'done' | 'error'; message?: string }>) => void) => {
    if (!selected) return;
    // A ZIP from Mercado Público («Descargar todos») goes up as the documents inside it (zip-uploads.ts).
    const zips = picked.filter(isZip);
    if (zips.length) report(zips.map(f => ({ name: f.name, state: 'uploading', message: 'Abriendo el ZIP…' })));
    const { files, notes } = await expandZipUploads(picked);
    const states = files.map(f => ({ name: f.name, state: 'uploading' as 'uploading' | 'done' | 'error', message: undefined as string | undefined }));
    const left = notes.map(n => ({ name: n.name, state: 'error' as const, message: n.message }));
    report([...states, ...left]);
    setBusy(true);
    for (const [i, file] of files.entries()) {
      try { const body = new FormData(); body.set('file', file); await json(await fetch(`/api/commercial-opportunities/${selected}/documents`, { method: 'POST', body })); states[i] = { ...states[i], state: 'done' }; }
      catch (e) { states[i] = { ...states[i], state: 'error', message: e instanceof Error ? e.message : 'No se pudo subir.' }; }
      report([...states, ...left]);
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
  const kinds = sourceKinds(source);
  const items = (overview?.items || []).filter(item => {
    const work = overview?.work.find(w => w.opportunity_id === item.id);
    if (kinds.length && !kinds.includes(item.kind)) return false;
    if (search && ![item.title, item.company_name, item.buyer_name].join(' ').toLowerCase().includes(search.toLowerCase())) return false;
    if (!admin) return filter === 'recommended' || filter === 'all' || (work?.state || 'assigned') === filter;
    if (filter === 'assigned') return Boolean(work && work.state !== 'unassigned');
    return filter === 'all' || (item.data.evaluation || (item.kind === 'private' ? 'review' : 'pending')) === filter;
  });
  // With a source picked, its group is called by it («Compra Ágil», «Recibidas»), not by the family it belongs to.
  const listGroups = bySource(items).map(group => source === 'all' ? group : { ...group, label: OPPORTUNITY_SOURCES.find(item => item.id === source)?.label ?? group.label });
  const card = (item: WorkItem) => { const work = overview?.work.find(w => w.opportunity_id === item.id); const owner = overview?.members.find(m => m.user_id === work?.responsible_id); return <article key={item.id} className="rounded-xl border bg-background p-5"><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex flex-wrap items-center gap-2"><span>{TYPES[item.kind]}</span><AdvicePill item={item} />{item.data.evaluation === 'excluded' ? null : <PriorityStars score={item.score} />}<ProgressMarks marks={progressChips(null, opened[item.id])} /></span><span>{STATES[work?.state || 'unassigned']}</span></div><h3 className="mt-2 text-base font-semibold">{item.title}</h3>{opportunitySummary(item.data) ? <p className="mt-1 text-sm leading-6">{opportunitySummary(item.data)}</p> : null}<p className="mt-1 text-sm text-muted-foreground">{item.company_name || item.buyer_name}</p><p className="mt-3 text-sm leading-6">{item.reasons[0] || 'Pendiente de evaluación'}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{item.deadline_at && <span>Cierre: {date(item.deadline_at)}</span>}{item.amount ? <span>Monto: {money(item.amount)} {item.currency || ''}</span> : null}{work?.due_at && <span>Próxima acción: {date(work.due_at)}</span>}{owner && <span>Responsable: {owner.name}</span>}</div>{work?.objective && <p className="mt-3 text-sm">Objetivo: {work.objective}</p>}<Button variant="outline" size="sm" className="mt-4" onClick={() => open(item.id)}>Abrir y trabajar</Button></article>; };
  const title = admin ? 'Gestionar oportunidades' : 'Mis oportunidades asignadas';
  const item = detail?.item;
  const signal = isSignalKind(item?.kind);
  const latest = detail?.reports[0];
  const newerDocuments = latest ? (detail?.documents || []).filter(d => d.source_kind === 'upload' && Date.parse(d.created_at) > Date.parse(latest.created_at)) : [];
  const links = usePublicLinks(selected, item?.kind);
  const advice = item ? workAdvice(item) : null;
  // «Marcar como leídas»: each notice once, then the list again.
  const clearNews = async (ids: string[]) => {
    await Promise.all(ids.map(id => fetch('/api/commercial-opportunities/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notification', data: { id } }) }).catch(() => null)));
    await load();
  };
  return <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 sm:p-6">
    {!selected && <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{admin ? 'Hallazgos y oportunidades recibidas, con un equipo y una siguiente acción.' : 'Tus asignaciones, el equipo de trabajo y lo que hay que hacer después.'}</p></div>
      {admin && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={openContext}><Settings className="mr-2 h-4 w-4" />Empresa del workspace</Button><Button onClick={() => { setDraft({ currency: 'CLP',requestId:crypto.randomUUID() }); setFiles([]); setCreateMode('upload'); setPrefill({ status: 'idle' }); setModal('create'); }}><FilePlus2 className="mr-2 h-4 w-4" />Cargar oportunidad</Button></div>}
    </header>}
    {problem && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{problem}</p><Button size="sm" variant="outline" onClick={() => { setProblem(''); void load(); if (selected) void loadDetail(selected); }}>Reintentar</Button></div>}
    {feedback && <p role="status" className="rounded-xl border bg-muted/30 p-3 text-sm">{feedback}</p>}
    {!overview && !problem && <div role="status" className="rounded-xl border p-8"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Cargando oportunidades…</div>}
    {overview && !selected && <>
      {admin && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4"><div><p className="text-sm font-medium">{overview.context ? 'Oferta compartida confirmada' : 'Confirma qué ofrece tu empresa'}</p><p className="mt-1 text-xs text-muted-foreground">{overview.context ? `Búsqueda diaria ${(overview.context as any).automation && overview.sourceStatus.automation ? 'programada' : 'pausada'} · Límite mensual US$20 · US$${overview.budget.spent.toFixed(2)} usados` : 'La IA prepara los criterios desde tu oferta. No necesitas escribir palabras de búsqueda.'}</p></div>
        <div className="flex flex-wrap gap-2">{overview.context && (overview.context as any).criteria?.postQueries?.length ? <Button variant="ghost" onClick={openCriteria}><Search className="mr-2 h-4 w-4" />Qué buscamos</Button> : null}
          {overview.context ? <Button variant="ghost" onClick={() => setProfileOpen(true)}><ClipboardCheck className="mr-2 h-4 w-4" />Ficha para licitaciones</Button> : null}
          {overview.context ? (overview.sourceStatus.automation ? <Button variant="outline" disabled={busy} onClick={() => void perform('discover', {}, null)}>Actualizar oportunidades</Button> : null) : <Button onClick={openContext}>Confirmar oferta</Button>}</div></div>}
      {view !== 'assistant' && <NewsList notifications={overview.notifications} onOpen={open} onClear={ids => void clearNews(ids)} when={at => humanDate(at, true) ?? ''} />}
      {admin && view !== 'assistant' && overview.documentAlerts?.length ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-cw-warning-soft px-4 py-3 text-sm">
        <p className="min-w-0"><span className="font-medium">{overview.documentAlerts[0].text}</span>{overview.documentAlerts.length > 1 ? <span className="text-muted-foreground"> · y {overview.documentAlerts.length - 1} más por renovar</span> : null}</p>
        <Button size="sm" variant="outline" onClick={() => setProfileOpen(true)}>Ver documentos</Button></div> : null}
      {view !== 'assistant' && <TenderPrerequisites />}
      <div role="group" aria-label="Vista" className="inline-flex w-fit max-w-full flex-wrap rounded-xl bg-muted p-1">{(admin ? [['pipeline', 'Embudo'], ['list', 'Lista'], ['market', 'Mercado público'], ['assistant', 'Asistente']] as const : [['list', 'Mis oportunidades'], ['assistant', 'Asistente']] as const).map(([key, label]) => {
        const pressed = admin || key === 'assistant' ? view === key : view !== 'assistant';
        return <button key={key} type="button" aria-pressed={pressed} onClick={() => setView(key)} className={cn('rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', pressed ? 'bg-background shadow-sm' : 'text-foreground/70 hover:text-foreground')}>{label}</button>; })}</div>
      {view === 'assistant' ? <OpportunityAssistant admin={admin} threadId={assistantThread} onThread={setAssistantThread} onOpen={open} onHandoff={continueIn} />
        : admin && view === 'market' ? <PublicMarket onOpen={open} onCriteria={(overview.context as any)?.criteria ? openCriteria : undefined} onProfile={() => setProfileOpen(true)} />
        : admin && view === 'pipeline' ? <>
        <OpportunityFilters query={query} onQuery={setQuery} source={source} onSource={setSource} />
        {pipeline ? <PipelineBoard items={pipeline.items} work={pipeline.work} totals={pipeline.totals} limits={pipeline.limits} members={overview.members} busy={busy} summariesWaiting={Boolean(pipeline.summaries?.waiting) && !summariesStalled}
        suggestions={suggestions} reviewing={reviewing} onReview={() => void review()} onMove={(id, state, revision) => void moveTo(id, state, revision)} onOpen={open}
        filtered={Boolean(search) || source !== 'all'} loadingMore={loadingMore} refreshing={pipelineFor !== filterKey} sort={sort} onSort={setSort} progress={pipeline.progress} opened={opened} onMore={loadMore} onClearFilters={clearFilters} />
        : <div role="status" className="rounded-3xl border p-8 text-sm text-muted-foreground"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Cargando el embudo…</div>}</> : <>
      <OpportunityFilters query={query} onQuery={setQuery} source={source} onSource={setSource} showSources={admin}>
        <div role="group" aria-label="Filtrar oportunidades" className="flex flex-wrap gap-1">{filters.map(([key, label]) => <Button key={key} size="sm" variant={filter === key ? 'secondary' : 'ghost'} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</Button>)}</div>
      </OpportunityFilters>
      {!items.length && <section className="rounded-xl border p-8"><h2 className="font-semibold">{admin ? 'No hay oportunidades en esta vista' : 'Aún no tienes oportunidades en esta vista'}</h2><p className="mt-2 max-w-xl text-sm text-muted-foreground">{search || source !== 'all' ? 'Prueba otro texto, otra fuente o cambia el filtro.' : admin ? 'Confirma la oferta para recibir hallazgos o carga una oportunidad que haya recibido el equipo.' : 'Las oportunidades que te asigne un administrador aparecerán aquí con tu equipo y las próximas acciones.'}</p>
        {search || source !== 'all' ? <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Quitar filtros</Button> : null}</section>}
      {admin && filter === 'recommended' && !search && source === 'all' && <StartHere items={items} onOpen={open} />}
      {items.length > 0 && <div className="space-y-8">{listGroups.map(group => <section key={group.key} aria-labelledby={`source-${group.key}`} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h2 id={`source-${group.key}`} className="text-lg font-semibold">{group.label} <span className="text-sm font-normal tabular-nums text-muted-foreground">{group.items.length}</span></h2><p className="text-xs text-muted-foreground">{group.note}</p></div>
        {admin && filter === 'excluded' ? <ExclusionGroups items={group.items} onOpen={open} /> : <div className="grid gap-3 xl:grid-cols-2">{group.items.map(card)}</div>}
      </section>)}</div>}
      </>}
      {!(admin && (view === 'pipeline' || view === 'market')) && view !== 'assistant' && <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><p className="text-xs text-muted-foreground">Página {page + 1} · hasta 100 oportunidades</p><Button variant="outline" disabled={overview.items.length < 100} onClick={() => setPage(p => p + 1)}>Siguiente</Button></div>}
    </>}
    {selected && <>
      <Button variant="ghost" className="-ml-2 self-start" onClick={close}><ArrowLeft className="mr-2 h-4 w-4" />Oportunidades</Button>
      {!detail && !problem && <div role="status" className="rounded-xl border p-8"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Abriendo la oportunidad…</div>}
      {detail && item && <>
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{TYPES[item.kind]}</span><AdvicePill item={item} decision={latest ? reportDecision({ recommendation: latest.report.recommendation, kind: latest.report.kind ?? item.kind }) : undefined} /><span>· {STATES[detail.work?.state || 'unassigned']}</span></div>
          <h1 className="max-w-4xl text-2xl font-semibold tracking-tight">{item.title}</h1>
          <p className="text-sm text-muted-foreground">{item.company_name || item.buyer_name}</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {!signal && <div><dt className="text-xs text-muted-foreground">Cierre</dt><dd className="font-medium">{humanDate(item.deadline_at, true) ?? 'Sin fecha informada'}{advice && closesLabel(advice) ? <span className={cn('ml-2 text-xs', advice.urgent ? 'text-destructive' : 'text-muted-foreground')}>{closesLabel(advice)}</span> : null}</dd></div>}
            {!signal && <div><dt className="text-xs text-muted-foreground">Monto</dt><dd className="font-medium">{item.amount ? `${money(item.amount)} ${item.currency || ''}` : 'No informado'}</dd></div>}
            {typeof (item.data as any)?.observed?.code === 'string' && <div><dt className="text-xs text-muted-foreground">Código</dt><dd className="font-medium">{(item.data as any).observed.code}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">Equipo</dt><dd className="flex items-center gap-2 font-medium">{detail.participants.length ? <><span className="flex -space-x-2" aria-hidden="true">{detail.participants.slice(0, 4).map(p => <InitialsAvatar key={p.user_id} name={p.name} size="sm" className="ring-2 ring-background" />)}</span><span>{detail.participants.map(p => `${p.name}${p.user_id === detail.work?.responsible_id ? ' (responsable)' : ''}`).join(', ')}</span></> : 'Sin asignar'}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {/* One main action per screen: while the guide shows its own «Generar», the header does not repeat it. */}
            {/* With the report ready, the main action is the next step: applying, or finding whom to write to. */}
            {latest && !researching && <Button onClick={() => setTab(signal ? 'contacts' : 'apply')}>{signal ? <Users className="mr-2 h-4 w-4" aria-hidden="true" /> : <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" />}{signal ? 'Buscar a quién escribir' : 'Cómo postular'}</Button>}
            {(latest || researching || tab !== 'summary') && <Button variant={latest && !researching ? 'ghost' : 'default'} onClick={generate} disabled={busy || researching}>{researching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{researching ? 'Preparando…' : latest ? (signal ? 'Actualizar ficha comercial' : 'Actualizar informe') : (signal ? 'Generar ficha comercial' : 'Generar informe')}</Button>}
            {admin && <Button variant="outline" onClick={() => { setDraft({ teamId: detail.work?.team_id || '', participantIds: detail.participants.map(p => p.user_id), responsibleId: detail.work?.responsible_id || '', objective: detail.work?.objective || '' }); setModal('assign'); }}><Users className="mr-2 h-4 w-4" />Asignar equipo</Button>}
            {item.url && <Button asChild variant="ghost"><a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />{item.kind === 'tender' ? 'Ver en Mercado Público' : signal ? 'Ver en LinkedIn' : 'Ver fuente'}</a></Button>}
          </div>
          {detail.work?.objective && <p className="text-sm">Objetivo: {detail.work.objective}</p>}
        </header>
        <div className="flex flex-wrap gap-1 border-b pb-2" aria-label="Secciones de la oportunidad">{[['summary', signal ? 'Ficha comercial' : 'Informe'], ...(signal ? [] : [['apply', 'Cómo postular']]), ...(MARKET_KINDS.includes(item.kind) ? [['market', 'Cómo ganar']] : []), ['documents', `Documentos${detail.documents.length ? ` · ${detail.documents.length}` : ''}`], ['chat', 'Preguntar a la IA'], ['tasks', 'Plan y tareas'], ['contacts', 'Contactos'], ['activity', 'Actividad']].map(([id, label]) => <Button key={id} size="sm" variant={tab === id ? 'secondary' : 'ghost'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Button>)}</div>
        {tab === 'summary' && <div className="space-y-5">
          {detail.participants.length ? <section aria-label="Equipo de trabajo" className="space-y-2"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Equipo de trabajo</h2>{admin && <Button variant="ghost" size="sm" onClick={() => { setDraft({ teamId: detail.work?.team_id || '', participantIds: detail.participants.map(p => p.user_id), responsibleId: detail.work?.responsible_id || '', objective: detail.work?.objective || '' }); setModal('assign'); }}>Cambiar equipo</Button>}</div>
            <TeamOffice people={detail.participants} responsibleId={detail.work?.responsible_id} /></section> : null}
          {research && (researching || ['failed', 'blocked'].includes(research.state)) && <ReportProgress state={research.state} error={research.error} signal={signal} pending={busy} onRetry={generate} kept={Boolean(latest)}
            progress={research.progress} tender={item.kind === 'tender'} documents={detail.documents.length} buyer={item.buyer_name || item.company_name} />}
          {latest && newerDocuments.length > 0 && !researching && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-4 text-sm"><p>Subiste {newerDocuments.length === 1 ? 'un documento nuevo' : `${newerDocuments.length} documentos nuevos`} después del informe. Actualízalo para incluir{newerDocuments.length === 1 ? 'lo' : 'los'}.</p><Button size="sm" onClick={generate} disabled={busy}>Actualizar informe</Button></div>}
          {latest && item.kind === 'tender' && !advice?.closed && !detail.documents.some(d => d.source_kind === 'upload') && !researching && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cw-warning-soft p-4 text-sm"><p>Este informe se hizo sin las bases. Súbelas para completarlo: la IA podrá revisar requisitos, criterios y garantías.</p><Button size="sm" variant="outline" onClick={() => setTab('documents')}>Subir bases</Button></div>}
          {!latest && !researching && <ExpedientGuide kind={item.kind} url={item.url} links={links} documents={detail.documents} onUpload={upload} onGenerate={generate} generating={researching} hasReport={false} busy={busy} closed={advice?.closed ? humanDate(item.deadline_at) : null} />}
          {!latest && !researching && item.reasons[0] && <div className="rounded-2xl border p-5"><h2 className="text-sm font-semibold">Por qué apareció</h2><p className="mt-2 text-sm leading-6">{item.reasons.join(' ')}</p></div>}
          {latest && <>
            <div className="flex flex-wrap items-center justify-end gap-2"><label className="sr-only" htmlFor="op-export">Formato de descarga</label><select id="op-export" value={download} onChange={e => setDownload(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring">{[['pdf', 'PDF'], ['docx', 'Word'], ['xlsx', 'Excel'], ['md', 'Markdown'], ['zip', 'Expediente completo (ZIP)']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button asChild variant="outline" size="sm"><a href={`/api/commercial-opportunities/${selected}/export?format=${download}`}><Download className="mr-2 h-4 w-4" />Descargar</a></Button></div>
            <OpportunityWorkReport report={latest.report} opportunity={{ id: item.id, kind: item.kind, code: (item.data as { observed?: { code?: string } } | null)?.observed?.code ?? null, url: item.url, title: item.title, buyer: item.buyer_name || item.company_name, deadline: item.deadline_at, amount: item.amount, currency: item.currency }}
              onTask={(title, evidence) => { setDraft({ title, evidence }); setModal('task'); }} onAsk={ask} onContacts={() => setTab('contacts')}
              marks={detail.marks} onMark={mark} people={detail.members || detail.participants}
              fit={detail.fit} fitBusy={busy} onFit={() => void checkFit('fit', {})} onAnswer={(question, answer) => void checkFit('fit_answer', { question, answer })} />
          </>}
        </div>}
        {tab === 'apply' && !signal && <SubmissionKit report={latest?.report ?? null} opportunity={{ title: item.title, kind: item.kind, amount: item.amount, currency: item.currency, deadline: item.deadline_at }}
          marks={detail.marks} onMark={mark} people={detail.members || detail.participants} onGenerate={generate} generating={researching}
          hideNumbers={Boolean(detail.offer?.latest?.draft.economic.lines.length)}
          annexes={detail.offer?.latest?.draft.annexes} annexHref={index => `/api/commercial-opportunities/${selected}/export?doc=offer&format=docx&annex=${index}`}
          offer={latest && OFFER_KINDS.includes(item.kind) ? <OfferDraft offer={detail.offer} job={offerJob} onPrepare={prepareOffer} preparing={busy} onSavePrices={saveOfferPrices}
            downloadHref={`/api/commercial-opportunities/${selected}/export?doc=offer&format=docx`}
            annexHref={index => `/api/commercial-opportunities/${selected}/export?doc=offer&format=docx&annex=${index}`}
            budget={{ amount: latest.report.submission?.numbers.budget ?? item.amount, includesTax: latest.report.submission?.numbers.budgetIncludesTax ?? null }} /> : null}
          onDraft={latest ? title => ask(`Prepara el borrador de «${title}» como un formulario listo para llenar y pegar en Word: el título tal como lo dan las bases, una tabla de dos columnas (Campo | Dato) con los datos de mi empresa que conoces, el texto de cada declaración o cláusula tal como lo piden las bases, y [corchetes] para lo que falte. Si no tienes el formato oficial en los fragmentos, dilo al comienzo en una frase.`) : undefined} />}
        {tab === 'market' && MARKET_KINDS.includes(item.kind) && <WinPlan id={selected} />}
        {tab === 'documents' && <section className="space-y-5">
          {!signal && <ExpedientGuide kind={item.kind} url={item.url} links={links} documents={detail.documents} onUpload={upload} onGenerate={generate} generating={researching} hasReport={Boolean(latest)} busy={busy} closed={advice?.closed ? humanDate(item.deadline_at) : null} />}
          {signal && <p className="text-sm text-muted-foreground">Las señales de LinkedIn no tienen bases. Si recibiste algo de esta empresa (una invitación, un requerimiento), súbelo en <button type="button" className="underline" onClick={() => document.getElementById('op-document')?.click()}>Documentos</button>.</p>}
          {signal && <input id="op-document" type="file" multiple accept={ACCEPTED_FILES} className="sr-only" onChange={e => void upload(Array.from(e.target.files || []), () => undefined)} />}
          <div><h2 className="mb-3 font-semibold">En el expediente</h2><DocumentList id={selected} documents={detail.documents} kind={item.kind} scanning={scanning} /></div>
        </section>}
        {tab === 'tasks' && <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Plan de trabajo</h2><Button variant="outline" onClick={() => { setDraft({}); setModal('task'); }}>Crear tarea</Button></div>{!detail.tasks.length && <p className="rounded-xl border p-5 text-sm text-muted-foreground">{latest ? 'Crea la primera tarea o usa «Crear tarea» en los pasos del informe.' : 'Crea la primera tarea. Cuando generes el informe, podrás convertir sus pasos en tareas con un clic.'}</p>}{detail.tasks.map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-medium">{t.title}</p><p className="mt-1 text-xs text-muted-foreground">{date(t.due_at)} · {detail.participants.find(p => p.user_id === t.owner_id)?.name || 'Sin responsable'}</p>{t.evidence && <p className="mt-2 text-sm">{t.evidence}</p>}</div><select aria-label={`Estado de ${t.title}`} value={t.status} disabled={busy} onChange={e => void perform('task', { id: t.id, title: t.title, ownerId: t.owner_id, dueAt: t.due_at, status: e.target.value, evidence: t.evidence })} className="h-10 rounded-md border bg-background px-3 text-sm">{[['pending', 'Pendiente'], ['working', 'En curso'], ['done', 'Realizada'], ['blocked', 'Bloqueada']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}{detail.work && <div className="flex flex-wrap items-center gap-2 border-t pt-3"><span className="text-xs text-muted-foreground">Cambiar estado:</span>{['working', 'blocked', 'submitted', ...(admin ? ['won', 'lost', 'archived'] : [])].map(state => <Button variant="outline" size="sm" key={state} disabled={busy} onClick={() => void perform('state', { state, expectedRevision: detail.work!.revision })}>{STATES[state]}</Button>)}</div>}</section>}
        {tab === 'contacts' && <OpportunityContacts id={selected} company={item.company_name || item.buyer_name || item.title} domain={item.company_domain} titles={detail.decisionMakerTitles || []} />}
        {tab === 'activity' && <section className="space-y-4"><h2 className="font-semibold">Actividad del equipo</h2><form onSubmit={e => { e.preventDefault(); void perform('activity', { kind: 'note', text: note, dueAt: null }).then(r => { if (r) setNote(''); }); }} className="space-y-2"><Label htmlFor="op-note">Registrar avance o nota</Label><Textarea id="op-note" value={note} onChange={e => setNote(e.target.value)} maxLength={4000} placeholder="Ej.: enviamos las consultas al comprador; esperamos respuesta el 23 de octubre." /><Button disabled={busy || !note.trim()}>Guardar avance</Button></form><ol aria-label="Actividad" className="ml-3.5 space-y-5 border-l border-border/70 pl-6">{detail.activity.map(a => { const who = (detail.members || detail.participants).find(p => p.user_id === a.actor_id)?.name || 'El sistema'; return <li key={a.id} className="relative"><InitialsAvatar name={who} size="sm" className="absolute -left-[38px] top-0 ring-4 ring-background" /><p className="text-sm leading-6">{a.body}</p><p className="text-xs text-muted-foreground">{who} · {date(a.created_at)}</p></li>; })}</ol></section>}
        {tab === 'chat' && <OpportunityChat messages={messages} pending={pendingQuestion} documentCount={detail.documents.length} busy={busy}
          suggestions={signal ? SUGGESTED_QUESTIONS.signal : SUGGESTED_QUESTIONS.tender}
          placeholder={signal ? '¿Qué cargo debería contactar primero?' : 'Pregunta lo que quieras sobre esta licitación…'} onAsk={ask} />}
      </>}
    </>}
    {admin&&selected&&<OpportunityReconsiderDialog open={reconsider} onOpenChange={setReconsider} busy={busy} onConfirm={async reason=>Boolean(await perform('reconsider',{reason}))}/>}
    {admin && <TenderProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />}
    <Dialog open={modal !== null} onOpenChange={open => { if (!open && !busy) setModal(null); }}><DialogContent className={cn('max-h-[90dvh] overflow-y-auto', modal === 'context' || modal === 'create' ? 'sm:max-w-3xl' : 'sm:max-w-2xl')}><DialogHeader><DialogTitle>{modal === 'create' ? 'Cargar oportunidad recibida' : modal === 'context' ? 'Empresa del workspace' : modal === 'criteria' ? 'Qué buscamos para tu empresa' : modal === 'assign' ? 'Asignar equipo de trabajo' : 'Crear tarea'}</DialogTitle><DialogDescription>{modal === 'context' ? 'Lo que la IA sabe de tu empresa para buscar oportunidades y decidir cuáles te convienen.' : modal === 'criteria' ? 'La IA los preparó desde tu oferta. Corrígelos si algo no calza: uno por línea. Se usan desde la próxima búsqueda.' : modal === 'assign' ? 'Los participantes recibirán la asignación y podrán trabajar en el expediente.' : 'Completa la información disponible; los datos faltantes se identificarán en el análisis.'}</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={e => { e.preventDefault(); void saveModal().catch(e => setProblem(e instanceof Error ? e.message : 'Revisa los datos.')); }}>
        {modal === 'context' ? <>
          <WorkspaceCompanyFields draft={draft} field={field} />
          <OpportunityTicketConnection />
        </>
        : modal === 'criteria' ? <>{([['roles', 'Cargos en avisos de trabajo que revelan una necesidad'], ['keywords', 'Palabras para licitaciones y compras públicas'], ['postQueries', 'Búsquedas de publicaciones en LinkedIn'], ['decisionMakerTitles', 'Cargos de quienes deciden la compra']] as const).map(([key, label]) => <div key={key}><Label htmlFor={`op-criteria-${key}`}>{label}</Label><Textarea id={`op-criteria-${key}`} value={draft[key] || ''} onChange={e => field(key, e.target.value)} rows={key === 'postQueries' ? 5 : 4} required={key === 'postQueries'} /></div>)}</>
        : modal === 'assign' ? <>
          {overview?.groups.length ? <div className="space-y-1.5"><p className="text-sm font-medium">Usar un equipo del workspace · opcional</p><div className="flex flex-wrap gap-2">{overview.groups.map(g => <Button key={g.id} type="button" size="sm" variant={draft.teamId === g.id ? 'secondary' : 'outline'} aria-pressed={draft.teamId === g.id} onClick={() => field('teamId', draft.teamId === g.id ? '' : g.id)}>{g.name}</Button>)}</div><p className="text-xs text-muted-foreground">Suma a todas las personas de ese equipo.</p></div> : null}
          <div className="space-y-1.5"><p className="text-sm font-medium">¿Quién trabaja esta oportunidad?</p><p className="text-xs text-muted-foreground">Toca a cada persona; la estrella marca a quien responde por ella.</p>
            <TeamPicker members={overview?.members || []} selected={draft.participantIds || []} responsibleId={draft.responsibleId || ''} onChange={next => { field('participantIds', next.selected); field('responsibleId', next.responsibleId); }} /></div>
          <TeamOffice people={(overview?.members || []).filter(m => (draft.participantIds || []).includes(m.user_id))} responsibleId={draft.responsibleId} empty={draft.teamId ? 'Se sumará el equipo elegido.' : 'Elige a las personas y aquí verás a tu equipo.'} />
          <Label htmlFor="op-objective">Objetivo · opcional</Label><Input id="op-objective" value={draft.objective || ''} onChange={e => field('objective', e.target.value)} placeholder="Ej.: presentar la oferta antes del cierre" maxLength={500} />
          <div className="space-y-1.5"><p className="text-sm font-medium">Próxima acción · opcional</p><div className="flex flex-wrap items-center gap-2">{QUICK_DUE.map(([label, days]) => <Button key={label} type="button" size="sm" variant={draft.dueAt === dueIn(days) ? 'secondary' : 'outline'} aria-pressed={draft.dueAt === dueIn(days)} onClick={() => field('dueAt', dueIn(days))}>{label}</Button>)}<Input id="op-due" type="datetime-local" aria-label="Otra fecha y hora" className="h-9 w-auto" value={draft.dueAt || ''} onChange={e => field('dueAt', e.target.value)} /></div></div>
        </>
        : modal === 'task' ? <><Label htmlFor="op-task-title">Acción</Label><Input id="op-task-title" required value={draft.title || ''} onChange={e => field('title', e.target.value)} /><Label htmlFor="op-task-owner">Responsable</Label><select id="op-task-owner" value={draft.ownerId || ''} onChange={e => field('ownerId', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Sin asignar</option>{detail?.participants.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select><Label htmlFor="op-task-due">Fecha · hora local</Label><Input id="op-task-due" type="datetime-local" value={draft.dueAt || ''} onChange={e => field('dueAt', e.target.value)} /><Label htmlFor="op-task-evidence">Evidencia o resultado esperado</Label><Textarea id="op-task-evidence" value={draft.evidence || ''} onChange={e => field('evidence', e.target.value)} /></>
        : <>
          <div role="group" aria-label="Cómo cargarla" className="flex w-full rounded-xl bg-muted p-1 sm:w-fit">{([['upload', 'Subir documento'], ['write', 'Escribir los datos']] as const).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={createMode === key} disabled={prefill.status === 'reading'} onClick={() => setCreateMode(key)} className={cn('flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:flex-none', createMode === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}</div>
          {createMode === 'upload' ? <div className="space-y-3">
            <label htmlFor="op-prefill-file" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file && prefill.status !== 'reading') void readDocument(file); }}
              className={cn('flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40', prefill.status === 'reading' && 'cursor-wait')}>
              {prefill.status === 'reading' ? <Loader2 className="h-6 w-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" /> : <FileUp className="h-6 w-6 text-primary" aria-hidden="true" />}
              <span className="max-w-md space-y-1"><span className="block font-medium">{prefill.status === 'reading' ? `Leyendo «${prefill.name}»…` : 'Sube la invitación, las bases o el correo'}</span>
                <span className="block text-sm leading-6 text-muted-foreground">{prefill.status === 'reading' ? 'La IA está completando el formulario. Tarda unos segundos.' : 'La IA lee el documento y completa el formulario. Tú lo revisas antes de guardar.'}</span></span>
              {prefill.status !== 'reading' ? <span className="inline-flex h-9 items-center rounded-md border bg-background px-4 text-sm font-medium shadow-sm">Elegir documento</span> : null}
              <input id="op-prefill-file" type="file" className="sr-only" accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.html,.htm,.docm,.dotx,.xlsm,.xltx,.odt,.ods,.pptx,.rtf,.jpg,.jpeg,.png,.webp,.gif" disabled={prefill.status === 'reading'} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void readDocument(file); }} />
            </label>
            {prefill.status === 'reading' ? <p role="status" className="sr-only">Leyendo el documento</p> : null}
            {prefill.status === 'error' ? <p role="alert" className="text-sm text-destructive">{prefill.message}</p> : null}
            <p className="text-xs text-muted-foreground">PDF, Word, Excel, texto o una foto del documento, hasta 20 MB. El documento queda guardado con la oportunidad.</p>
          </div> : <>
            {prefill.status === 'done' ? <div role="status" className="flex gap-2 rounded-xl bg-primary/5 px-3 py-2.5 text-sm leading-6"><Sparkles className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><p>Completamos el formulario con «{prefill.name}». Revisa los datos antes de guardar.{prefill.missing?.length ? ` No encontramos ${listEs(prefill.missing)}.` : ''}{prefill.partial ? ' El documento es largo: leímos su primera parte.' : ''}</p></div> : null}
            {[['title', 'Nombre de la oportunidad'], ['company', 'Cliente o entidad convocante'], ['url', 'Enlace · opcional']].map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={`op-new-${key}`}>{label}</Label><Input id={`op-new-${key}`} type={key === 'url' ? 'url' : 'text'} required={key !== 'url'} value={draft[key] || ''} onChange={e => field(key, e.target.value)} /></div>)}
            <div className="space-y-2"><Label htmlFor="op-kind">Tipo</Label><select id="op-kind" value={draft.kind || 'private_tender'} onChange={e => field('kind', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="private_tender">Licitación privada</option><option value="proposal">Solicitud de propuesta</option><option value="quote">Solicitud de cotización</option><option value="commercial">Oportunidad comercial</option></select></div>
            <div className="space-y-2"><Label htmlFor="op-invitation">Invitación o contexto recibido</Label><Textarea id="op-invitation" rows={8} className="resize-y leading-6" value={draft.description || ''} onChange={e => field('description', e.target.value)} maxLength={40000} placeholder="Pega aquí el correo o mensaje con la invitación." /></div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]"><div className="space-y-2"><Label htmlFor="op-new-deadline">Cierre · hora local, opcional</Label><Input id="op-new-deadline" type="datetime-local" value={draft.deadline || ''} onChange={e => field('deadline', e.target.value)} /></div><div className="space-y-2"><Label htmlFor="op-amount">Monto · opcional</Label><Input id="op-amount" type="number" min={0} value={draft.amount || ''} onChange={e => field('amount', e.target.value)} /></div><div className="space-y-2"><Label htmlFor="op-currency">Moneda</Label><Input id="op-currency" value={draft.currency || 'CLP'} onChange={e => field('currency', e.target.value)} /></div></div>
            <div className="space-y-2"><Label htmlFor="op-new-files">Bases y anexos</Label><Input id="op-new-files" type="file" multiple accept={ACCEPTED_FILES} onChange={e => { const chosen = Array.from(e.target.files || []); e.target.value = ''; setFiles(current => [...current, ...chosen.filter(file => !current.some(item => item.name === file.name))]); }} />
              {files.length ? <ul className="flex flex-wrap gap-2" aria-label="Documentos que se subirán">{files.map(file => <li key={file.name} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-xs"><span className="truncate">{file.name}</span><button type="button" className="rounded-full p-1 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Quitar ${file.name}`} onClick={() => setFiles(current => current.filter(item => item !== file))}><X className="h-3 w-3" aria-hidden="true" /></button></li>)}</ul> : null}
              <p className="text-xs text-muted-foreground">PDF, Word, Excel o fotos, hasta 20 MB cada uno. También puedes subirlos después en Documentos.</p></div>
          </>}
        </>}
        {problem && modal && <p role="alert" className="text-sm text-destructive">{problem}</p>}<div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80"><Button variant="outline" type="button" disabled={busy} onClick={() => setModal(null)}>Cancelar</Button>{modal === 'create' && createMode === 'upload' ? null : <Button type="submit" disabled={busy || prefill.status === 'reading'}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{modal === 'context' ? 'Confirmar oferta' : modal === 'criteria' ? 'Guardar' : modal === 'assign' ? 'Asignar y notificar' : 'Guardar'}</Button>}</div>
      </form>
    </DialogContent></Dialog>
  </div>;
}
