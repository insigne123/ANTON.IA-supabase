'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, ClipboardCheck, Download, ExternalLink, FilePlus2, FileUp, Loader2, RotateCcw, Settings, Sparkles, UploadCloud, Users, X, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ActionBar } from '@/components/ui/action-bar';
import { SegmentedTabs, tabPanelProps } from '@/components/ui/segmented-tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { OpportunityWorkReport, SUGGESTED_QUESTIONS } from './OpportunityWorkReport';
import { SignalSheetPanel } from './SignalSheet';
import { SubmissionKit } from './SubmissionKit';
import { OfferDraft } from './OfferDraft';
import { PublicMarket } from './PublicMarket';
import { WinPlan } from './WinPlan';
import type { OfferPrices, SavedOfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import { withPartEdit, type OfferEdit, type OfferReview } from '@/lib/commercial-opportunities/offer-edits';
import { PipelineBoard, type PagedStage, type PipelineSuggestion } from './PipelineBoard';
import { PriorityStars } from './PriorityStars';
import { ProgressMarks } from './ProgressMarks';
import { PRIORITY_SORTS, parsePrioritySort, type PrioritySort } from '@/lib/commercial-opportunities/priority';
import { isResearching, markOpened, openedKey, parseOpened, progressChips, type CardProgress } from '@/lib/commercial-opportunities/progress';
import { useAuth } from '@/context/AuthContext';
import { OpportunityFilters, filterChip } from './OpportunityFilters';
import { WORK_STATE_LABELS, type PipelineWeekItem } from '@/lib/commercial-opportunities/pipeline';
import { opportunityRegion, opportunitySummary } from '@/lib/commercial-opportunities/summaries';
import type { MarkChange } from './ReportMarks';
import type { ReportMark, ReportMarks } from '@/lib/commercial-opportunities/report-marks';
import { OpportunityContacts } from './OpportunityContacts';
import { DecisionCallout, MemberStrip } from './MemberWork';
import { FitProposals } from './FitProposals';
import { PriceStudio } from './PriceStudio';
import { studioKey, type PriceStudyVersion, type SavedPriceStudy, type StudioDraft } from '@/lib/commercial-opportunities/price-studio';
import { MEMBER_FILTERS, isFinished, memberFilter, memberView, openDecision, pendingFitProposals } from '@/lib/commercial-opportunities/member-work';
import { OpportunityChat } from './OpportunityChat';
import { OpportunityAssistant } from './OpportunityAssistant';
import { TenderProfileSheet } from './TenderProfileSheet';
import type { OpportunityFitView } from './RequirementFit';
import { TeamOffice, TeamPicker } from './TeamOffice';
import { InitialsAvatar } from '@/components/initials-avatar';
import { useConfirm } from '@/components/confirm-dialog';
import { OpportunityTicketConnection } from './OpportunityTicketConnection';
import { SearchCriteriaFields } from './SearchCriteriaFields';
import { SearchHealthLine } from './SearchHealthLine';
import { CompanySetup } from './CompanySetup';
import { SavedSearches } from './SavedSearches';
import type { SetupStepId } from '@/lib/commercial-opportunities/company-setup';
import { criteriaDraft, draftToSave, type CriteriaDraft } from '@/lib/commercial-opportunities/search-settings';
import { CloseReasonDialog, type CloseTarget } from './CloseReasonDialog';
import { TenderResultCallout } from './TenderResultCallout';
import { OpportunityTasks } from './OpportunityTasks';
import { PlanTasksDialog, type PlannedTask } from './PlanTasksDialog';
import { MyTasks } from './MyTasks';
import { OpportunityActivity, type ActivityRow } from './OpportunityActivity';
import { addDays, chileDay, dayLabel, dayOfDueAt, dueAtOfDay, planTaskDrafts, type MyTask, type OpportunityTask, type TaskStatus } from '@/lib/commercial-opportunities/work-tasks';
import type { CloseDetail, StoredResult } from '@/lib/commercial-opportunities/close-outcome';
import { DiscardDialog, type DiscardTarget } from './DiscardDialog';
import { AssignmentRulesDialog, RuleAssignDialog, type rulesOf } from './AssignmentRules';
import { buyerSearch, readAdminSettings, ruleFor, ruleLabel, sameSearch, searchName, type RuleGroup, type SavedSearch, type SearchState } from '@/lib/commercial-opportunities/admin-settings';
import { ADMIN_LIST_VIEWS, inListView, listStageOf, type DiscardReason } from '@/lib/commercial-opportunities/list-stages';
import { WorkspaceCompanyFields } from './WorkspaceCompanyFields';
import {OpportunityReconsiderDialog} from './OpportunityReconsiderDialog';
import { AdvicePill, ExclusionGroups, NewsList, StartHere } from './OpportunityRadar';
import { ACCEPTED_FILES, DocumentList, ExpedientGuide, ReportProgress, usePublicLinks, type ExpedientDocument } from './OpportunityExpedient';
import { expandZipUploads, isZip } from '@/lib/commercial-opportunities/zip-uploads';
import { pickPrefillFiles } from '@/lib/commercial-opportunities/prefill-package';
import { OPPORTUNITY_SOURCES, bySource, closesLabel, inCategories, parseCategories, sourceKinds, workAdvice, type OpportunityCategory, type OpportunitySource } from '@/lib/commercial-opportunities/workspace-radar';
import { humanDate, reportDecision, reportNextSteps } from '@/lib/commercial-opportunities/report-view';
import { isSignalKind, type OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import type { WorkspaceOverview, WorkItem, WorkRecord, WorkspaceMember } from '@/lib/commercial-opportunities/workspace';
import type { ReportJobProgress } from '@/lib/commercial-opportunities/report-progress';
import { readWorkspaceUrl, workspaceUrl, type WorkspaceView } from '@/lib/commercial-opportunities/workspace-url';

type Job = { id: string; kind: string; state: string; error: string | null; created_at: string; progress?: ReportJobProgress; documentId?: string; part?: string };
type Detail = { item: WorkItem; work: WorkRecord | null; participants: WorkspaceMember[]; members?: Array<{ user_id: string; name: string; role?: string }>; activity: ActivityRow[]; tasks: OpportunityTask[]; documents: ExpedientDocument[]; reports: Array<{ id: string; created_at: string; report: OpportunityReport }>; jobs: Job[]; contacts: any[]; decisionMakerTitles: string[];
  marks?: { available: boolean; items: ReportMarks }; offer?: { available: boolean; latest: SavedOfferDraft | null; canPrice?: boolean; versions?: Array<{ id: string; created_at: string }> }; fit?: OpportunityFitView;
  /** «Calcular el precio» saved for whoever sets the prices (OPP-23); null for the rest of the team. */
  priceStudy?: { available: boolean; latest: SavedPriceStudy | null; versions: PriceStudyVersion[] } | null };
/** The kinds with bases to answer with an offer (server/commercial-opportunities/workspace-offer.ts). */
const OFFER_KINDS = ['tender', 'compra_agil', 'private'];
/** The kinds with a public buyer whose history ChileCompra keeps (server/commercial-opportunities/workspace-market.ts). */
const MARKET_KINDS = ['tender', 'compra_agil'];
const TYPES: Record<string, string> = { hiring: 'Ofertas laborales', linkedin_post: 'Publicación LinkedIn', tender: 'Licitación pública', compra_agil: 'Compra Ágil', private: 'Oportunidad privada', project: 'Proyecto' };
const STATES: Record<string, string> = { unassigned: 'Sin asignar', assigned: 'Asignada', working: 'En gestión', blocked: 'Bloqueada', submitted: 'Presentada', won: 'Ganada', lost: 'Perdida', archived: 'Archivada', queued: 'En cola', running: 'En curso', waiting: 'Continuando', ready: 'Terminado', failed: 'No terminó' };
const ACTIVE = ['queued', 'running', 'waiting'];
/** The sources of «Actualizar oportunidades», as the status line names them (DISCOVERY_JOB_KINDS). */
const SEARCH_SOURCES: Record<string, string> = { criteria: 'los criterios de búsqueda', tenders: 'licitaciones y Compra Ágil', hiring: 'avisos de trabajo', posts: 'publicaciones de LinkedIn' };
const CURRENCIES = ['CLP', 'UF', 'USD', 'EUR'];
/** Documents of a new opportunity go up a few at a time: one by one took a minute for five bases and the button only spun. */
const UPLOADS_AT_ONCE = 3;
const date = (value: string | null | undefined) => humanDate(value, true) || 'Sin fecha';
const localDate = (value: string) => value ? new Date(value).toISOString() : null;
/** «Hoy», «Mañana», «En 3 días», «En una semana»: the next action at 9:00 local time, as the date field writes it. */
const QUICK_DUE: Array<[string, number]> = [['Hoy', 0], ['Mañana', 1], ['En 3 días', 3], ['En una semana', 7]];
const dueIn = (days: number) => { const at = new Date(); at.setDate(at.getDate() + days); at.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0'); return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T09:00`; };
/** The same quick picks for a task, which is due on a day (work-tasks.ts): «Hoy» is today in Chile. */
const taskDay = (days: number) => addDays(chileDay(new Date()), days);
const money = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
/** «3,40»: the month's spending as it reads in Chile. */
const cents = (n: number) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const list = (s: string) => (s || '').split('\n').map(s => s.trim()).filter(Boolean);
/** «el cierre, el monto y la hora» */
const listEs = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '';
async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }
/** Each opportunity has its own address (?op=…): the browser's back button returns to the list and a teammate can open the same link. */
const opportunityInUrl = () => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('op');
const sectionInUrl = () => typeof window === 'undefined' ? null : readWorkspaceUrl(window.location.search).section;
/** The pipeline's first page of each stage nobody works yet, and the size of «Cargar más» (workspace-pipeline.ts). */
const PAGE = 60;
const FIRST_PAGE: Record<PagedStage, number> = { found: PAGE, recommended: PAGE, excluded: 0, lost: 0, archived: 0 };

export function OpportunityWorkWorkspace() {
  const { user } = useAuth();
  // When this person opened each opportunity, kept in this browser (progress.ts): the cards say «Abierta hace 1 min» on the way back.
  const [opened, setOpened] = useState<Record<string, number>>({});
  const openedRef = useRef(opened); openedRef.current = opened;
  useEffect(() => { try { setOpened(parseOpened(window.localStorage.getItem(openedKey(user?.id)))); } catch { setOpened({}); } }, [user?.id]);
  const [overview, setOverview] = useState<(WorkspaceOverview & { suggestion?: any }) | null>(null);
  const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  // Nothing is read before the address says which filters (workspace-url.ts): otherwise the first reading would be thrown away.
  const [urlRead, setUrlRead] = useState(false);
  // Closing as won or lost asks for the reason in a line first (CloseReasonDialog); the move waits for the person to confirm.
  const [closing, setClosing] = useState<CloseTarget | null>(null);
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('recommended');
  // The pipeline and the list share the words searched (read 300 ms after the last key), the source picked and the lines of service (rubros).
  const [search, setSearch] = useState(''); const [source, setSource] = useState<OpportunitySource>('all');
  const [categories, setCategories] = useState<OpportunityCategory[]>([]); const categoryKey = categories.join(',');
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [search, filter, source, categoryKey]);
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState('summary'); const [modal, setModal] = useState<'create' | 'context' | 'assign' | 'task' | 'criteria' | null>(null);
  /** The card an administrator is assigning from the list, with the revision of its work record (the detail page is not open). */
  const [assignFor, setAssignFor] = useState<{ id: string; title: string; revision: number } | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({}); const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState(''); const [pendingQuestion, setPendingQuestion] = useState<string | null>(null); const [messages, setMessages] = useState<any[]>([]);
  // «Convertir el plan en tareas» (OPP-21) and «Mis tareas» (OPP-27): the preview while it is open, and this person's tasks while the view is on screen.
  const [planOpen, setPlanOpen] = useState(false);
  const [myTasks, setMyTasks] = useState<MyTask[] | null>(null); const [myTasksError, setMyTasksError] = useState('');
  // The part an opportunity opens on when it is not the report: its tasks from «Mis tareas», or what a link names (?seccion=…).
  const openOn = useRef<string | null>(null);
  const [feedback, setFeedback] = useState(''); const selectedRef = useRef(selected); selectedRef.current = selected; const busyRef = useRef(false);
  const [download, setDownload] = useState('pdf');
  const [reconsider,setReconsider]=useState(false);
  // «No es para nosotros» (DiscardDialog): what is being put aside, from a card, the list's selection or the opportunity itself.
  const [discarding, setDiscarding] = useState<DiscardTarget | null>(null);
  // The assignment rules (OPP-06): their dialog, what «Asignarlas» is about to assign, and the rule behind a «Asignar» that came suggested.
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleAssign, setRuleAssign] = useState<RuleGroup[] | null>(null);
  const [assignRule, setAssignRule] = useState('');
  // The list's selection, for the actions on several at once (administrators); a new filter, search or page starts it over.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string, on: boolean) => setPicked(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  // «Deshacer» next to the notice of what was just put aside.
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  // The admin sees the pipeline first; «Lista» keeps the filters and cards; «Mercado público» reads ChileCompra (what the
  // State plans to buy, the contracts that end, the competitors); «Asistente» is the section's general conversation, for everyone.
  const [view, setView] = useState<WorkspaceView>('pipeline');
  useEffect(() => setPicked(new Set()), [search, filter, source, categoryKey, page, view]);
  const [assistantThread, setAssistantThread] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // A question the assistant hands to one opportunity's chat: asked there once its expediente is open.
  const handoff = useRef<{ id: string; question: string | null } | null>(null);
  const [pipeline, setPipeline] = useState<{ items: WorkItem[]; work: WorkRecord[]; totals: { found: number; recommended: number; excluded?: number };
    limits?: Partial<Record<PagedStage, number>>; summaries?: { waiting: number }; progress?: Record<string, CardProgress>; week?: PipelineWeekItem[] } | null>(null);
  // How many of each stage nobody works yet the pipeline asks for: «Cargar más» adds a page; a new search, source or order starts over.
  const [sort, setSort] = useState<PrioritySort>('priority');
  const filterKey = `${source}|${search}|${sort}|${categoryKey}`;
  // The address follows the filters (workspace-url.ts): a new filter is a step the back button returns from; the words typed only replace it.
  const urlFilters = useRef({ view, filter, source, query: search, categories, sort });
  urlFilters.current = { view, filter, source, query: search, categories, sort };
  const urlStep = `${view}|${filter}|${source}|${categoryKey}|${sort}`;
  const lastUrlStep = useRef('');
  useEffect(() => {
    if (!urlRead) return;
    const next = workspaceUrl(window.location.pathname, urlFilters.current, opportunityInUrl(), sectionInUrl());
    if (next !== `${window.location.pathname}${window.location.search}`) {
      if (lastUrlStep.current && lastUrlStep.current !== urlStep) window.history.pushState(null, '', next); else window.history.replaceState(null, '', next);
    }
    lastUrlStep.current = urlStep;
  }, [urlRead, urlStep, search]);
  const [paging, setPaging] = useState<{ key: string; limits: Record<PagedStage, number> }>({ key: '', limits: FIRST_PAGE });
  const limits = paging.key === filterKey ? paging.limits : FIRST_PAGE;
  const [loadingMore, setLoadingMore] = useState<PagedStage | null>(null);
  // Which search and source the pipeline on screen answers: while a new one loads, the old cards fade.
  const [pipelineFor, setPipelineFor] = useState(filterKey);
  // «Cargar oportunidad»: from a document the AI reads (prefill.ts) or typed, and what the reading found.
  const [createMode, setCreateMode] = useState<'upload' | 'write'>('upload');
  const [prefill, setPrefill] = useState<{ status: 'idle' | 'reading' | 'done' | 'error'; name?: string; missing?: string[]; partial?: boolean; message?: string; read?: string[]; kept?: number; notes?: string[]; pasted?: boolean }>({ status: 'idle' });
  const [suggestions, setSuggestions] = useState<PipelineSuggestion[] | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const watching = useRef<string | null>(null);
  useEffect(() => { if (!feedback) { setUndo(null); return; } const timer = setTimeout(() => setFeedback(''), undo ? 9000 : 6000); return () => clearTimeout(timer); }, [feedback, undo]);
  // The filters and the open opportunity live in the address (workspace-url.ts): read when the page opens and when the browser goes back.
  useEffect(() => {
    const read = () => { const state = readWorkspaceUrl(window.location.search); if (state.op && state.section) openOn.current = state.section;
      setView(state.view); setFilter(state.filter); setSource(state.source); setQuery(state.query); setSearch(state.query);
      setCategories(state.categories); setSort(state.sort); setSelected(state.op); setUrlRead(true); };
    read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read);
  }, []);
  // The list reads with the search and source only while it is on screen: typing in the pipeline does not read the list too.
  const listShown = view === 'list' || overview?.mode !== 'management';
  const listSearch = listShown ? search : ''; const listSource = listShown ? source : 'all'; const listCategories = listShown ? categoryKey : ''; const listSort = listShown ? sort : 'priority';
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const result = await json(await fetch(`/api/commercial-opportunities/workspace?${new URLSearchParams({ view: memberView(filter), query: listSearch, page: String(page), source: listSource, category: listCategories, sort: listSort })}`, { cache: 'no-store', signal }));
      if (!signal?.aborted) { setOverview(result); setProblem(''); }
    } catch (e) { if (!signal?.aborted) { setProblem(e instanceof Error ? e.message : 'No se pudo cargar.'); setOverview(null); } }
  }, [filter, listSearch, page, listSource, listCategories, listSort]);
  // The list is read again every minute while it is on view; an open opportunity or a hidden tab does not ask for it.
  useEffect(() => {
    if (!urlRead) return;
    const controller = new AbortController(); void load(controller.signal);
    const refresh = () => { if (!document.hidden && !selectedRef.current) void load(controller.signal); };
    const timer = setInterval(refresh, 60_000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, urlRead]);
  const loadDetail = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      // The expediente and its chat do not depend on each other: they are read together.
      const [value, chat] = await Promise.all([fetch(`/api/commercial-opportunities/${id}/workspace`, { cache: 'no-store', signal }).then(json),
        fetch(`/api/commercial-opportunities/${id}/chat`, { cache: 'no-store', signal }).then(json)]);
      if (!signal?.aborted && selectedRef.current === id) { setDetail(value); setMessages(chat.messages || []); }
    } catch (e) { if (!signal?.aborted && selectedRef.current === id) { setDetail(null); setMessages([]); setProblem(e instanceof Error ? e.message : 'No se pudo abrir.'); } }
  }, []);
  useEffect(() => {
    // The part asked for is kept until an opportunity is open: the address is read before the first one is.
    const section = selected ? openOn.current : null; if (selected) openOn.current = null;
    setDetail(null); setMessages([]); setTab(section ?? 'summary'); setNote(''); setPendingQuestion(null); setPlanOpen(false); watching.current = null;
    if (!selected) return; const controller = new AbortController(); void loadDetail(selected, controller.signal);
    // Every 8 s while a report or an answer is on its way, every 45 s otherwise, and never in a hidden tab.
    let last = Date.now();
    const timer = setInterval(() => {
      if (document.hidden || (!busyRef.current && Date.now() - last < 45_000)) return;
      last = Date.now(); void loadDetail(selected, controller.signal);
    }, 8000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected, loadDetail]);
  // The part on screen stays in the address (?seccion=…): a reload opens on it, and so does the page when it mounts again as the
  // session settles (AuthContext keys the app by account), which a part kept only in memory would lose. Replaced, not a new step.
  useEffect(() => {
    if (!detail || detail.item.id !== selected || opportunityInUrl() !== selected) return;
    const next = workspaceUrl(window.location.pathname, urlFilters.current, selected, tab);
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', next);
  }, [tab, detail, selected]);
  const research = detail?.jobs.find(j => j.kind === 'research') ?? null;
  const researching = Boolean(research && ACTIVE.includes(research.state));
  const offerJob = detail?.jobs.find(j => j.kind === 'offer' && !j.part) ?? null;
  // The parts of the offer the AI is rewriting (OPP-24): only that part waits.
  const partJobs = (detail?.jobs || []).flatMap(j => j.kind === 'offer' && j.part ? [{ id: j.id, part: j.part, state: j.state, error: j.error, created_at: j.created_at }] : []);
  const preparingOffer = Boolean(offerJob && ACTIVE.includes(offerJob.state)) || partJobs.some(j => ACTIVE.includes(j.state));
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
  // And a part the AI rewrote while the person kept working: said once it is on the page.
  const partWatch = useRef(new Set<string>());
  const partStates = partJobs.map(j => `${j.id}:${j.state}`).join('|');
  useEffect(() => {
    for (const job of partJobs) {
      if (ACTIVE.includes(job.state)) partWatch.current.add(job.id);
      else if (partWatch.current.delete(job.id) && job.state === 'ready') setFeedback('La IA reescribió la parte que pediste. Revísala en «Tu oferta».');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- partStates says when a part job moved.
  }, [partStates]);
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
    const request = ++pipelineRequest.current; const key = `${source}|${search}|${sort}|${categoryKey}`;
    try {
      const params = new URLSearchParams({ view: 'pipeline', source, query: search, category: categoryKey, sort, found: String(limits.found), recommended: String(limits.recommended), excluded: String(limits.excluded),
        lost: String(limits.lost), archived: String(limits.archived) });
      const result = await json(await fetch(`/api/commercial-opportunities/workspace?${params}`, { cache: 'no-store' }));
      if (request === pipelineRequest.current) { setPipeline(result); setPipelineFor(key); }
    }
    catch (e) { if (request === pipelineRequest.current) { setProblem(e instanceof Error ? e.message : 'No se pudo cargar el embudo.'); setPipelineFor(key); } }
    finally { if (request === pipelineRequest.current) setLoadingMore(null); }
  }, [source, search, sort, limits, categoryKey]);
  const loadMore = useCallback((stage: PagedStage) => { setLoadingMore(stage); setPaging({ key: filterKey, limits: { ...limits, [stage]: Math.min(600, limits[stage] + PAGE) } }); }, [filterKey, limits]);
  const clearFilters = () => { setQuery(''); setSearch(''); setSource('all'); setCategories([]); };
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
  // The bases of a private process arrive as several documents, often in ZIPs: they are opened here, the ones that define the
  // process are read together (prefill-package.ts) and all of them stay with the opportunity, as its bases.
  const readDocuments = async (picked: File[]) => {
    if (!picked.length) return;
    const label = picked.length === 1 ? picked[0].name : `${picked.length} archivos`;
    setPrefill({ status: 'reading', name: label }); setProblem('');
    try {
      const { files: opened, notes } = await expandZipUploads(picked);
      if (!opened.length) throw new Error(notes[0]?.message || 'No encontramos documentos que podamos leer. Escribe los datos.');
      const { chosen } = pickPrefillFiles(opened);
      const body = new FormData(); for (const file of chosen) body.append('file', file);
      const result = await json(await fetch('/api/commercial-opportunities/workspace/prefill', { method: 'POST', body }));
      const found = Object.fromEntries(Object.entries(result.fields || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined));
      setDraft(current => ({ ...current, ...found }));
      setFiles(current => [...opened, ...current.filter(item => !opened.some(file => file.name === item.name))]);
      const skipped = ((result.skipped || []) as Array<{ name: string; why: string }>).map(item => `«${item.name}»: ${item.why}`);
      setPrefill({ status: 'done', name: label, missing: result.missing || [], partial: Boolean(result.partial), read: result.read || [], kept: opened.length, notes: [...notes.map(note => note.message), ...skipped] });
      setCreateMode('write');
    } catch (e) { setPrefill({ status: 'error', name: label, message: e instanceof Error ? e.message : 'No pudimos leer el documento. Escribe los datos.' }); }
  };
  // The invitation pasted in the form, read like a document to complete the rest (OPP-49); the pasted text stays as it is.
  const readPasted = async () => {
    const text = String(draft.description || '').trim();
    if (text.length < 40) return;
    setPrefill({ status: 'reading', name: 'el texto pegado', pasted: true }); setProblem('');
    try {
      const body = new FormData(); body.append('text', text);
      const result = await json(await fetch('/api/commercial-opportunities/workspace/prefill', { method: 'POST', body }));
      const found = Object.fromEntries(Object.entries(result.fields || {}).filter(([key, value]) => key !== 'description' && value !== '' && value !== null && value !== undefined));
      setDraft(current => ({ ...current, ...found }));
      setPrefill({ status: 'done', name: 'el texto pegado', missing: result.missing || [], partial: Boolean(result.partial), read: [], kept: 0, notes: [], pasted: true });
    } catch (e) { setPrefill({ status: 'error', name: 'el texto pegado', message: e instanceof Error ? e.message : 'La IA no pudo leer el texto. Completa los datos.', pasted: true }); }
  };
  // «Bases y anexos»: a ZIP goes up as the documents inside it, like in Documentos.
  const addFiles = async (chosen: File[]) => {
    const { files: opened, notes } = await expandZipUploads(chosen);
    setFiles(current => [...current, ...opened.filter(file => !current.some(item => item.name === file.name))]);
    if (notes.length) setProblem(notes.map(note => note.message).join(' '));
  };
  const review = async () => {
    setReviewing(true); setProblem('');
    try { const result = await json(await fetch('/api/commercial-opportunities/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pipeline_review', data: {} }) }));
      setSuggestions(result.suggestions ?? []); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'La IA no pudo revisar el embudo.'); }
    finally { setReviewing(false); }
  };
  const moveNow = async (id: string, state: WorkRecord['state'], revision: number, note?: string, close?: CloseDetail) => {
    const done = await perform('state', { state, expectedRevision: revision, ...(note ? { note } : {}), ...(close?.motives?.length ? { motives: close.motives } : {}),
      ...(close?.winner ? { winner: close.winner } : {}), ...(close?.amount !== undefined ? { amount: close.amount } : {}) }, id, true);
    if (done) { setSuggestions(current => current?.filter(s => s.id !== id) ?? null); await loadPipeline(); setFeedback(`Movida a «${WORK_STATE_LABELS[state]}».`); }
    return Boolean(done);
  };
  const moveTo = async (id: string, state: WorkRecord['state'], revision: number) => {
    if (state === 'won' || state === 'lost') { setProblem(''); setClosing({ id, state, revision }); return; }
    await moveNow(id, state, revision);
  };
  const confirmClose = async (target: CloseTarget, note: string, close: CloseDetail) => { if (await moveNow(target.id, target.state, target.revision, note, close)) setClosing(null); };
  type BulkResult = { done: string[]; skipped: number };
  // After an action on several, what is on screen is read again: the list (perform does it), and the pipeline or the open opportunity.
  // The notice waits for it: «Pasó a «Archivadas»» never shows while the card (or its chip in «Cierran esta semana») is still there.
  const afterBulk = (ids: string[]) => Promise.all([selected && ids.includes(selected) ? loadDetail(selected) : null, admin && view === 'pipeline' && !selected ? loadPipeline() : null]);
  // What was put aside comes back to the ones nobody works yet («Reabrir», or «Deshacer» right after).
  const reopen = async (ids: string[]) => {
    const result = await perform('bulk', { op: 'state', ids, state: 'unassigned' }, null, true) as BulkResult | null;
    if (!result) return;
    await afterBulk(ids);
    setFeedback(result.done.length > 1 ? `Reabrimos ${result.done.length}: vuelven a las que nadie trabaja todavía.` : 'Reabierta: vuelve a las que nadie trabaja todavía.');
  };
  // «No es para nosotros»: to «Archivadas» with the reason, and a «Deshacer» in the notice.
  const confirmDiscard = async (target: DiscardTarget, reason: DiscardReason, note: string) => {
    const result = await perform('bulk', { op: 'discard', ids: target.ids, reason, note }, null, true) as BulkResult | null;
    if (!result) return;
    setDiscarding(null); setPicked(new Set()); await afterBulk(target.ids);
    const done = result.done.length;
    const left = result.skipped ? ` ${result.skipped === 1 ? 'Una ya tenía equipo y quedó como estaba' : `${result.skipped} ya tenían equipo y quedaron como estaban`}.` : '';
    setFeedback(done ? `${done === 1 ? 'Pasó' : `Pasaron ${done}`} a «Archivadas». La IA tendrá en cuenta el motivo.${left}` : 'Ya tenían equipo: quedaron como estaban.');
    if (done) setUndo({ label: 'Deshacer', run: () => void reopen(result.done) });
  };
  const movePicked = async (to: 'working' | 'submitted' | 'archived' | 'unassigned') => {
    if (to === 'unassigned') { const ids = [...picked]; setPicked(new Set()); await reopen(ids); return; }
    const result = await perform('bulk', { op: 'state', ids: [...picked], state: to }, null, true) as BulkResult | null;
    if (!result) return;
    const ids = [...picked]; setPicked(new Set()); await afterBulk(ids);
    setFeedback(`${result.done.length === 1 ? 'Movimos 1' : `Movimos ${result.done.length}`} a «${WORK_STATE_LABELS[to]}».${result.skipped ? ` ${result.skipped === 1 ? 'Una quedó como estaba' : `${result.skipped} quedaron como estaban`}: nadie las trabaja o ya estaban ahí.` : ''}`);
  };
  // «Cambiar etapa» of the administrator, in the opportunity: the closing stages ask for their reason first.
  const changeStage = async (to: WorkRecord['state']) => {
    if ((to === 'won' || to === 'lost') && selected && detail?.work) { setProblem(''); setClosing({ id: selected, state: to, revision: detail.work.revision }); return false; }
    return stepTo(to);
  };
  const perform = async (action: string, data: unknown, id = selected, quiet = false) => {
    setBusy(true); setProblem(''); setFeedback('');
    try {
      const endpoint = id ? `/api/commercial-opportunities/${id}/workspace` : '/api/commercial-opportunities/workspace';
      const result = await json(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) }));
      // The open expediente and the list are read again together: one after the other they were three or four trips in a row.
      await Promise.all([id ? loadDetail(id) : null, load()]); if (!quiet) setFeedback(result.jobId || result.queued ? 'Trabajo en cola. Puedes continuar y volver cuando termine.' : 'Cambios guardados.');
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
  // «Responder» in «Novedades» opens the opportunity on the box to answer its decision (DecisionCallout), once it is on the page.
  const focusDecision = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || detail.item.id !== focusDecision.current) return;
    focusDecision.current = null;
    const box = document.getElementById('decision-reply');
    box?.scrollIntoView({ block: 'center' });
    box?.focus({ preventScroll: true });
  }, [detail]);
  const open = (id: string, focus?: 'decision' | 'tasks' | 'activity') => {
    focusDecision.current = focus === 'decision' ? id : null;
    openOn.current = focus === 'tasks' || focus === 'activity' ? focus : null;
    if (selectedRef.current === id && openOn.current) { setTab(openOn.current); openOn.current = null; }
    const section = openOn.current;
    setProblem(''); setSelected(id);
    const next = markOpened(openedRef.current, id); setOpened(next);
    try { window.localStorage.setItem(openedKey(user?.id), JSON.stringify(next)); } catch { /* private mode: it is remembered until the page closes */ }
    if (opportunityInUrl() !== id) window.history.pushState(null, '', workspaceUrl(window.location.pathname, urlFilters.current, id, section));
    window.scrollTo({ top: 0 });
    for (const n of overview?.notifications.filter(n => n.opportunity_id === id && !n.read_at) || []) void fetch('/api/commercial-opportunities/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notification', data: { id: n.id } }) });
  };
  const close = () => { setSelected(null); setProblem(''); if (opportunityInUrl()) window.history.pushState(null, '', workspaceUrl(window.location.pathname, urlFilters.current)); };
  const prepareOffer = (instructions: string) => {
    void perform('offer', { requestId: crypto.randomUUID(), ...(instructions ? { instructions } : {}) }, selected, true)
      .then(result => { if (result) setFeedback('Preparando el borrador de oferta. Tarda unos minutos: te avisaremos cuando esté listo.'); });
  };
  // The steps of the person working the opportunity (stage, a block with its reason) and the decisions they put to the administrators.
  const stepTo = async (to: WorkRecord['state'], note?: string) => {
    if (!detail?.work) return false;
    const done = await perform('state', { state: to, expectedRevision: detail.work.revision, ...(note ? { note } : {}) }, selected, true);
    if (done) setFeedback(to === 'blocked' ? 'Avisamos a los administradores del bloqueo.' : `Pasó a «${WORK_STATE_LABELS[to]}».`);
    return Boolean(done);
  };
  // «Plan y tareas» (OPP-27): a tick or a stage, the owner from the row, deleting after a question; and the plan into tasks at once (OPP-21).
  const taskStatus = (task: OpportunityTask, status: TaskStatus) => perform('task_status', { id: task.id, status }, selected, true);
  const taskOwner = (task: OpportunityTask, ownerId: string | null) => void perform('task', { id: task.id, title: task.title, ownerId, dueAt: task.due_at, evidence: task.evidence || '' }, selected, true)
    .then(result => { if (result && ownerId && ownerId !== user?.id) setFeedback('Le avisamos a quien ahora tiene la tarea.'); });
  const editTask = (task: OpportunityTask) => { setDraft({ id: task.id, title: task.title, ownerId: task.owner_id || '', day: dayOfDueAt(task.due_at), evidence: task.evidence || '' }); setModal('task'); };
  const removeTask = async (task: OpportunityTask) => {
    if (!(await confirm({ title: '¿Eliminar la tarea?', description: `«${task.title}» sale del plan. Si ya no hace falta, también puedes marcarla como hecha.`, confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', tone: 'danger' }))) return;
    if (await perform('task_delete', { id: task.id }, selected, true)) setFeedback('Tarea eliminada.');
  };
  const createPlanned = async (tasks: PlannedTask[]) => {
    const result = await perform('tasks', { tasks }, selected, true) as { created: number } | null;
    if (!result) return;
    setPlanOpen(false);
    const told = tasks.some(task => task.ownerId && task.ownerId !== user?.id);
    setFeedback(`${result.created === 1 ? 'Creamos la tarea' : `Creamos ${result.created} tareas`}${told ? ' y avisamos a cada responsable' : ''}.`);
  };
  // «Actividad» (OPP-28): a note that names people tells them; one's own notes can be corrected or deleted.
  const addNote = async (text: string) => {
    const result = await perform('activity', { kind: 'note', text, dueAt: null }, selected, true) as { mentioned?: number } | null;
    if (result) setFeedback(result.mentioned ? `Nota guardada. ${result.mentioned === 1 ? 'Le avisamos a la persona que mencionaste' : `Les avisamos a las ${result.mentioned} personas que mencionaste`}.` : 'Nota guardada.');
    return Boolean(result);
  };
  const editNote = async (id: string, text: string) => Boolean(await perform('note_edit', { id, text }, selected, true));
  const removeNote = async (row: ActivityRow) => {
    if (!(await confirm({ title: '¿Eliminar tu nota?', description: 'Deja de verse en la actividad para todo el equipo.', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', tone: 'danger' }))) return;
    if (await perform('note_delete', { id: row.id }, selected, true)) setFeedback('Nota eliminada.');
  };
  // «Mis tareas» (OPP-27): read when the view opens and after each change; a tick marks it done, with «Deshacer».
  const loadMyTasks = useCallback(async () => {
    setMyTasksError('');
    try { setMyTasks((await json(await fetch('/api/commercial-opportunities/workspace?view=tasks', { cache: 'no-store' }))).tasks || []); }
    catch (e) { setMyTasksError(e instanceof Error ? e.message : 'No se pudieron cargar tus tareas.'); }
  }, []);
  useEffect(() => { if (view === 'tasks' && !selected) void loadMyTasks(); }, [view, selected, loadMyTasks]);
  const setMyTask = async (task: MyTask, status: TaskStatus) => {
    try {
      await json(await fetch(`/api/commercial-opportunities/${task.opportunity.id}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'task_status', data: { id: task.id, status } }) }));
      return true;
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar.'); return false; }
    finally { await Promise.all([loadMyTasks(), load()]); }
  };
  const finishMyTask = async (task: MyTask) => {
    if (!(await setMyTask(task, 'done'))) return;
    setFeedback(`Hecha: «${task.title.length > 60 ? `${task.title.slice(0, 59)}…` : task.title}».`);
    setUndo({ label: 'Deshacer', run: () => void setMyTask(task, task.status) });
  };
  const decide = async (type: 'ask' | 'no_go', text: string, dueAt: string | null) => {
    const done = await perform('decision', { type, text, dueAt }, selected, true);
    if (done) setFeedback('Se lo avisamos a los administradores. Verás su respuesta aquí.');
    return Boolean(done);
  };
  // An answer a member gave for the company waits for an administrator: confirmed, it goes into the ficha and the requirements are read again.
  const resolveProposal = async (activityId: string, accept: boolean) => {
    const done = await perform('fit_proposal', { activityId, accept }, selected, true);
    if (done) setFeedback(accept ? 'Confirmada: ya está en la ficha. Revisamos los requisitos con ella.' : 'Respuesta descartada.');
  };
  const replyDecision = async (text: string) => {
    const done = await perform('decision_reply', { text }, selected, true);
    if (done) setFeedback('Respuesta enviada.');
    return Boolean(done);
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
  // A part of the offer in the team's words (OPP-24): saved on its own, like the prices, and shown without reading the expediente again.
  const offerPost = async <T,>(action: string, data: unknown) => json(await fetch(`/api/commercial-opportunities/${selected}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }) })) as Promise<T>;
  const withOffer = (draftId: string, change: (latest: SavedOfferDraft) => SavedOfferDraft) =>
    setDetail(current => current?.offer?.latest?.id === draftId ? { ...current, offer: { ...current.offer, latest: change(current.offer.latest) } } : current);
  const saveOfferPart = async (draftId: string, part: string, text: string | null, base: string | null) => {
    if (!selected) return false;
    setProblem('');
    try {
      const saved = await offerPost<{ edit: OfferEdit | null }>('offer_part', { draftId, part, text, base });
      withOffer(draftId, latest => ({ ...latest, draft: withPartEdit(latest.draft, part, saved.edit) }));
      return true;
    } catch (e) {
      // Someone else's version of that part comes in, so the next save starts from it; what this person typed stays in the box.
      setProblem(e instanceof Error ? e.message : 'No se pudo guardar.'); void loadDetail(selected); return false;
    }
  };
  const reviewOffer = async (draftId: string, reviewed: boolean) => {
    if (!selected) return false;
    setProblem('');
    try {
      const saved = await offerPost<{ review: OfferReview | null }>('offer_review', { draftId, reviewed });
      withOffer(draftId, latest => ({ ...latest, draft: { ...latest.draft, review: saved.review } }));
      setFeedback(reviewed ? 'Oferta marcada como revisada.' : 'Cambios guardados.');
      return true;
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar.'); return false; }
  };
  const rewriteOfferPart = async (draftId: string, part: string, instructions: string, base: string | null) => {
    const result = await perform('offer_rewrite', { draftId, part, instructions, base, requestId: crypto.randomUUID() }, selected, true) as { state?: string } | null;
    if (result?.state === 'ready') setFeedback('Listo: la IA reescribió esa parte. Revísala.');
    else if (result && ACTIVE.includes(result.state ?? 'queued')) setFeedback('La IA está reescribiendo esa parte. Puedes seguir trabajando.');
    return Boolean(result);
  };
  // «Calcular el precio» saved for the team as it is typed (OPP-23): on its own, without reading the expediente again.
  const savePriceStudy = async (study: StudioDraft, base: string | null, options: { over?: boolean; fresh?: boolean } = {}) => {
    if (!selected) return { ok: false as const, conflict: false, message: '' };
    const response = await fetch(`/api/commercial-opportunities/${selected}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'price_study', data: { study, base, ...options } }) }).catch(() => null);
    const value = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      // Another person's newer version comes in, to see it next to this one.
      if (response?.status === 409) void loadDetail(selected);
      return { ok: false as const, conflict: response?.status === 409, message: value.error || 'Revisa tu conexión.' };
    }
    const saved = value.saved as SavedPriceStudy;
    setDetail(current => current?.priceStudy ? { ...current, priceStudy: { ...current.priceStudy, latest: saved,
      versions: [saved, ...current.priceStudy.versions.filter(version => version.id !== saved.id)].slice(0, 12) } } : current);
    return { ok: true as const, saved };
  };
  const openPriceVersion = async (versionId: string) => {
    try { return (await json(await fetch(`/api/commercial-opportunities/${selected}/workspace?price_version=${versionId}`, { cache: 'no-store' }))).version.study as StudioDraft; }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo abrir esa versión.'); return null; }
  };
  // A figure of the calculation as the unit price of one line of the economic offer, beside the prices already saved.
  const putInOffer = async (line: number, value: number) => {
    const latest = detail?.offer?.latest;
    if (!latest) return false;
    const prices = { ...Object.fromEntries(Object.entries(latest.prices).map(([key, price]) => [key, String(price)])), [String(line)]: String(value) };
    return Boolean(await saveOfferPrices(latest.id, latest.revision, prices));
  };
  const generate = () => { if (!detail) return; if (admin && detail.item.data.evaluation === 'excluded' && !detail.reports.length) setReconsider(true); else { setTab('summary'); void perform('research', {}, selected, true); } };
  // The question shows at once; the answer arrives in the same wait (the server answers it now) or, if a worker took it, by polling.
  const ask = (text: string) => { setTab('chat'); setPendingQuestion(text); void perform('chat', { question: text, requestId: crypto.randomUUID() }, selected, true).finally(() => setPendingQuestion(null)); };
  // «¿Cumplimos?»: read now with the profile; an answer is saved in the profile first (workspace-fit.ts).
  const checkFit = async (action: 'fit' | 'fit_answer', data: Record<string, string>) => {
    const result = await perform(action, data, selected, true);
    if (result?.proposed) { setFeedback('Enviamos tu respuesta a un administrador. Cuando la confirme, queda en la ficha y revisamos los requisitos de nuevo.'); return; }
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
      try { const body = new FormData(); body.set('file', file); const result = await json(await fetch(`/api/commercial-opportunities/${selected}/documents`, { method: 'POST', body }));
        states[i] = { ...states[i], state: 'done', message: typeof result?.note === 'string' ? result.note : undefined }; }
      catch (e) { states[i] = { ...states[i], state: 'error', message: e instanceof Error ? e.message : 'No se pudo subir.' }; }
      report([...states, ...left]);
    }
    setBusy(false); await loadDetail(selected);
  };
  const adminSettings = readAdminSettings((overview?.context as any)?.admin_settings);
  const saveRules = async (rules: ReturnType<typeof rulesOf>) => {
    if (await perform('admin_settings', { op: 'rules', rules }, null, true)) { setRulesOpen(false); setFeedback(rules.length ? 'Reglas guardadas: las recomendadas dicen a quién van.' : 'Quitamos las reglas de asignación.'); }
  };
  // «Asignarlas»: each person gets theirs in one step, as the responsible one, and is told by email (the same bulk assignment of the list).
  const confirmRuleAssign = async (groups: RuleGroup[]) => {
    let done = 0, skipped = 0;
    for (const group of groups) {
      const result = await perform('bulk', { op: 'assign', ids: group.ids, teamId: null, participantIds: [group.userId], responsibleId: group.userId, objective: '', dueAt: null }, null, true) as BulkResult | null;
      if (!result) return;
      done += result.done.length; skipped += result.skipped;
    }
    setRuleAssign(null); await afterBulk(groups.flatMap(group => group.ids));
    setFeedback(`${done === 1 ? 'Asignamos 1' : `Asignamos ${done}`} según tus reglas: ${groups.map(group => `${group.name.split(' ')[0]} (${group.ids.length})`).join(', ')}. Les avisamos por correo.${skipped ? ` ${skipped === 1 ? 'Una no se pudo' : `${skipped} no se pudieron`}: cambiaron mientras tanto.` : ''}`);
  };
  // The searches of the list the team keeps (OPP-10): saved with the morning notice on for whoever saves it.
  const saveSearch = async (state: SearchState, name = searchName(state)) => {
    if (await perform('admin_settings', { op: 'search', search: { ...state, name, notify: true } }, null, true)) setFeedback(`Guardamos «${name}». Te avisaremos en el correo de la mañana cuando aparezcan nuevas.`);
  };
  const notifySearch = async (id: string, on: boolean) => {
    if (await perform('admin_settings', { op: 'search_notify', id, on }, null, true)) setFeedback(on ? 'Te avisaremos de las nuevas en el correo de la mañana.' : 'Ya no te avisamos de esta búsqueda.');
  };
  const removeSearch = async (id: string) => { if (await perform('admin_settings', { op: 'search_remove', id }, null, true)) setFeedback('Quitamos la búsqueda guardada.'); };
  const openContext = () => {
    const c = overview?.context as any;
    setDraft({ offer: c?.offer || overview?.suggestion?.offer || '', services: (c?.services || overview?.suggestion?.services || []).join('\n'), territories: (c?.territories || []).join('\n'), exclusions: (c?.exclusions || []).join('\n'), priority: c?.priority || 'balanced', automation: c ? c.automation : true, hour: c?.hour ?? 8 }); setModal('context');
  };
  // «Qué buscamos»: where the daily search looks and what for (search-settings.ts), edited as one draft.
  const [criteria, setCriteria] = useState<CriteriaDraft | null>(null);
  const openCriteria = () => {
    setProblem(''); setCriteria(criteriaDraft((overview?.context as any)?.criteria, (overview?.context as any)?.search)); setModal('criteria');
  };
  const field = (name: string, value: unknown) => setDraft(d => ({ ...d, [name]: value }));
  // What a dialog opened with: closing it with something else typed (or documents chosen) asks first, instead of losing it.
  const draftAtOpen = useRef('');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the draft of the moment the dialog opens, not each keystroke.
  useEffect(() => { if (modal) draftAtOpen.current = JSON.stringify(draft); }, [modal]);
  const confirm = useConfirm();
  /** Closes the form, asking first when something was written; false when it stays open. */
  const closeModal = async () => {
    if (busy) return false;
    const dirty = JSON.stringify(draft) !== draftAtOpen.current || files.length > 0;
    if (dirty && !(await confirm({ title: '¿Descartar lo que escribiste?', description: 'Si cierras ahora, se pierde lo que escribiste en este formulario y los documentos que elegiste.',
      confirmLabel: 'Descartar', cancelLabel: 'Seguir editando', tone: 'danger' }))) return false;
    setModal(null); setFiles([]);
    return true;
  };
  // «Prepara tu empresa», now inside «Tu empresa»: a step leaves the form (asking first if something was written) and goes there.
  const setupStep = async (step: SetupStepId) => {
    if (!(await closeModal())) return;
    if (step === 'documents') setProfileOpen(true);
    else if (step === 'assign') { setView('list'); setFilter('recommended'); }
    else if (step === 'competitors') setView('market');
  };
  // «Bases y anexos» of a new opportunity: how many went up of how many, while «Guardar» waits for them.
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  // «Asignar» on a card of the pipeline: the same dialog as the page's, for that card, without opening it.
  const openQuickAssign = async (target: WorkItem) => {
    setProblem(''); setFeedback('');
    let revision = 0;
    try { revision = Number((await json(await fetch(`/api/commercial-opportunities/${target.id}/workspace`, { cache: 'no-store' })))?.work?.revision || 0); } catch { /* it opens anyway: a stale revision is told when it is saved */ }
    setAssignFor({ id: target.id, title: target.title, revision });
    // A rule that gives it to someone comes chosen: confirming is the common case, changing it the exception.
    const rule = ruleFor(target, adminSettings.rules, new Set((overview?.members || []).map(member => member.user_id)));
    const name = rule ? (overview?.members || []).find(member => member.user_id === rule.userId)?.name || 'Integrante' : '';
    setAssignRule(rule ? `Elegida por tu regla «${ruleLabel(rule, name.split(' ')[0])}».` : '');
    setDraft({ teamId: '', participantIds: rule ? [rule.userId] : [], responsibleId: rule?.userId || '', objective: '' }); setModal('assign');
  };
  // «Asignar» on the list's selection: the same dialog, for all of them at once.
  const [assignMany, setAssignMany] = useState<string[] | null>(null);
  const openBulkAssign = () => { setProblem(''); setFeedback(''); setAssignMany([...picked]); setDraft({ teamId: '', participantIds: [], responsibleId: '', objective: '' }); setModal('assign'); };
  useEffect(() => { if (modal !== 'assign') { setAssignFor(null); setAssignMany(null); } }, [modal]);
  const saveModal = async () => {
    let result;
    if (modal === 'context') result = await perform('context', { offer: draft.offer, services: list(draft.services), territories: list(draft.territories), exclusions: list(draft.exclusions), priority: draft.priority,
      automation: Boolean(draft.automation), hour: Number(draft.hour), expectedRevision: Number((overview?.context as any)?.revision || 0) }, null);
    else if (modal === 'criteria') {
      // What to fix is said in words before anything is sent (LinkedIn on without a search, an amount range upside down).
      const next = criteria ? draftToSave(criteria) : null;
      if (!next || 'problem' in next) { setProblem(next && 'problem' in next ? next.problem : 'Revisa los datos.'); return; }
      result = await perform('criteria', { criteria: next.criteria, search: next.search, expectedRevision: Number((overview?.context as any)?.revision || 0) }, null);
    }
    else if (modal === 'assign' && assignMany) {
      const many = assignMany;
      const bulk = await perform('bulk', { op: 'assign', ids: many, teamId: draft.teamId || null, participantIds: draft.participantIds || [], responsibleId: draft.responsibleId || null,
        objective: draft.objective || '', dueAt: localDate(draft.dueAt || '') }, null, true) as BulkResult | null;
      if (bulk) {
        setPicked(new Set()); await afterBulk(many);
        setFeedback(`${bulk.done.length === 1 ? 'Asignamos 1' : `Asignamos ${bulk.done.length}`}: ya están en «Asignadas» y avisamos por correo.${bulk.skipped ? ` ${bulk.skipped === 1 ? 'Una no se pudo' : `${bulk.skipped} no se pudieron`}: estaban cerradas o cambiaron mientras tanto.` : ''}`);
      }
      result = bulk;
    }
    else if (modal === 'assign') {
      const from = assignFor;
      result = await perform('assign', { expectedRevision: from ? from.revision : detail?.work?.revision || 0, teamId: draft.teamId || null, participantIds: draft.participantIds || [], responsibleId: draft.responsibleId || null, objective: draft.objective || '', dueAt: localDate(draft.dueAt || '') },
        from ? from.id : selected, Boolean(from));
      if (result && from) setFeedback(`«${from.title.length > 70 ? `${from.title.slice(0, 69)}…` : from.title}» quedó asignada: ya está en «Asignadas».`);
    }
    else if (modal === 'task') {
      result = await perform('task', { ...(draft.id ? { id: draft.id } : {}), title: draft.title, ownerId: draft.ownerId || null, dueAt: dueAtOfDay(draft.day), evidence: draft.evidence || '' }, selected, true);
      if (result) setFeedback(draft.id ? 'Tarea actualizada.' : draft.ownerId && draft.ownerId !== user?.id ? 'Tarea creada. Le avisamos a quien la tiene.' : 'Tarea creada.');
    }
    else {
      result = await perform('create', { requestId:draft.requestId,title: draft.title, company: draft.company, kind: draft.kind || 'private_tender', description: draft.description || '', url: draft.url || null, deadline: localDate(draft.deadline || ''), amount: draft.amount ? Number(draft.amount) : null, currency: draft.currency || 'CLP' }, null, true);
      if (result?.id) {
        setBusy(true); const failed: string[] = []; const queue = [...files]; const createdId = String(result.id);
        setUploading(files.length ? { done: 0, total: files.length } : null);
        const send = async (file: File) => {
          try { const body = new FormData(); body.set('file', file); await json(await fetch(`/api/commercial-opportunities/${createdId}/documents`, { method: 'POST', body })); }
          catch (e) { failed.push(e instanceof Error ? e.message : `«${file.name}» no se pudo subir.`); }
          setUploading(current => current ? { ...current, done: current.done + 1 } : current);
        };
        await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, queue.length) }, async () => { for (let file = queue.shift(); file; file = queue.shift()) await send(file); }));
        setUploading(null); setBusy(false); open(createdId); await load();
        if (failed.length) setProblem(`La oportunidad quedó creada. ${failed.join(' ')} Puedes subirlos de nuevo en Documentos.`);
        else setFeedback('Oportunidad creada. Genera el informe cuando tengas todos los documentos.');
      }
    }
    if (result) { setModal(null); setFiles([]); }
  };
  const sourceNames = (kinds: string[]) => listEs(kinds.map(kind => SEARCH_SOURCES[kind] || kind));
  const discover = async () => {
    const result = await perform('discover', {}, null, true) as { queued: string[]; searching: string[]; fresh: string[]; later: string[] } | null;
    if (!result) return;
    if (result.queued.includes('criteria')) setFeedback('Preparando los criterios de búsqueda desde tu oferta. Después buscamos en todas las fuentes; tarda unos minutos.');
    else if (result.queued.length) setFeedback(`Buscando en ${sourceNames(result.queued)}. Las nuevas aparecen en el embudo en unos minutos.${result.fresh.length ? ` En ${sourceNames(result.fresh)} ya buscamos hace menos de una hora.` : ''}`);
    else if (result.searching.length) setFeedback(`Ya estamos buscando en ${sourceNames(result.searching)}. Las nuevas aparecen en el embudo en unos minutos.`);
    else setFeedback('Ya buscamos en todas las fuentes hace menos de una hora. Vuelve a intentarlo más tarde.');
  };
  const searching = overview?.searching || [];
  // While a search runs the list is read every 20 s; when it ends the pipeline is read again and a line says so.
  const wasSearching = useRef(false);
  useEffect(() => {
    if (searching.length) {
      wasSearching.current = true;
      const timer = setTimeout(() => { if (!document.hidden) void load(); }, 20_000);
      return () => clearTimeout(timer);
    }
    if (!wasSearching.current) return;
    wasSearching.current = false;
    setFeedback('Terminó la búsqueda: lo nuevo ya está en el embudo.');
    if (admin && view === 'pipeline' && !selected) void loadPipeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each new reading of the list, not each render.
  }, [overview]);
  // The administrator's list has the stages of the pipeline (list-stages.ts), so «Por revisar» means the same on both.
  const filters: ReadonlyArray<readonly [string, string]> = admin ? ADMIN_LIST_VIEWS.map(item => [item.id, item.label] as const) : MEMBER_FILTERS;
  const filterHint = (key: string) => ADMIN_LIST_VIEWS.find(item => item.id === key)?.hint;
  // The list starts on «recommended» (the administrator's first filter, and for a member it reads as «Mi trabajo»): a filter that is not in this person's row marks the first one.
  const shownFilter = filters.some(([key]) => key === filter) ? filter : filters[0]![0];
  const kinds = sourceKinds(source);
  const workOf = (id: string) => overview?.work.find(w => w.opportunity_id === id);
  const items = (overview?.items || []).filter(item => {
    const work = workOf(item.id);
    if (kinds.length && !kinds.includes(item.kind)) return false;
    if (categories.length && !inCategories(item, categories)) return false;
    if (search && ![item.title, item.company_name, item.buyer_name].join(' ').toLowerCase().includes(search.toLowerCase())) return false;
    if (!admin) return memberFilter(filter, work?.state);
    return inListView(shownFilter, true, item, work?.state);
  });
  // An address from before the stages («pending») opens the administrator's first filter.
  useEffect(() => { if (admin && !ADMIN_LIST_VIEWS.some(item => item.id === filter)) setFilter(ADMIN_LIST_VIEWS[0].id); }, [admin, filter]);
  const pickedItems = items.filter(item => picked.has(item.id));
  const pickedOpen = pickedItems.filter(item => listStageOf(workOf(item.id)?.state) === 'open').length;
  const pickedWorked = pickedItems.length - pickedOpen;
  const pickedArchived = pickedItems.filter(item => workOf(item.id)?.state === 'archived').length;
  // With a source picked, its group is called by it («Compra Ágil», «Recibidas»), not by the family it belongs to.
  const listGroups = bySource(items).map(group => source === 'all' ? group : { ...group, label: OPPORTUNITY_SOURCES.find(item => item.id === source)?.label ?? group.label });
  const card = (item: WorkItem) => {
    const work = workOf(item.id); const owner = overview?.members.find(m => m.user_id === work?.responsible_id);
    const region = opportunityRegion(item);
    const checked = picked.has(item.id);
    // Why it showed, without the keyword that matched: that is the radar's own detail, not news for whoever works it (OPP-41).
    const reason = item.reasons.find(text => !/^Palabra clave/i.test(text));
    // The whole card opens it with the pointer; with the keyboard, «Abrir y trabajar» does, one stop per card.
    const openFromCard = (event: { target: EventTarget | null }) => {
      if ((event.target as HTMLElement).closest('button, a, input, label, [role="checkbox"]') || window.getSelection()?.toString()) return;
      open(item.id);
    };
    return <article key={item.id} onClick={openFromCard} className={cn('cursor-pointer rounded-xl border bg-background p-5 transition-colors hover:border-foreground/25', checked && 'border-primary/50 bg-primary/5')}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-2">
          {admin ? <Checkbox checked={checked} onCheckedChange={value => togglePick(item.id, Boolean(value))} aria-label={`Seleccionar «${item.title.length > 80 ? `${item.title.slice(0, 79)}…` : item.title}»`} /> : null}
          <span>{TYPES[item.kind]}</span><AdvicePill item={item} state={work?.state} />{item.data.evaluation === 'excluded' ? null : <PriorityStars score={item.score} />}<ProgressMarks marks={progressChips(null, opened[item.id])} />
        </span>
        <span>{STATES[work?.state || 'unassigned']}</span>
      </div>
      <h3 className="mt-2 text-base font-semibold">{item.title}</h3>
      {opportunitySummary(item.data) ? <p className="mt-1 text-sm leading-6">{opportunitySummary(item.data)}</p> : null}
      {/* Who buys, when it closes and how much, in one line (OPP-41). */}
      <p className="mt-1 text-sm text-muted-foreground">{[item.company_name || item.buyer_name, item.deadline_at ? `Cierre ${date(item.deadline_at)}` : '',
        item.amount ? `${money(item.amount)} ${item.currency || ''}`.trim() : '', region].filter(Boolean).join(' · ')}</p>
      {admin && reason ? <p className="mt-3 text-sm leading-6">{reason}</p> : null}
      {work?.due_at || owner ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{work?.due_at && <span>Próxima acción: {date(work.due_at)}</span>}{owner && <span>Responsable: {owner.name}</span>}</div> : null}
      {work?.objective && <p className="mt-3 text-sm">Objetivo: {work.objective}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => open(item.id)}>Abrir y trabajar</Button>
        {admin && listStageOf(work?.state) === 'open' ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setProblem(''); setDiscarding({ ids: [item.id], title: item.title }); }}>
          <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />No es para nosotros</Button> : null}
        {admin && work?.state === 'archived' ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void reopen([item.id])}><RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Reabrir</Button> : null}
      </div>
    </article>;
  };
  const title = admin ? 'Gestionar oportunidades' : 'Mis oportunidades asignadas';
  const item = detail?.item;
  const signal = isSignalKind(item?.kind);
  // The parts of this opportunity. A link to one it does not have (a LinkedIn signal has no «Cómo postular») opens the report.
  const sections: Array<[string, string]> = detail ? [['summary', signal ? 'Ficha comercial' : 'Informe'], ...(signal ? [] : [['apply', 'Cómo postular'] as [string, string]]),
    ...(MARKET_KINDS.includes(detail.item.kind) ? [['market', 'Cómo ganar'] as [string, string]] : []), ['documents', `Documentos${detail.documents.length ? ` · ${detail.documents.length}` : ''}`],
    ['chat', 'Preguntar a la IA'], ['tasks', 'Plan y tareas'], ['contacts', 'Contactos'], ['activity', 'Actividad']] : [];
  const missingSection = sections.length > 0 && !sections.some(([id]) => id === tab);
  useEffect(() => { if (missingSection) setTab('summary'); }, [missingSection]);
  // The bases from anywhere on an open opportunity (OPP-17): files dropped on the page, or pasted outside a field, go to
  // «Documentos», where DocumentDrop sends them and says how each one went. A ZIP opens there, as always.
  const [incoming, setIncoming] = useState<File[] | null>(null);
  const [dropping, setDropping] = useState(false);
  const canDrop = Boolean(selected && item?.id === selected && !signal && !modal);
  useEffect(() => {
    if (!canDrop) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Not while a dialog is open (the company profile has documents of its own): there a drop is that dialog's or nobody's.
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files') && !document.querySelector('[role="dialog"], [role="alertdialog"]');
    const take = (files: File[]) => { if (files.length) { setTab('documents'); setIncoming(files); } };
    // The browser repeats «dragover» while files are over the page: the hint goes away a moment after they leave.
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault(); setDropping(true);
      clearTimeout(timer); timer = setTimeout(() => setDropping(false), 400);
    };
    const drop = (event: DragEvent) => {
      clearTimeout(timer); setDropping(false);
      // A drop zone of its own (DocumentDrop) already took them.
      if (event.defaultPrevented || !carriesFiles(event)) return;
      event.preventDefault(); take(Array.from(event.dataTransfer?.files || []));
    };
    const paste = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]') || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) { event.preventDefault(); take(files); }
    };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop); window.addEventListener('paste', paste);
    return () => { clearTimeout(timer); setDropping(false); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); window.removeEventListener('paste', paste); };
  }, [canDrop]);
  const latest = detail?.reports[0];
  // The plan of the latest report as tasks to create (OPP-21): its steps, or «Qué hacer ahora» when it has none.
  const planDrafts = latest && detail ? planTaskDrafts(latest.report.tasks.length ? latest.report.tasks : reportNextSteps(latest.report).map(title => ({ title })),
    { deadline: detail.item.deadline_at, responsibleId: detail.work?.responsible_id ?? null, people: detail.participants, existing: detail.tasks.map(task => task.title) }) : [];
  const newerDocuments = latest ? (detail?.documents || []).filter(d => d.source_kind === 'upload' && Date.parse(d.created_at) > Date.parse(latest.created_at)) : [];
  const links = usePublicLinks(selected, item?.kind);
  const advice = item ? workAdvice(item) : null;
  // «Marcar como leídas»: each notice once, then the list again.
  const clearNews = async (ids: string[]) => {
    await Promise.all(ids.map(id => fetch('/api/commercial-opportunities/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notification', data: { id } }) }).catch(() => null)));
    await load();
  };
  return <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 sm:p-6">
    {/* Where files dropped on an open opportunity go: it lets the drop through to the zone under it. */}
    {dropping && <div aria-hidden="true" data-testid="opportunity-drop" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0">
      <div className="flex max-w-sm flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-primary bg-background px-8 py-10 text-center shadow-lg">
        <UploadCloud className="h-8 w-8 text-primary" aria-hidden="true" />
        <p className="text-base font-semibold">Suelta para subirlos a esta oportunidad</p>
        <p className="text-sm text-muted-foreground">Quedan en «Documentos» y la IA los lee. Un ZIP se abre solo.</p>
      </div>
    </div>}
    {!selected && <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{admin ? 'Hallazgos y oportunidades recibidas, con un equipo y una siguiente acción.' : 'Tus asignaciones, el equipo de trabajo y lo que hay que hacer después.'}</p></div>
      {admin && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={openContext}><Settings className="mr-2 h-4 w-4" />Tu empresa</Button><Button onClick={() => { setDraft({ currency: 'CLP',requestId:crypto.randomUUID() }); setFiles([]); setCreateMode('upload'); setPrefill({ status: 'idle' }); setModal('create'); }}><FilePlus2 className="mr-2 h-4 w-4" />Cargar oportunidad</Button></div>}
    </header>}
    {problem && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{problem}</p><Button size="sm" variant="outline" onClick={() => { setProblem(''); void load(); if (selected) void loadDetail(selected); }}>Reintentar</Button></div>}
    {/* A notice floats at the bottom instead of pushing the page down (it moved «← Oportunidades» ≈46 px). */}
    {feedback && <div role="status" className="fixed inset-x-4 bottom-6 z-50 mx-auto flex w-fit max-w-xl items-center gap-3 rounded-xl border bg-background/95 px-4 py-3 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
      <span>{feedback}</span>{undo ? <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0" onClick={() => { const action = undo; setFeedback(''); action.run(); }}>{undo.label}</Button> : null}</div>}
    {!overview && !problem && <div role="status" className="rounded-xl border p-8"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Cargando oportunidades…</div>}
    {overview && !selected && <>
      {/* The offer confirmed is a status, not a task: one quiet line with its three small actions. Without it, asking to confirm it is the card. */}
      {admin && overview.context && <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>Oferta compartida confirmada · Búsqueda diaria {(overview.context as any).automation && overview.sourceStatus.automation ? 'programada' : 'pausada'} ·</span>
          <span className="inline-flex items-center gap-2"><span className="tabular-nums">US${cents(overview.budget.spent)} de US${overview.budget.cap} este mes</span>
            <span role="progressbar" aria-label="Presupuesto del mes usado" aria-valuemin={0} aria-valuemax={overview.budget.cap} aria-valuenow={Number(overview.budget.spent.toFixed(2))} className="h-1 w-16 overflow-hidden rounded-full bg-muted">
              <span className={cn('block h-full rounded-full', overview.budget.spent / overview.budget.cap >= 0.9 ? 'bg-destructive' : 'bg-primary/70')} style={{ width: `${Math.min(100, (overview.budget.spent / overview.budget.cap) * 100)}%` }} /></span></span>
          {searching.length ? <span role="status" className="inline-flex items-center gap-1.5">· <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />Buscando en {sourceNames(searching)}…</span> : null}</div>
        <div className="-ml-3 flex flex-wrap items-center sm:ml-0">{(overview.context as any).criteria?.postQueries?.length || (overview.context as any).criteria?.keywords?.length ? <Button variant="ghost" size="sm" onClick={openCriteria}>Qué buscamos</Button> : null}
          <Button variant="ghost" size="sm" onClick={() => setProfileOpen(true)}>Ficha para licitaciones</Button>
          {overview.sourceStatus.automation ? <Button variant="outline" size="sm" className="ml-1" disabled={busy || searching.length > 0} onClick={() => void discover()}>{searching.length ? 'Buscando…' : 'Actualizar oportunidades'}</Button> : null}</div></div>}
      {/* Audit O3: above the list only a source that is failing; the full state of the search and «Prepara tu empresa» are in «Tu empresa». */}
      {admin && overview.context && overview.health && overview.health.sources.some(item => item.state !== 'ok') ? <SearchHealthLine health={overview.health} /> : null}
      {admin && !overview.context && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4"><div><p className="text-sm font-medium">Confirma qué ofrece tu empresa</p><p className="mt-1 text-xs text-muted-foreground">La IA prepara los criterios desde tu oferta. No necesitas escribir palabras de búsqueda.</p></div>
        <Button onClick={openContext}>Confirmar oferta</Button></div>}
      {view !== 'assistant' && view !== 'market' && <NewsList notifications={overview.notifications} waiting={admin ? overview.waiting : null} onOpen={(id, section) => open(id, section)} onDecision={id => open(id, 'decision')}
        onClear={ids => void clearNews(ids)} when={at => humanDate(at, true) ?? ''} />}
      {admin && view !== 'assistant' && overview.documentAlerts?.length ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-cw-warning-soft px-4 py-3 text-sm">
        <p className="min-w-0"><span className="font-medium">{overview.documentAlerts[0].text}</span>{overview.documentAlerts.length > 1 ? <span className="text-muted-foreground"> · y {overview.documentAlerts.length - 1} más por renovar</span> : null}</p>
        <Button size="sm" variant="outline" onClick={() => setProfileOpen(true)}>Ver documentos</Button></div> : null}
      {/* «Mis tareas» (OPP-27) for everyone who works: a member always sees it; an administrator once they have tasks of their own. */}
      {/* The views are tabs (OPP-43): arrow keys between them, «pestaña 2 de 4», and on a phone one row that scrolls instead of wrapping. */}
      <SegmentedTabs label="Vistas de Oportunidades" idPrefix="opp-view" className="w-fit"
        value={admin || view === 'assistant' || view === 'tasks' ? view : 'list'} onChange={setView}
        tabs={((admin
          ? [['pipeline', 'Embudo'], ['list', 'Lista'], ['market', 'Mercado público'], ...(overview.myTasks?.open || view === 'tasks' ? [['tasks', 'Mis tareas']] : []), ['assistant', 'Asistente']]
          : [['list', 'Mis oportunidades'], ['tasks', 'Mis tareas'], ['assistant', 'Asistente']]) as Array<[WorkspaceView, string]>).map(([key, label]) => {
          const late = key === 'tasks' ? overview.myTasks?.late ?? 0 : 0;
          return { value: key, count: key === 'tasks' && overview.myTasks?.open ? overview.myTasks.open : null,
            // On a phone «Mis oportunidades» says «Oportunidades».
            label: label === 'Mis oportunidades' ? <><span className="sm:hidden">Oportunidades</span><span className="hidden sm:inline">{label}</span></> : label,
            // After the count, so it reads «Mis tareas 3, 1 vencida».
            after: late ? <><span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" /><span className="sr-only">, {late === 1 ? '1 vencida' : `${late} vencidas`}</span></> : null };
        })} />
      {/* The panel of the view on show, named by its tab (OPP-43). */}
      <div {...tabPanelProps('opp-view', view)} className="flex flex-col gap-5">
      {view === 'assistant' ? <OpportunityAssistant admin={admin} threadId={assistantThread} onThread={setAssistantThread} onOpen={open} onHandoff={continueIn} />
        : view === 'tasks' ? <MyTasks tasks={myTasks} error={myTasksError} busy={busy} onOpen={id => open(id, 'tasks')} onDone={finishMyTask} onRetry={() => void loadMyTasks()} />
        : admin && view === 'market' ? <PublicMarket onOpen={open} onCriteria={(overview.context as any)?.criteria ? openCriteria : undefined} onProfile={() => setProfileOpen(true)} />
        : admin && view === 'pipeline' ? <>
        <OpportunityFilters query={query} onQuery={setQuery} source={source} onSource={setSource} categories={categories} onCategories={setCategories} />
        {pipeline ? <PipelineBoard items={pipeline.items} work={pipeline.work} totals={pipeline.totals} limits={pipeline.limits} members={overview.members} busy={busy} summariesWaiting={Boolean(pipeline.summaries?.waiting) && !summariesStalled}
        suggestions={suggestions} reviewing={reviewing} onReview={() => void review()} onMove={(id, state, revision) => void moveTo(id, state, revision)} onOpen={open} onAssign={item => void openQuickAssign(item)}
        onDiscard={item => { setProblem(''); setDiscarding({ ids: [item.id], title: item.title }); }} onReopen={item => void reopen([item.id])}
        filtered={Boolean(search) || source !== 'all' || categories.length > 0} loadingMore={loadingMore} refreshing={pipelineFor !== filterKey} sort={sort} onSort={setSort} progress={pipeline.progress} opened={opened} week={pipeline.week}
        rules={adminSettings.rules} onRules={() => { setProblem(''); setRulesOpen(true); }} onAssignByRules={groups => { setProblem(''); setRuleAssign(groups); }}
        onMore={loadMore} onClearFilters={clearFilters} />
        : <div role="status" className="rounded-3xl border p-8 text-sm text-muted-foreground"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Cargando el embudo…</div>}</> : <>
      <OpportunityFilters query={query} onQuery={setQuery} source={source} onSource={setSource} categories={categories} onCategories={setCategories} showSources={admin}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filtrar oportunidades" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5 lg:flex-wrap lg:overflow-visible">{filters.map(([key, label]) => {
            // «Todas» of an administrator holds what already closed too, so it goes without a number; a member's «Mi trabajo» has one.
            const count = key === 'all' && admin ? undefined : overview.counts?.[key];
            return <button key={key} type="button" aria-pressed={shownFilter === key} title={filterHint(key)} onClick={() => setFilter(key)} className={filterChip(shownFilter === key)}>
              {label}{count !== undefined ? <span className="ml-1.5 tabular-nums opacity-70">{new Intl.NumberFormat('es-CL').format(count)}</span> : null}</button>; })}</div>
          {admin ? <div role="group" aria-label="Ordenar la lista" className="flex w-fit shrink-0 items-center gap-0.5 rounded-full border p-0.5">{PRIORITY_SORTS.map(option => <button key={option.id} type="button" aria-pressed={sort === option.id} title={option.hint}
            onClick={() => setSort(option.id)} className={cn('rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              sort === option.id ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{option.label}</button>)}</div> : null}
        </div>
      </OpportunityFilters>
      {admin ? <SavedSearches searches={adminSettings.searches} current={{ filter: shownFilter as SavedSearch['filter'], source, query: search.trim(), categories }} userId={user?.id || ''} busy={busy}
        onApply={saved => { setFilter(saved.filter); setSource(saved.source); setQuery(saved.query); setSearch(saved.query); setCategories([...saved.categories]); }}
        onSave={() => void saveSearch({ filter: shownFilter as SavedSearch['filter'], source, query: search.trim(), categories })} onNotify={(id, on) => void notifySearch(id, on)} onRemove={id => void removeSearch(id)} /> : null}
      {!items.length && <section className="rounded-xl border p-8"><h2 className="font-semibold">{admin ? 'No hay oportunidades en esta vista' : 'Aún no tienes oportunidades en esta vista'}</h2><p className="mt-2 max-w-xl text-sm text-muted-foreground">{search || source !== 'all' || categories.length ? 'Prueba otro texto, otra fuente u otro rubro, o cambia el filtro.' : admin ? 'Confirma la oferta para recibir hallazgos o carga una oportunidad que haya recibido el equipo.' : 'Las oportunidades que te asigne un administrador aparecerán aquí con tu equipo y las próximas acciones.'}</p>
        {search || source !== 'all' || categories.length ? <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Quitar filtros</Button> : null}</section>}
      {admin && shownFilter === 'recommended' && !search && source === 'all' && !categories.length && <StartHere items={items} onOpen={open} />}
      {admin && items.length > 1 && shownFilter !== 'excluded' ? <div className="flex items-center gap-2"><Checkbox id="op-pick-all" checked={items.every(item => picked.has(item.id))}
        onCheckedChange={value => setPicked(value ? new Set(items.map(item => item.id)) : new Set())} /><Label htmlFor="op-pick-all" className="text-sm font-normal text-muted-foreground">Seleccionar las {items.length} de esta página</Label></div> : null}
      {items.length > 0 && <div className="space-y-8">{listGroups.map(group => <section key={group.key} aria-labelledby={`source-${group.key}`} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h2 id={`source-${group.key}`} className="text-lg font-semibold">{group.label} <span className="text-sm font-normal tabular-nums text-muted-foreground">{group.items.length}</span></h2><p className="text-xs text-muted-foreground">{group.note}</p></div>
        {admin && shownFilter === 'excluded' ? <ExclusionGroups items={group.items} onOpen={open} /> : <div className={cn('grid gap-3', group.items.length > 1 && 'xl:grid-cols-2')}>{group.items.map(card)}</div>}
      </section>)}</div>}
      {admin && pickedItems.length > 0 ? <ActionBar ariaLabel="Acciones con las oportunidades seleccionadas" label={`${pickedItems.length} ${pickedItems.length === 1 ? 'seleccionada' : 'seleccionadas'}`}
        hint={[pickedOpen ? `${pickedOpen} sin equipo` : '', pickedWorked ? `${pickedWorked} con equipo` : ''].filter(Boolean).join(' · ')}>
        <Button type="button" variant="ghost" onClick={() => setPicked(new Set())}>Quitar selección</Button>
        {pickedWorked ? <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" disabled={busy}>Mover a…</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void movePicked('working')}>En preparación</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void movePicked('submitted')}>Presentada</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void movePicked('archived')}>Archivada</DropdownMenuItem>
            {pickedArchived ? <DropdownMenuItem onClick={() => void movePicked('unassigned')}>Reabrir</DropdownMenuItem> : null}
          </DropdownMenuContent></DropdownMenu> : null}
        {pickedOpen ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setProblem(''); setDiscarding({ ids: pickedItems.filter(item => listStageOf(workOf(item.id)?.state) === 'open').map(item => item.id) }); }}>
          <Archive className="mr-2 h-4 w-4" aria-hidden="true" />No es para nosotros</Button> : null}
        {pickedOpen ? <Button type="button" disabled={busy} onClick={openBulkAssign}><Users className="mr-2 h-4 w-4" aria-hidden="true" />Asignar</Button> : null}
      </ActionBar> : null}
      </>}
      {!(admin && (view === 'pipeline' || view === 'market')) && view !== 'assistant' && view !== 'tasks' && <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><p className="text-xs text-muted-foreground">Página {page + 1} · hasta 100 oportunidades</p><Button variant="outline" disabled={overview.items.length < 100} onClick={() => setPage(p => p + 1)}>Siguiente</Button></div>}
      </div>
    </>}
    {selected && <>
      <Button variant="ghost" className="-ml-2 self-start" onClick={close}><ArrowLeft className="mr-2 h-4 w-4" />Oportunidades</Button>
      {!detail && !problem && <div role="status" className="rounded-xl border p-8"><Loader2 className="mb-3 h-5 w-5 animate-spin" />Abriendo la oportunidad…</div>}
      {detail && item && <>
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{TYPES[item.kind]}</span><AdvicePill item={item} state={detail.work?.state} decision={latest ? reportDecision({ recommendation: latest.report.recommendation, kind: latest.report.kind ?? item.kind }) : undefined} /><span>· {STATES[detail.work?.state || 'unassigned']}</span></div>
          <h1 className="max-w-4xl text-2xl font-semibold tracking-tight">{item.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">{item.company_name || item.buyer_name}
            {/* «Seguir a un organismo» (OPP-10): a saved search by its name, told in the morning email when it publishes something new. */}
            {admin && !signal && item.buyer_name ? (() => {
              const follow = buyerSearch(item.buyer_name); const saved = adminSettings.searches.find(search => sameSearch(search, follow)); const on = Boolean(saved && user?.id && saved.notify.includes(user.id));
              return <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-pressed={on} disabled={busy} onClick={() => void (saved ? notifySearch(saved.id, !on) : saveSearch(follow, follow.name))}>
                <Bell className={cn('mr-1.5 h-3.5 w-3.5', on && 'fill-current')} aria-hidden="true" />{on ? 'Te avisamos de este organismo' : 'Avisarme de este organismo'}</Button>;
            })() : null}</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {!signal && <div><dt className="text-xs text-muted-foreground">Cierre</dt><dd className="font-medium">{humanDate(item.deadline_at, true) ?? 'Sin fecha informada'}{advice && closesLabel(advice) ? <span className={cn('ml-2 text-xs', advice.urgent ? 'text-destructive' : 'text-muted-foreground')}>{closesLabel(advice)}</span> : null}</dd></div>}
            {!signal && <div><dt className="text-xs text-muted-foreground">Monto</dt><dd className="font-medium">{item.amount ? `${money(item.amount)} ${item.currency || ''}` : 'No informado'}</dd></div>}
            {typeof (item.data as any)?.observed?.code === 'string' && <div><dt className="text-xs text-muted-foreground">Código</dt><dd className="font-medium">{(item.data as any).observed.code}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">Equipo</dt><dd className="flex items-center gap-2 font-medium">{detail.participants.length ? <><span className="flex -space-x-2" aria-hidden="true">{detail.participants.slice(0, 4).map(p => <InitialsAvatar key={p.user_id} name={p.name} size="sm" className="ring-2 ring-background" />)}</span><span>{detail.participants.map(p => `${p.name}${p.user_id === detail.work?.responsible_id ? ' (responsable)' : ''}`).join(', ')}</span></> : 'Sin asignar'}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {/* One main action per screen: while the guide shows its own «Generar», the header does not repeat it. */}
            {/* With the report ready, the main action is the next step: applying, or finding whom to write to. Once it was handed in or closed there is no next step to push. */}
            {latest && !researching && tab !== (signal ? 'contacts' : 'apply') && <Button variant={isFinished(detail.work?.state) ? 'outline' : 'default'} onClick={() => setTab(signal ? 'contacts' : 'apply')}>{signal ? <Users className="mr-2 h-4 w-4" aria-hidden="true" /> : <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" />}{signal ? 'Buscar a quién escribir' : 'Cómo postular'}</Button>}
            {(latest || researching || tab !== 'summary') && <Button variant={latest && !researching ? 'ghost' : 'default'} onClick={generate} disabled={busy || researching}>{researching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{researching ? 'Preparando…' : latest ? (signal ? 'Actualizar ficha comercial' : 'Actualizar informe') : (signal ? 'Generar ficha comercial' : 'Generar informe')}</Button>}
            {admin && detail.work?.state !== 'archived' && <Button variant="outline" onClick={() => { setDraft({ teamId: detail.work?.team_id || '', participantIds: detail.participants.map(p => p.user_id), responsibleId: detail.work?.responsible_id || '', objective: detail.work?.objective || '' }); setModal('assign'); }}><Users className="mr-2 h-4 w-4" />{detail.participants.length ? 'Cambiar equipo' : 'Asignar equipo'}</Button>}
            {admin && listStageOf(detail.work?.state) === 'open' ? <Button variant="ghost" disabled={busy} onClick={() => { setProblem(''); setDiscarding({ ids: [item.id], title: item.title }); }}><Archive className="mr-2 h-4 w-4" aria-hidden="true" />No es para nosotros</Button> : null}
            {admin && detail.work?.state === 'archived' ? <Button variant="outline" disabled={busy} onClick={() => void reopen([item.id])}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Reabrir</Button> : null}
            {item.url && <Button asChild variant="ghost"><a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />{item.kind === 'tender' ? 'Ver en Mercado Público' : signal ? 'Ver en LinkedIn' : 'Ver fuente'}</a></Button>}
          </div>
          {detail.work && detail.work.state !== 'unassigned' && <MemberStrip state={detail.work.state} canStep={!admin} busy={busy}
            assignedBy={(detail.members || detail.participants).find(m => m.user_id === detail.work?.assigned_by)?.name ?? null} nextActionAt={detail.work.due_at}
            openTasks={detail.tasks.filter(t => t.owner_id === user?.id && t.status !== 'done').length} onStep={stepTo} onDecision={decide} onMove={admin ? changeStage : undefined} />}
          {detail.work?.objective && <p className="text-sm">Objetivo: {detail.work.objective}</p>}
        </header>
        {item.kind === 'tender' && detail.work ? <TenderResultCallout result={(item.data as { result?: StoredResult } | null)?.result} state={detail.work.state} admin={admin} busy={busy}
          onClose={(to, prefill) => { setProblem(''); setClosing({ id: item.id, state: to, revision: detail.work!.revision, prefill }); }} /> : null}
        {(() => {
          const decision = openDecision(detail.activity);
          return decision ? <DecisionCallout decision={decision} admin={admin} busy={busy} onReply={replyDecision}
            who={(detail.members || detail.participants).find(m => m.user_id === decision.actorId)?.name ?? 'Alguien del equipo'} /> : null;
        })()}
        {/* The sections are tabs, not filters (OPP-43): underlined, with the arrow keys, and one row that scrolls on a phone (OPP-42). */}
        <SegmentedTabs variant="underline" label="Secciones de la oportunidad" idPrefix="opp-section" value={tab} onChange={setTab}
          tabs={sections.map(([id, label]) => ({ value: id, label }))} />
        <div {...tabPanelProps('opp-section', tab)}>
        {tab === 'summary' && <div className="space-y-5">
          {/* The team is said once, in the header with its «Cambiar equipo» (OPP-40). */}
          <FitProposals proposals={pendingFitProposals(detail.activity)} admin={admin} busy={busy} onResolve={(activityId, accept) => void resolveProposal(activityId, accept)}
            nameOf={userId => (detail.members || detail.participants).find(m => m.user_id === userId)?.name ?? 'Alguien del equipo'} />
          {research && (researching || ['failed', 'blocked'].includes(research.state)) && <ReportProgress state={research.state} error={research.error} signal={signal} pending={busy} onRetry={generate} kept={Boolean(latest)}
            progress={research.progress} tender={item.kind === 'tender'} documents={detail.documents.length} buyer={item.buyer_name || item.company_name} />}
          {latest && newerDocuments.length > 0 && !researching && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-4 text-sm"><p>Subiste {newerDocuments.length === 1 ? 'un documento nuevo' : `${newerDocuments.length} documentos nuevos`} después del informe. Actualízalo para incluir{newerDocuments.length === 1 ? 'lo' : 'los'}.</p><Button size="sm" onClick={generate} disabled={busy}>Actualizar informe</Button></div>}
          {latest && item.kind === 'tender' && !advice?.closed && !detail.documents.some(d => d.source_kind === 'upload') && !researching && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cw-warning-soft p-4 text-sm"><p>Este informe se hizo sin las bases. Súbelas para completarlo: la IA podrá revisar requisitos, criterios y garantías.</p><Button size="sm" variant="outline" onClick={() => setTab('documents')}>Subir bases</Button></div>}
          {!latest && !researching && <ExpedientGuide kind={item.kind} url={item.url} links={links} documents={detail.documents} onUpload={upload} onGenerate={generate} generating={researching} hasReport={false} busy={busy} closed={advice?.closed ? humanDate(item.deadline_at) : null} />}
          {!latest && !researching && !signal && item.reasons[0] && <div className="rounded-2xl border p-5"><h2 className="text-sm font-semibold">Por qué apareció</h2><p className="mt-2 text-sm leading-6">{item.reasons.join(' ')}</p></div>}
          {signal ? <SignalSheetPanel item={item} report={latest?.report ?? null} decisionMakerTitles={detail.decisionMakerTitles || []} contactsCount={detail.contacts?.length ?? 0}
            marks={detail.marks} onMark={mark} people={detail.members || detail.participants}
            onTask={(title, evidence) => { setDraft({ title, evidence }); setModal('task'); }} onAsk={ask} onContacts={() => setTab('contacts')} onGenerate={latest ? generate : undefined} generating={busy || researching}
            downloadHref={`/api/commercial-opportunities/${selected}/export?format=pdf`} /> : null}
          {!signal && latest && <>
            <div className="flex flex-wrap items-center justify-end gap-2"><label className="sr-only" htmlFor="op-export">Formato de descarga</label><select id="op-export" value={download} onChange={e => setDownload(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring">{[['pdf', 'PDF'], ['docx', 'Word'], ['xlsx', 'Excel'], ['md', 'Markdown'], ['zip', 'Expediente completo (ZIP)']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button asChild variant="outline" size="sm"><a href={`/api/commercial-opportunities/${selected}/export?format=${download}`}><Download className="mr-2 h-4 w-4" />Descargar</a></Button></div>
            <OpportunityWorkReport report={latest.report} previous={detail.reports[1] ? { latest, before: detail.reports[1] } : null} opportunity={{ id: item.id, kind: item.kind, code: (item.data as { observed?: { code?: string } } | null)?.observed?.code ?? null, url: item.url, title: item.title, buyer: item.buyer_name || item.company_name, deadline: item.deadline_at, amount: item.amount, currency: item.currency }}
              onTask={(title, evidence) => { setDraft({ title, evidence }); setModal('task'); }} onAsk={ask} onContacts={() => setTab('contacts')}
              marks={detail.marks} onMark={mark} people={detail.members || detail.participants}
              fit={detail.fit} fitBusy={busy} onFit={() => void checkFit('fit', {})} onAnswer={(question, answer) => void checkFit('fit_answer', { question, answer })} />
          </>}
        </div>}
        {tab === 'apply' && !signal && <div className="space-y-5">
          <SubmissionKit report={latest?.report ?? null} opportunity={{ title: item.title, kind: item.kind, amount: item.amount, currency: item.currency, deadline: item.deadline_at }}
          marks={detail.marks} onMark={mark} people={detail.members || detail.participants} onGenerate={generate} generating={researching}
          hideNumbers={Boolean(detail.offer?.latest?.draft.economic.lines.length)}
          annexes={detail.offer?.latest?.draft.annexes} annexHref={index => `/api/commercial-opportunities/${selected}/export?doc=offer&format=docx&annex=${index}`}
          offer={latest && OFFER_KINDS.includes(item.kind) ? <OfferDraft offer={detail.offer} job={offerJob} onPrepare={prepareOffer} preparing={busy} onSavePrices={saveOfferPrices}
            downloadHref={`/api/commercial-opportunities/${selected}/export?doc=offer&format=docx`}
            annexHref={index => `/api/commercial-opportunities/${selected}/export?doc=offer&format=docx&annex=${index}`}
            canPrice={detail.offer?.canPrice !== false} people={detail.members || detail.participants} partJobs={partJobs}
            onSavePart={saveOfferPart} onRewritePart={rewriteOfferPart} onReview={reviewOffer}
            versionHref={version => `/api/commercial-opportunities/${selected}/export?doc=offer&format=docx&version=${version}`}
            budget={{ amount: latest.report.submission?.numbers.budget ?? item.amount, includesTax: latest.report.submission?.numbers.budgetIncludesTax ?? null }} /> : null}
          onDraft={latest ? title => ask(`Prepara el borrador de «${title}» como un formulario listo para llenar y pegar en Word: el título tal como lo dan las bases, una tabla de dos columnas (Campo | Dato) con los datos de mi empresa que conoces, el texto de cada declaración o cláusula tal como lo piden las bases, y [corchetes] para lo que falte. Si no tienes el formato oficial en los fragmentos, dilo al comienzo en una frase.`) : undefined} />
          {/* The cost of an hour and the points the price is worth: for whoever sets the prices (an administrator or whoever is in charge). */}
          {OFFER_KINDS.includes(item.kind) && detail.offer?.canPrice !== false ? <PriceStudio key={item.id} storageKey={studioKey(user?.id, item.id)} server={detail.priceStudy} people={detail.members || detail.participants}
            onSave={savePriceStudy} onOpenVersion={openPriceVersion} onMarket={MARKET_KINDS.includes(item.kind) ? () => setTab('market') : undefined}
            offer={detail.offer?.latest?.draft.economic.lines.length ? { lines: detail.offer.latest.draft.economic.lines.map((line, index) => ({ index, description: line.description })),
              withTax: detail.offer.latest.draft.economic.priceBasis === 'total', onUse: putInOffer } : null} /> : null}
        </div>}
        {tab === 'market' && MARKET_KINDS.includes(item.kind) && <WinPlan id={selected} />}
        {tab === 'documents' && <section className="space-y-5">
          {!signal && <ExpedientGuide kind={item.kind} url={item.url} links={links} documents={detail.documents} onUpload={upload} onGenerate={generate} generating={researching} hasReport={Boolean(latest)} busy={busy} closed={advice?.closed ? humanDate(item.deadline_at) : null}
            incoming={incoming} onTaken={() => setIncoming(null)} />}
          {signal && <p className="text-sm text-muted-foreground">Las señales de LinkedIn no tienen bases. Si recibiste algo de esta empresa (una invitación, un requerimiento), súbelo en <button type="button" className="underline" onClick={() => document.getElementById('op-document')?.click()}>Documentos</button>.</p>}
          {signal && <input id="op-document" type="file" multiple accept={ACCEPTED_FILES} className="sr-only" onChange={e => void upload(Array.from(e.target.files || []), () => undefined)} />}
          <div><h2 className="mb-3 font-semibold">En el expediente</h2><DocumentList id={selected} documents={detail.documents} kind={item.kind} scanning={scanning} onUploadMore={() => document.getElementById('op-document')?.click()} /></div>
        </section>}
        {tab === 'tasks' && <OpportunityTasks tasks={detail.tasks} people={detail.participants} busy={busy} planLeft={planDrafts.filter(draft => !draft.exists).length}
          canDelete={task => admin || task.created_by === user?.id || detail.work?.responsible_id === user?.id}
          onPlan={() => { setProblem(''); setPlanOpen(true); }} onCreate={() => { setDraft({}); setModal('task'); }} onEdit={editTask} onStatus={taskStatus} onOwner={taskOwner} onDelete={task => void removeTask(task)} />}
        {tab === 'contacts' && <OpportunityContacts id={selected} company={item.company_name || item.buyer_name || item.title} domain={item.company_domain} titles={detail.decisionMakerTitles || []} />}
        {tab === 'activity' && <OpportunityActivity activity={detail.activity} members={detail.members || detail.participants} userId={user?.id ?? null} busy={busy} when={at => date(at)}
          mentionable={(detail.members || detail.participants).filter(member => detail.participants.some(person => person.user_id === member.user_id) || member.role === 'owner' || member.role === 'admin')}
          note={note} onNote={setNote} onAdd={addNote} onEdit={editNote} onDelete={row => void removeNote(row)} />}
        {tab === 'chat' && <OpportunityChat messages={messages} pending={pendingQuestion} documentCount={detail.documents.length} busy={busy}
          suggestions={signal ? SUGGESTED_QUESTIONS.signal : SUGGESTED_QUESTIONS.tender}
          placeholder={signal ? '¿Qué cargo debería contactar primero?' : 'Pregunta lo que quieras sobre esta licitación…'} onAsk={ask} />}
        </div>
      </>}
    </>}
    {admin&&selected&&<OpportunityReconsiderDialog open={reconsider} onOpenChange={setReconsider} busy={busy} onConfirm={async reason=>Boolean(await perform('reconsider',{reason}))}/>}
    {admin && <CloseReasonDialog target={closing} busy={busy} error={closing ? problem : ''} onConfirm={confirmClose} onCancel={() => setClosing(null)} />}
    {detail ? <PlanTasksDialog open={planOpen} drafts={planDrafts} people={detail.participants} busy={busy} error={planOpen ? problem : ''}
      closeLabel={detail.item.deadline_at ? dayLabel(chileDay(detail.item.deadline_at), chileDay(new Date())) : null} onConfirm={tasks => void createPlanned(tasks)} onCancel={() => setPlanOpen(false)} /> : null}
    {admin && <DiscardDialog target={discarding} busy={busy} error={discarding ? problem : ''} onConfirm={confirmDiscard} onCancel={() => setDiscarding(null)} />}
    {admin ? <AssignmentRulesDialog open={rulesOpen} rules={adminSettings.rules} members={overview?.members || []} busy={busy} error={rulesOpen ? problem : ''} onSave={saveRules} onCancel={() => setRulesOpen(false)} /> : null}
    {admin ? <RuleAssignDialog groups={ruleAssign} titles={Object.fromEntries((pipeline?.items || []).map(item => [item.id, item.title]))} busy={busy} error={ruleAssign ? problem : ''}
      onConfirm={confirmRuleAssign} onCancel={() => setRuleAssign(null)} /> : null}
    {admin && <TenderProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />}
    <Dialog open={modal !== null} onOpenChange={open => { if (!open) void closeModal(); }}><DialogContent className={cn('max-h-[90dvh] overflow-y-auto', modal === 'context' || modal === 'create' ? 'sm:max-w-3xl' : 'sm:max-w-2xl')}><DialogHeader><DialogTitle>{modal === 'create' ? 'Cargar oportunidad recibida' : modal === 'context' ? 'Tu empresa' : modal === 'criteria' ? 'Qué buscamos para tu empresa' : modal === 'assign' ? (assignMany ? `Asignar ${assignMany.length === 1 ? 'una oportunidad' : `${assignMany.length} oportunidades`}` : assignFor ? `Asignar «${assignFor.title.length > 80 ? `${assignFor.title.slice(0, 79)}…` : assignFor.title}»` : 'Asignar equipo de trabajo') : draft.id ? 'Editar tarea' : 'Crear tarea'}</DialogTitle><DialogDescription>{modal === 'context' ? 'Lo que la IA sabe de tu empresa para buscar oportunidades y decidir cuáles te convienen.' : modal === 'criteria' ? 'Dónde buscamos y qué. La IA preparó los criterios desde tu oferta; corrígelos si algo no calza. Se usan desde la próxima búsqueda.' : modal === 'assign' ? 'Los participantes recibirán la asignación y podrán trabajar en el expediente.' : modal === 'task' ? 'Una acción concreta, quién la hace y para cuándo.' : 'Completa la información disponible; los datos faltantes se identificarán en el análisis.'}</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={e => { e.preventDefault(); void saveModal().catch(e => setProblem(e instanceof Error ? e.message : 'Revisa los datos.')); }}>
        {modal === 'context' ? <>
          {overview?.health ? <SearchHealthLine health={overview.health} /> : null}
          {overview?.setup ? <CompanySetup facts={overview.setup} onStep={step => void setupStep(step)} /> : null}
          <WorkspaceCompanyFields draft={draft} field={field} />
          <OpportunityTicketConnection />
        </>
        : modal === 'criteria' ? (criteria ? <SearchCriteriaFields draft={criteria} onChange={setCriteria} /> : null)
        : modal === 'assign' ? <>
          {overview?.groups.length ? <div className="space-y-1.5"><p className="text-sm font-medium">Usar un equipo de la organización · opcional</p><div className="flex flex-wrap gap-2">{overview.groups.map(g => <button key={g.id} type="button" aria-pressed={draft.teamId === g.id} onClick={() => field('teamId', draft.teamId === g.id ? '' : g.id)} className={cn(filterChip(draft.teamId === g.id), 'h-9')}>{g.name}</button>)}</div><p className="text-xs text-muted-foreground">Suma a todas las personas de ese equipo.</p></div> : null}
          <div className="space-y-1.5"><p className="text-sm font-medium">¿Quién trabaja esta oportunidad?</p><p className="text-xs text-muted-foreground">{assignFor && assignRule ? `${assignRule} ` : ''}Toca a cada persona; la estrella marca a quien responde por ella.</p>
            <TeamPicker members={overview?.members || []} selected={draft.participantIds || []} responsibleId={draft.responsibleId || ''} onChange={next => { field('participantIds', next.selected); field('responsibleId', next.responsibleId); }} /></div>
          <TeamOffice people={(overview?.members || []).filter(m => (draft.participantIds || []).includes(m.user_id))} responsibleId={draft.responsibleId} empty={draft.teamId ? 'Se sumará el equipo elegido.' : 'Elige a las personas y aquí verás a tu equipo.'} />
          <div className="space-y-2"><Label htmlFor="op-objective">Objetivo · opcional</Label><Input id="op-objective" value={draft.objective || ''} onChange={e => field('objective', e.target.value)} placeholder="Ej.: presentar la oferta antes del cierre" maxLength={500} /></div>
          <div className="space-y-1.5"><p className="text-sm font-medium">Próxima acción · opcional</p><div className="flex flex-wrap items-center gap-2">{QUICK_DUE.map(([label, days]) => <button key={label} type="button" aria-pressed={draft.dueAt === dueIn(days)} onClick={() => field('dueAt', dueIn(days))} className={cn(filterChip(draft.dueAt === dueIn(days)), 'h-9')}>{label}</button>)}<Input id="op-due" type="datetime-local" aria-label="Otra fecha y hora" className="h-9 w-auto" value={draft.dueAt || ''} onChange={e => field('dueAt', e.target.value)} /></div></div>
        </>
        : modal === 'task' ? <>
          <div className="space-y-2"><Label htmlFor="op-task-title">Acción</Label><Input id="op-task-title" required value={draft.title || ''} onChange={e => field('title', e.target.value)} placeholder="Ej.: pedir el certificado de antecedentes laborales" /></div>
          <div className="space-y-2"><Label htmlFor="op-task-owner">Responsable</Label><select id="op-task-owner" value={draft.ownerId || ''} onChange={e => field('ownerId', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Sin asignar</option>{detail?.participants.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></div>
          {/* A task is due on a day (OPP-27): the quick ones, or any other in the calendar. */}
          <div className="space-y-1.5"><p className="text-sm font-medium">Para cuándo · opcional</p><div className="flex flex-wrap items-center gap-2">{QUICK_DUE.map(([label, days]) => <button key={label} type="button" aria-pressed={draft.day === taskDay(days)} onClick={() => field('day', draft.day === taskDay(days) ? '' : taskDay(days))} className={cn(filterChip(draft.day === taskDay(days)), 'h-9')}>{label}</button>)}<Input id="op-task-due" type="date" aria-label="Otra fecha" className="h-9 w-auto" value={draft.day || ''} onChange={e => field('day', e.target.value)} /></div></div>
          <div className="space-y-2"><Label htmlFor="op-task-evidence">Evidencia o resultado esperado · opcional</Label><Textarea id="op-task-evidence" value={draft.evidence || ''} onChange={e => field('evidence', e.target.value)} /></div></>
        : <>
          <div role="group" aria-label="Cómo cargarla" className="flex w-full rounded-xl bg-muted p-1 sm:w-fit">{([['upload', 'Subir documento'], ['write', 'Escribir los datos']] as const).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={createMode === key} disabled={prefill.status === 'reading'} onClick={() => setCreateMode(key)} className={cn('flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:flex-none', createMode === key ? 'bg-background shadow-sm' : 'text-foreground/70 hover:text-foreground')}>{label}</button>)}</div>
          {createMode === 'upload' ? <div className="space-y-3">
            <label htmlFor="op-prefill-file" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const dropped = Array.from(e.dataTransfer.files || []); if (dropped.length && prefill.status !== 'reading') void readDocuments(dropped); }}
              className={cn('flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40', prefill.status === 'reading' && 'cursor-wait')}>
              {prefill.status === 'reading' ? <Loader2 className="h-6 w-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" /> : <FileUp className="h-6 w-6 text-primary" aria-hidden="true" />}
              <span className="max-w-md space-y-1"><span className="block font-medium">{prefill.status === 'reading' ? `Leyendo ${prefill.name?.includes(' archivos') ? prefill.name : `«${prefill.name}»`}…` : 'Sube la invitación, las bases o el correo'}</span>
                <span className="block text-sm leading-6 text-muted-foreground">{prefill.status === 'reading' ? 'La IA está completando el formulario. Tarda unos segundos.' : 'Puedes subir varios documentos o el ZIP con las bases y los anexos. La IA lee los más importantes y completa el formulario; tú lo revisas antes de guardar.'}</span></span>
              {prefill.status !== 'reading' ? <span className="inline-flex h-9 items-center rounded-md border bg-background px-4 text-sm font-medium shadow-sm">Elegir documentos</span> : null}
              <input id="op-prefill-file" type="file" multiple className="sr-only" accept={ACCEPTED_FILES} disabled={prefill.status === 'reading'} onChange={e => { const chosen = Array.from(e.target.files || []); e.target.value = ''; void readDocuments(chosen); }} />
            </label>
            {prefill.status === 'reading' ? <p role="status" className="sr-only">Leyendo el documento</p> : null}
            {prefill.status === 'error' ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm"><p>{prefill.message}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setCreateMode('write')}>Escribir los datos</Button></div> : null}
            <p className="text-xs text-muted-foreground">PDF, Word, Excel, texto, fotos, el correo (.eml o .msg) o un ZIP, hasta 20 MB cada documento. Todos quedan guardados con la oportunidad.</p>
          </div> : <>
            {prefill.status === 'done' ? <div role="status" className="flex gap-2 rounded-xl bg-primary/5 px-3 py-2.5 text-sm leading-6"><Sparkles className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><div className="space-y-1"><p>{prefill.pasted ? 'Completamos el formulario con el texto que pegaste.' : (prefill.read?.length ?? 0) > 1 ? `Completamos el formulario leyendo ${prefill.read!.length} documentos${(prefill.kept ?? 0) > prefill.read!.length ? ` (los ${prefill.kept} quedan para subir con la oportunidad)` : ''}.` : `Completamos el formulario con «${prefill.name}».`} Revisa los datos antes de guardar.{prefill.missing?.length ? ` No encontramos ${listEs(prefill.missing)}.` : ''}{prefill.partial ? ((prefill.read?.length ?? 0) > 1 ? ' Algunos documentos son largos: leímos sus partes más importantes.' : ' El documento es largo: leímos su primera parte.') : ''}</p>{prefill.notes?.length ? <p className="text-xs text-muted-foreground">{prefill.notes.join(' ')}</p> : null}</div></div> : null}
            {[['title', 'Nombre de la oportunidad'], ['company', 'Cliente o entidad convocante'], ['url', 'Enlace · opcional']].map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={`op-new-${key}`}>{label}</Label><Input id={`op-new-${key}`} type={key === 'url' ? 'url' : 'text'} required={key !== 'url'} value={draft[key] || ''} onChange={e => field(key, e.target.value)} /></div>)}
            <div className="space-y-2"><Label htmlFor="op-kind">Tipo</Label><select id="op-kind" value={draft.kind || 'private_tender'} onChange={e => field('kind', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="private_tender">Licitación privada</option><option value="proposal">Solicitud de propuesta</option><option value="quote">Solicitud de cotización</option><option value="commercial">Oportunidad comercial</option></select></div>
            <div className="space-y-2"><Label htmlFor="op-invitation">Invitación o contexto recibido</Label><Textarea id="op-invitation" rows={8} className="resize-y leading-6" value={draft.description || ''} onChange={e => field('description', e.target.value)} maxLength={40000} placeholder="Pega aquí el correo o mensaje con la invitación." />
              {/* Pasted, the invitation completes the form like a document does (OPP-49). */}
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Pega también el correo de la invitación: suele decir por qué plataforma se postula (Coupa, Ariba, WEX…) y qué hay que ingresar en ella.</p>
                {String(draft.description || '').trim().length >= 40 ? <Button type="button" size="sm" variant="outline" disabled={prefill.status === 'reading'} onClick={() => void readPasted()}>
                  {prefill.status === 'reading' && prefill.pasted ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}{prefill.status === 'reading' && prefill.pasted ? 'Leyendo…' : 'Completar con la IA'}</Button> : null}</div>
              {prefill.pasted && prefill.status === 'error' ? <p role="alert" className="text-sm text-destructive">{prefill.message}</p> : null}</div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]"><div className="space-y-2"><Label htmlFor="op-new-deadline">Cierre · hora local, opcional</Label><Input id="op-new-deadline" type="datetime-local" aria-describedby="op-new-deadline-hint" value={draft.deadline || ''} onChange={e => field('deadline', e.target.value)} /><p id="op-new-deadline-hint" className="text-xs text-muted-foreground">Sin fecha no entra en los avisos de cierre.</p></div><div className="space-y-2"><Label htmlFor="op-amount">Monto · opcional</Label><Input id="op-amount" type="number" min={0} value={draft.amount || ''} onChange={e => field('amount', e.target.value)} /></div><div className="space-y-2"><Label htmlFor="op-currency">Moneda</Label><select id="op-currency" value={draft.currency || 'CLP'} onChange={e => field('currency', e.target.value)} className="block h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{(CURRENCIES.includes(draft.currency || 'CLP') ? CURRENCIES : [draft.currency, ...CURRENCIES]).map(code => <option key={code} value={code}>{code}</option>)}</select></div></div>
            <div className="space-y-2"><p className="text-sm font-medium" id="op-new-files-label">Bases y anexos</p>
              <label htmlFor="op-new-files" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const dropped = Array.from(e.dataTransfer.files || []); if (dropped.length) void addFiles(dropped); }}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border border-dashed px-4 py-5 text-center transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40">
                <FileUp className="h-5 w-5 text-primary" aria-hidden="true" /><span className="text-sm font-medium">Arrastra aquí las bases y anexos</span><span className="text-xs text-muted-foreground">o haz clic para elegirlos</span>
                <input id="op-new-files" type="file" multiple accept={ACCEPTED_FILES} aria-labelledby="op-new-files-label" className="sr-only" onChange={e => { const chosen = Array.from(e.target.files || []); e.target.value = ''; void addFiles(chosen); }} />
              </label>
              {files.length ? <ul className="flex flex-wrap gap-2" aria-label="Documentos que se subirán">{files.map(file => <li key={file.name} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-xs"><span className="truncate">{file.name}</span><button type="button" className="rounded-full p-1 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Quitar ${file.name}`} onClick={() => setFiles(current => current.filter(item => item !== file))}><X className="h-3 w-3" aria-hidden="true" /></button></li>)}</ul> : null}
              <p className="text-xs text-muted-foreground">PDF, Word, Excel, fotos, el correo (.eml o .msg) o un ZIP, hasta 20 MB cada documento. También puedes subirlos después en Documentos.</p></div>
          </>}
        </>}
        {problem && modal && <p role="alert" className="text-sm text-destructive">{problem}</p>}<div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80"><Button variant="outline" type="button" disabled={busy} onClick={() => void closeModal()}>Cancelar</Button>{modal === 'create' && createMode === 'upload' ? null : <Button type="submit" disabled={busy || prefill.status === 'reading'}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{uploading ? `Subiendo ${Math.min(uploading.done + 1, uploading.total)} de ${uploading.total}…` : modal === 'context' ? 'Confirmar oferta' : modal === 'criteria' ? 'Guardar' : modal === 'assign' ? 'Asignar y notificar' : 'Guardar'}</Button>}</div>
      </form>
    </DialogContent></Dialog>
  </div>;
}
