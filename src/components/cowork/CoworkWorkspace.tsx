'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownRight, PanelLeft, PanelRight, RotateCcw, SquarePen, TriangleAlert } from 'lucide-react';
import type { CoworkExecutionMode } from '@/lib/cowork/execution-policy';
import { COWORK_DRAFT_PHASES, type CoworkRun } from '@/lib/cowork/contracts';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import { coworkMessageAttachments, coworkWithAttachments } from '@/lib/cowork/attachments';
import { coworkWithMentions, type CoworkMention } from '@/lib/cowork/mentions';
import type { CoworkOverview } from '@/lib/cowork/overview';
import {
  coworkCleanTitle, coworkConsultedSources, coworkExpectsContinuation, coworkProposalView, coworkStatusCopy,
  coworkCardStatuses, coworkTurnArtifacts, coworkTurnProgress, groupCoworkThreads, isCoworkActive, type CoworkArtifact,
} from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { CoworkArtifactPanel } from './CoworkArtifactPanel';
import { CoworkComposer, type CoworkComposerHandle } from './CoworkComposer';
import { ResearchProgress } from './ResearchProgress';
import { CoworkQuickActions } from './CoworkQuickActions';
import type { CoworkContactOption } from './ComposerShortcuts';
import { CoworkHome, type CoworkOfferDraft } from './CoworkHome';
import { CoworkSidePanel } from './CoworkSidePanel';
import { CoworkThreadList } from './CoworkThreadList';
import { CoworkExportProvider } from './ExportMenu';
import { CoworkTurn, type CoworkLiveAnswer, type CoworkTurnData } from './CoworkTurn';
import { CoworkAttachments, CoworkUserMessage, useCoworkAttachments, type CoworkAttachment } from './CoworkAttachments';
import { AnimatePresence, CoworkMotion, CwCollapse, cwPanel, cwPop, cwSwap, cwVariants, m } from './motion';
import { CoworkMark, CwButton, CwStatusPill } from './ui';

type ThreadState = CoworkTurnData & {
  ancestors?: CoworkTurnData[];
  olderTurnsOmitted?: boolean;
  canCreateDraft?: boolean;
  canResearch?: boolean;
  budget?: { depth: number; maxDepth: number; exhausted: boolean };
  continuation?: { id: string; status: string } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTINUATION_GRACE_MS = 45000;
const CONTINUE_PROMPT = 'Sigue con el resultado de la acción anterior: dime qué pasó y propón el siguiente paso.';
const DRAFT_KEY = 'cowork:draft';
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The unsent message of this tab, with the contacts it names with «@» (V6). A draft written
 * before the session resolved has no owner yet; one saved by another account is never shown. */
function readDraft(userId: string | null): { text: string; mentions: CoworkMention[] } {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null') as { userId?: string | null; text?: unknown; mentions?: unknown } | null;
    if (typeof saved?.text !== 'string' || (saved.userId && saved.userId !== userId)) return { text: '', mentions: [] };
    const mentions = (Array.isArray(saved.mentions) ? saved.mentions as Array<Partial<CoworkMention> | null> : [])
      .filter((item): item is CoworkMention => typeof item?.id === 'string' && UUID.test(item.id) && typeof item.name === 'string' && Boolean(item.name.trim()))
      .slice(0, 20).map(item => ({ id: item.id, name: item.name }));
    return { text: saved.text, mentions };
  } catch { return { text: '', mentions: [] }; }
}

function writeDraft(userId: string | null, text: string, mentions: CoworkMention[] = []) {
  try {
    // Only the mentions still in the text, so a reload keeps who each one is.
    const named = mentions.filter(mention => text.includes(`@${mention.name}`));
    if (text.trim()) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ userId, text, ...(named.length ? { mentions: named } : {}) }));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* Storage unavailable: the draft only lives in memory. */ }
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

function setWorkUrl(id: string | null, mode: 'push' | 'replace') {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('work', id); else url.searchParams.delete('work');
  if (mode === 'push') window.history.pushState(null, '', url); else window.history.replaceState(null, '', url);
}

function PendingTurn({ text }: { text: string }) {
  return <article className="cw-rise space-y-4" aria-label="Mensaje enviándose">
    <div className="flex justify-end">
      <CoworkUserMessage message={text} />
    </div>
    <div className="flex items-center gap-3">
      <CoworkMark working size={26} className="hidden sm:inline-flex" />
      <p role="status" className="cw-shimmer text-[13.5px]">Enviando…</p>
    </div>
  </article>;
}

/** userId scopes the unsent draft; the page passes it from the server session. */
export function CoworkWorkspace({ userId = null }: { userId?: string | null } = {}) {
  const [runs, setRuns] = useState<CoworkRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<ThreadState | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [ready, setReady] = useState(false);
  const [searchQuota, setSearchQuota] = useState<{ remaining: number; limit: number } | null>(null);
  const [canAutonomous, setCanAutonomous] = useState(false);
  const [mode, setMode] = useState<CoworkExecutionMode>('approval');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [threadVersion, setThreadVersion] = useState(0);
  const [optimistic, setOptimistic] = useState<{ text: string; runId: string | null } | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [awaitingContinuation, setAwaitingContinuation] = useState(false);
  // The worker should resume after an approved action; if it never does, offer the next step instead of a dead end.
  const [continuationMissing, setContinuationMissing] = useState(false);
  const [showJump, setShowJump] = useState(false);
  /** The answer while it is being written, from the stream's `draft` frames (COWORK_STREAMING_ENABLED). */
  const [liveAnswer, setLiveAnswer] = useState<(CoworkLiveAnswer & { runId: string }) | null>(null);
  /** Turns whose answer was seen being written: the final one does not rise in again. */
  const streamedRuns = useRef(new Set<string>());
  /** The summary slides back in once a result it made way for closes; on load it is simply there. */
  const [summaryReturns, setSummaryReturns] = useState(false);

  const isDesktop = useMedia('(min-width: 1024px)');
  const pending = useRef<{ message: string; requestId: string; parentRunId: string | null; mode: CoworkExecutionMode } | null>(null);
  const composer = useRef<CoworkComposerHandle>(null);
  const contactRef = useRef<string | null>(null);
  // Contacts picked with «@» in the composer, sent as references with the next message (V6).
  const mentions = useRef<CoworkMention[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const artifactHeading = useRef<HTMLHeadingElement>(null);
  const artifactOpener = useRef<HTMLElement | null>(null);
  const focusArtifact = useRef(false);
  const wakeState = useRef({ inflight: false, last: 0 });
  const liveRuns = useRef(new Set<string>());
  const autoOpened = useRef(new Set<string>());
  /** A historical turn opened on purpose (an older document version) is not auto-forwarded. */
  const pinnedRun = useRef<string | null>(null);

  const clearPrivateResults = useCallback(() => {
    setRuns([]); setState(null); setReady(false); setArtifactId(null); setOptimistic(null); setQueued(null);
  }, []);
  // A failed download or a lost session is told the same way from every card that can be downloaded.
  const exportHandlers = useMemo(() => ({ onError: setError, onAccessDenied: clearPrivateResults }), [clearPrivateResults]);
  const attach = useCoworkAttachments({ onError: setError, onAccessDenied: clearPrivateResults });
  const clearAttachments = attach.clear;
  /** The files of a queued message, back in the box if the person edits it. */
  const queuedFiles = useRef<CoworkAttachment[]>([]);

  const request = useCallback(async (url: string, options?: RequestInit) => {
    const response = await fetch(url, { ...options, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) clearPrivateResults();
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la solicitud.'), { status: response.status });
    return data;
  }, [clearPrivateResults]);

  /** Your saved contacts for the composer's «@». */
  const searchContacts = useCallback(async (query: string): Promise<CoworkContactOption[]> =>
    (await request(`/api/cowork/contacts?q=${encodeURIComponent(query)}`)).contacts || [], [request]);
  const addMention = useCallback((mention: CoworkMention) => {
    mentions.current = [...mentions.current.filter(item => item.id !== mention.id), mention];
  }, []);
  // The home's figures (V7), read each time the home shows so they reflect the work just done.
  // If they cannot be read, the home goes on without them.
  const [overview, setOverview] = useState<CoworkOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  // «Cuéntame qué vendes» leaves while its message is sent; what was written waits here in case it fails.
  const [offerDraft, setOfferDraft] = useState<CoworkOfferDraft>({ offer: '', website: '' });
  const onHome = !selected && !optimistic;
  useEffect(() => {
    if (!onHome) return;
    let current = true;
    setOverviewLoading(true);
    request('/api/cowork/overview').then(
      data => { if (current) setOverview(data as CoworkOverview); },
      () => { if (current) setOverview(null); },
    ).finally(() => { if (current) setOverviewLoading(false); });
    return () => { current = false; };
  }, [onHome, request]);

  /** Asks the worker to take the next step now instead of waiting for the scheduler. */
  const wake = useCallback((force = false) => {
    const now = Date.now();
    if (wakeState.current.inflight || (!force && now - wakeState.current.last < 8000)) return;
    wakeState.current = { inflight: true, last: now };
    Promise.resolve().then(() => fetch('/api/cowork/wake', { method: 'POST', cache: 'no-store' }))
      .catch(() => undefined)
      .finally(() => { wakeState.current.inflight = false; });
  }, []);

  // Runs list.
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    request('/api/cowork/runs').then(data => {
      if (disposed) return;
      setRuns(Array.isArray(data.runs) ? data.runs : []); setReady(data.canSubmit === true); setError('');
      setSearchQuota(data.searchQuota && typeof data.searchQuota.remaining === 'number' ? data.searchQuota : null);
      setCanAutonomous(data.canAutonomous === true);
      if (!data.canAutonomous) setMode('approval');
    }).catch(problem => { if (!disposed) setError(problem.message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [listVersion, request]);

  // What you are writing survives a reload, or the remount the app does once the
  // session resolves (AuthContext keys its tree by user and workspace), even mid-sentence.
  const draftWatched = useRef(false);
  useEffect(() => {
    const { text: saved, mentions: named } = readDraft(userId);
    if (!saved) return;
    mentions.current = [...mentions.current.filter(item => !named.some(mention => mention.id === item.id)), ...named];
    setMessage(current => !current || saved.startsWith(current) ? saved : current.startsWith(saved) ? current : `${saved}${current}`);
    // The remount drops focus: keep writing where you were, at the end of the text.
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const node = (document.getElementById('cowork-followup') || document.getElementById('cowork-message')) as HTMLTextAreaElement | null;
      node?.focus();
      node?.setSelectionRange(node.value.length, node.value.length);
    });
  }, [userId]);
  useEffect(() => {
    // Mounting never clears a saved draft; later changes (including a send) do.
    if (!draftWatched.current) { draftWatched.current = true; return; }
    writeDraft(userId, message, mentions.current);
  }, [message, userId]);

  // Selected conversation: refresh while work is in flight and follow continuations.
  // While the worker is busy a live stream rings on every change, so the page
  // refreshes right away; polling stays underneath as the fallback.
  useEffect(() => {
    if (!selected) { setAwaitingContinuation(false); setContinuationMissing(false); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const openedAt = Date.now();
    let completionSeenAt: number | null = null;
    let failures = 0;
    let inflight = false;
    let again = false;
    let stream: EventSource | null = null;
    let streamLive = false;
    let streamFailed = false;
    const closeStream = () => { stream?.close(); stream = null; streamLive = false; };
    const openStream = () => {
      if (stream || streamFailed || typeof EventSource === 'undefined') return;
      const source = new EventSource(`/api/cowork/runs/${selected}/stream`);
      stream = source;
      source.onopen = () => { streamLive = true; };
      source.addEventListener('change', () => { void poll(); });
      // Only what changed travels: keep `from` characters of the text so far and add `text`.
      // A held answer carries no text, only its phase: it shows once it is final.
      source.addEventListener('draft', event => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { from?: unknown; text?: unknown; cards?: unknown; reviewing?: unknown; phase?: unknown };
          if (typeof data.from !== 'number' || typeof data.text !== 'string') return;
          const from = data.from;
          const text = data.text;
          if (text || from > 0) streamedRuns.current.add(selected);
          setLiveAnswer(current => ({
            runId: selected,
            text: `${current?.runId === selected ? current.text.slice(0, from) : ''}${text}`,
            cards: Array.isArray(data.cards) ? data.cards as CoworkLiveAnswer['cards'] : [],
            reviewing: data.reviewing === true,
            phase: COWORK_DRAFT_PHASES.find(value => value === data.phase) ?? null,
          }));
        } catch { /* A malformed frame only skips the preview. */ }
      });
      source.addEventListener('end', () => { closeStream(); void poll(); });
      source.onerror = () => {
        streamLive = false;
        // A refused connection is final: keep polling as before.
        if (source.readyState === EventSource.CLOSED) { closeStream(); streamFailed = true; }
      };
    };
    /** Reads the run once and returns when to read it again (null: no need). */
    async function refresh(): Promise<number | null> {
      try {
        const data: ThreadState = await request(`/api/cowork/runs/${selected}`, { signal: controller.signal });
        if (disposed) return null;
        failures = 0;
        setState(data);
        setError('');
        setRuns(previous => previous.some(run => run.id === data.run.id)
          ? previous.map(run => run.id === data.run.id ? { ...run, ...data.run } : run)
          : [data.run, ...previous]);
        const status = data.run.status;
        if (isCoworkActive(status)) liveRuns.current.add(data.run.id);
        if (data.continuation?.id && !isCoworkActive(status) && data.continuation.id !== selected && pinnedRun.current !== selected) {
          // The worker resumed the thread in a new turn: keep reading there.
          liveRuns.current.add(data.continuation.id);
          setWorkUrl(data.continuation.id, 'replace');
          setSelected(data.continuation.id);
          return null;
        }
        let delay: number | null = null;
        if (isCoworkActive(status)) {
          const approvedNotStarted = status === 'waiting_approval'
            && data.events.some(event => event.kind === 'effect.approved' || event.kind === 'search.approved')
            && !data.events.some(event => event.kind === 'effect.started' || event.kind === 'search.started');
          const decisionPending = status === 'waiting_approval' && coworkProposalView(data.run, data.events)?.state === 'pending';
          // Nothing moves while a decision waits on you; otherwise stay close to live.
          if (decisionPending) closeStream(); else openStream();
          delay = decisionPending ? 10000 : status === 'running' && streamLive ? 15000 : Date.now() - openedAt < 60000 ? 2000 : 4000;
          if (status === 'queued' || status === 'waiting_workers' || approvedNotStarted) wake();
          setAwaitingContinuation(false);
          setContinuationMissing(false);
        } else if (coworkExpectsContinuation(data.events) && !data.continuation) {
          closeStream();
          completionSeenAt ??= Date.now();
          // An old completion is not worth waiting for: measure from when it happened.
          const completedAt = Date.parse(data.events.slice().reverse().find(event => event.kind === 'run.completed')?.created_at || '');
          const since = Number.isFinite(completedAt) ? Math.min(completionSeenAt, completedAt) : completionSeenAt;
          const waiting = Date.now() - since < CONTINUATION_GRACE_MS;
          setAwaitingContinuation(waiting);
          setContinuationMissing(!waiting);
          if (waiting) delay = 2000;
        } else {
          closeStream();
          setAwaitingContinuation(false);
          setContinuationMissing(false);
        }
        return delay;
      } catch (problem) {
        if (disposed || controller.signal.aborted) return null;
        const status = (problem as { status?: number }).status;
        setError(problem instanceof Error ? problem.message : 'No se pudo actualizar el trabajo.');
        if (status !== 401 && status !== 403 && status !== 404 && failures < 3) {
          failures += 1;
          return 4000 * failures;
        }
        closeStream();
        return null;
      }
    }
    // One read at a time: a ring during a read asks for one more right after it.
    async function poll() {
      if (disposed) return;
      if (inflight) { again = true; return; }
      inflight = true;
      clearTimeout(timer);
      let delay: number | null = null;
      try { delay = await refresh(); } finally { inflight = false; }
      if (disposed) return;
      if (again) { again = false; void poll(); return; }
      if (delay !== null) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); closeStream(); };
  }, [selected, threadVersion, request, wake]);

  // Restore from the URL and follow browser navigation.
  useEffect(() => {
    const restore = () => {
      const id = new URL(window.location.href).searchParams.get('work');
      setSelected(id && UUID.test(id) ? id : null);
      setState(null); setArtifactId(null); setError(''); setOptimistic(null); setQueued(null); setLiveAnswer(null);
      stickToBottom.current = true;
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const choose = useCallback((id: string | null, options: { pin?: boolean } = {}) => {
    pinnedRun.current = options.pin ? id : null;
    setWorkUrl(id, 'push');
    setState(null); setSelected(id); setArtifactId(null); setMaximized(false); setDrawerOpen(false); setError(''); setLiveAnswer(null);
    // Attached files belong to the message being written in this conversation.
    setOptimistic(null); setQueued(null); setShowFiles(false); clearAttachments();
    stickToBottom.current = true;
    if (!id) requestAnimationFrame(() => composer.current?.focus());
  }, [clearAttachments]);

  // While following a continuation the previous state stays on screen until the new turn loads.
  const turns: CoworkTurnData[] = useMemo(() => state && selected
    ? [...(state.ancestors || []), { run: state.run, events: state.events }] : [], [state, selected]);
  const latest = turns[turns.length - 1] || null;
  const latestIsCurrent = Boolean(latest && latest.run.id === selected);
  const artifacts = useMemo(() => turns.flatMap(turn => coworkTurnArtifacts(turn.run, turn.events)), [turns]);
  // What later turns did with each email or sequence card («Campaña creada · pausada»…).
  const cardStatuses = useMemo(() => coworkCardStatuses(turns), [turns]);
  const openArtifact = artifactId ? artifacts.find(item => item.id === artifactId) || null : null;
  const proposal = latest ? coworkProposalView(latest.run, latest.events) : null;
  const pendingDecision = Boolean(latest && latest.run.status === 'waiting_approval' && proposal?.state === 'pending');
  const active = Boolean(latest && isCoworkActive(latest.run.status));
  const busy = (active && !pendingDecision) || awaitingContinuation;
  const threads = useMemo(() => groupCoworkThreads(runs), [runs]);

  const selectedRoot = useMemo(() => {
    if (!selected) return null;
    const byId = new Map(runs.map(run => [run.id, run]));
    let cursor = byId.get(selected);
    if (!cursor) return turns[0]?.run.id ?? selected;
    const seen = new Set<string>();
    while (cursor.parent_run_id && byId.has(cursor.parent_run_id) && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = byId.get(cursor.parent_run_id) as CoworkRun;
    }
    return cursor.id;
  }, [runs, selected, turns]);
  const title = useMemo(() => {
    const summary = threads.find(thread => thread.rootId === selectedRoot);
    if (summary) return summary.title;
    const first = turns.find(turn => !turn.run.automatic);
    return first ? coworkCleanTitle(first.run.message) : optimistic ? coworkCleanTitle(optimistic.text) : 'Cowork';
  }, [threads, selectedRoot, turns, optimistic]);
  const inConversationTitle = selected || optimistic ? coworkCleanTitle(title, 60) : '';

  const openArtifactPanel = useCallback((artifact: CoworkArtifact, opener?: HTMLElement | null, focus = true) => {
    artifactOpener.current = opener || null;
    focusArtifact.current = focus;
    setArtifactId(artifact.id);
    setDrawerOpen(false);
  }, []);

  const closeArtifact = useCallback(() => {
    setArtifactId(null);
    setMaximized(false);
    setSummaryReturns(true);
    requestAnimationFrame(() => {
      const opener = artifactOpener.current;
      if (opener && opener.isConnected) opener.focus(); else composer.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (openArtifact && focusArtifact.current) {
      focusArtifact.current = false;
      artifactHeading.current?.focus();
    }
  }, [openArtifact]);

  useEffect(() => { if (artifactId && !openArtifact && state) setArtifactId(null); }, [artifactId, openArtifact, state]);

  // Open the main result of a turn that finished while you were watching, as Claude does.
  useEffect(() => {
    if (!latest || !isDesktop || isCoworkActive(latest.run.status) || !liveRuns.current.has(latest.run.id)) return;
    if (autoOpened.current.has(latest.run.id)) return;
    autoOpened.current.add(latest.run.id);
    const produced = coworkTurnArtifacts(latest.run, latest.events);
    const best = produced.find(item => item.kind === 'document')
      || produced.find(item => item.kind === 'block' && item.block.type === 'sequence')
      || produced.find(item => item.kind === 'block' && item.block.type === 'table' && item.block.rows.length >= 6)
      || produced.find(item => item.kind === 'contacts' && item.count >= 3)
      || produced.find(item => item.kind === 'file');
    if (best) openArtifactPanel(best, null, false);
  }, [latest, isDesktop, openArtifactPanel]);

  // Keep the newest content in view unless the reader scrolled up.
  useIsomorphicLayoutEffect(() => {
    const node = scroller.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [turns, optimistic, queued]);

  // Cards that load their details later (approvals, previews) must not push the decision out of view.
  useEffect(() => {
    const content = conversation.current;
    const node = scroller.current;
    if (!content || !node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (stickToBottom.current) node.scrollTop = node.scrollHeight; });
    observer.observe(content);
    return () => observer.disconnect();
  }, [selected, optimistic]);

  function onScroll() {
    const node = scroller.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickToBottom.current = distance < 160;
    setShowJump(distance > 480);
  }

  function jumpToEnd() {
    const node = scroller.current;
    if (!node) return;
    stickToBottom.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }

  // A decision waiting on you, out of view: the floating button says so and takes you to it.
  const [decisionAway, setDecisionAway] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    setDecisionAway(null);
    if (!pendingDecision) return;
    const node = document.getElementById('cowork-decision');
    const root = scroller.current;
    if (!node || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setDecisionAway(null); return; }
      setDecisionAway(entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? 'up' : 'down');
    }, { root, threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [pendingDecision, latest?.run.id]);
  function goToDecision() {
    const node = document.getElementById('cowork-decision');
    if (!node) return;
    stickToBottom.current = false;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    node.focus({ preventScroll: true });
  }

  async function post(text: string, parentRunId: string | null) {
    // A contact picked from a table travels as a reference the model can use,
    // without showing its ID in the composer or in your message bubble. Contacts
    // picked with «@» travel the same way (V6). References go before the files,
    // which stay the message's last lines (attachments.ts).
    const { text: body, files } = coworkMessageAttachments(text);
    const reference = contactRef.current;
    const mentioned = coworkWithMentions(body, mentions.current);
    const referenced = reference && !mentioned.includes(reference) ? `${mentioned}\n\n(ID del contacto: ${reference})` : mentioned;
    const outgoing = files.length ? coworkWithAttachments(referenced, files) : referenced;
    if (pending.current?.message !== outgoing || pending.current?.parentRunId !== parentRunId || pending.current?.mode !== mode) {
      pending.current = { message: outgoing, requestId: crypto.randomUUID(), parentRunId, mode };
    }
    setSending(true); setError('');
    // The bubble shows what is sent: mentions as chips, references out of sight.
    setOptimistic({ text: outgoing, runId: null });
    stickToBottom.current = true;
    try {
      const data = await request('/api/cowork/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      });
      pending.current = null;
      contactRef.current = null;
      // Mentions picked for a message written meanwhile (a queued one went first) still travel with it.
      mentions.current = mentions.current.filter(mention => !outgoing.includes(mention.id));
      setOptimistic({ text: outgoing, runId: data.id });
      liveRuns.current.add(data.id);
      if (parentRunId && selected) {
        setWorkUrl(data.id, 'replace');
        setSelected(data.id);
      } else {
        setWorkUrl(data.id, 'push');
        setState(null);
        setSelected(data.id);
      }
      setListVersion(value => value + 1);
      wake(true);
      return true;
    } catch (problem) {
      setOptimistic(null);
      setError(problem instanceof Error ? problem.message : 'No se pudo guardar la solicitud.');
      return false;
    } finally {
      setSending(false);
    }
  }

  const resolve = useCallback(async (approve: boolean): Promise<boolean> => {
    if (!latest || resolving) return false;
    const view = coworkProposalView(latest.run, latest.events);
    const endpoint = view?.type === 'search' ? 'search-approval' : view?.type === 'effect' ? 'effect-approval' : 'approval';
    setResolving(true);
    try {
      await request(`/api/cowork/runs/${latest.run.id}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }),
      });
      if (approve) { liveRuns.current.add(latest.run.id); wake(true); }
      setThreadVersion(value => value + 1);
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No se pudo resolver la propuesta.');
      return false;
    } finally {
      setResolving(false);
    }
  }, [latest, resolving, request, wake]);

  async function submit() {
    const typed = message.trim();
    const files = attach.files;
    // The attached files travel as the last lines of the message (attachments.ts).
    const text = coworkWithAttachments(typed, files.map(file => file.name));
    if (!text || sending || !ready || attach.uploading) return;
    // The files leave the box with the message, and come back with the text if it could not be saved.
    const send = async (parentRunId: string | null) => {
      setMessage(''); attach.clear(); setShowFiles(false);
      if (await post(text, parentRunId)) return;
      setMessage(typed); attach.restore(files);
    };
    const queue = () => { queuedFiles.current = files; setQueued(text); setMessage(''); attach.clear(); setShowFiles(false); };
    if (!selected) { await send(null); return; }
    if (!latest || !latestIsCurrent) { queue(); return; }
    const status = latest.run.status;
    if (pendingDecision) {
      // Writing instead of deciding means "no, do this instead".
      if (!await resolve(false)) return;
      await send(latest.run.id);
      return;
    }
    if (busy) { queue(); return; }
    await send(status === 'completed' ? latest.run.id : (latest.run.parent_run_id ?? null));
  }

  // Send a message written while the previous step was still running.
  useEffect(() => {
    if (!queued || sending || !latest || !latestIsCurrent || busy || isCoworkActive(latest.run.status)) return;
    const text = queued;
    setQueued(null);
    // A message that could not be saved goes back to the box instead of vanishing.
    void post(text, latest.run.status === 'completed' ? latest.run.id : (latest.run.parent_run_id ?? null))
      .then(sent => { if (!sent) setMessage(current => current.trim() ? current : text); });
    // post is recreated each render; the queue only reacts to state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, sending, latest, latestIsCurrent, busy]);

  useEffect(() => {
    if (optimistic?.runId && turns.some(turn => turn.run.id === optimistic.runId)) setOptimistic(null);
  }, [optimistic, turns]);

  async function sendQueuedNow() {
    if (!queued || !latest || !pendingDecision) return;
    const text = queued;
    if (!await resolve(false)) return;
    setQueued(null);
    if (!await post(text, latest.run.id)) setMessage(current => current.trim() ? current : text);
  }

  function retry() {
    if (!latest) return;
    void post(latest.run.message, latest.run.parent_run_id ?? null);
  }

  // A quick reply is a message you did not have to type: same thread, same rules.
  const canFollowUp = Boolean(ready && !sending && latest && latestIsCurrent && latest.run.status === 'completed' && !optimistic && !queued);
  function followUp(text: string) {
    if (!latest || !canFollowUp) return;
    void post(text, latest.run.id);
  }
  // A version sent from the panel reads in the conversation; on phones the panel covers it.
  const sendFromPanel = canFollowUp ? (text: string) => { followUp(text); if (!isDesktop) closeArtifact(); } : null;
  const panelSendHint = pendingDecision ? 'Primero aprueba o descarta la propuesta pendiente.'
    : !ready ? 'Cowork no está disponible ahora.' : 'Disponible cuando Cowork termine el paso actual.';

  async function cancel() {
    if (!latest || cancelling) return;
    setCancelling(true);
    try {
      await request(`/api/cowork/runs/${latest.run.id}`, { method: 'DELETE' });
      setQueued(null);
      setThreadVersion(value => value + 1);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'No se pudo cancelar.'); }
    finally { setCancelling(false); }
  }

  function askAboutContact(leadId: string) {
    const rows = collectCoworkLeadRows(turns.flatMap(turn => turn.events.filter(event => event.kind === 'tool.completed').map(event => event.payload)));
    const row = rows.find(item => item.id === leadId);
    const who = row?.name ? `${row.name}${row.company ? ` (${row.company})` : ''}` : 'este contacto guardado';
    contactRef.current = leadId;
    setMessage(`Consulta la ficha de ${who} y su investigación disponible. Resume las fuentes y recomendaciones si existen.`);
    requestAnimationFrame(() => composer.current?.focus());
  }

  function applySuggestion(prompt: string) {
    setMessage(prompt);
    requestAnimationFrame(() => {
      composer.current?.focus();
      const node = document.getElementById('cowork-message') as HTMLTextAreaElement | null;
      const start = prompt.indexOf('[');
      const end = prompt.indexOf(']', start);
      if (node && start >= 0 && end > start) node.setSelectionRange(start, end + 1);
    });
  }

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = inConversationTitle ? `${inConversationTitle} · Cowork` : 'Cowork · ANTON.IA';
    return () => { document.title = previous; };
  }, [inConversationTitle]);

  useEffect(() => {
    if (!openArtifact) return;
    // A menu open inside the panel («Descargar») closes first and marks the key as handled: the panel stays.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) closeArtifact(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openArtifact, closeArtifact]);

  const executing = Boolean(latest && latest.run.status === 'waiting_approval' && proposal && (proposal.state === 'approved' || proposal.state === 'running'));
  const status = latest ? coworkStatusCopy(latest.run.status, { executing }) : null;
  const inConversation = Boolean(selected || optimistic);
  const artifactOpen = Boolean(openArtifact);
  const railVisible = !railCollapsed && !artifactOpen;
  const composerPlaceholder = !latest ? 'Escribe tu mensaje…'
    : pendingDecision ? 'Pide un cambio o aprueba la propuesta'
      : busy ? 'Escribe; lo envío al terminar este paso'
        : latest.run.status === 'completed' ? 'Responde o pide el siguiente paso…' : 'Reformula o indica cómo seguir…';
  const quotaNote = searchQuota ? `Búsquedas externas hoy: ${searchQuota.remaining} de ${searchQuota.limit}` : '';
  const queuedView = queued ? coworkMessageAttachments(queued) : null;

  // The clip, the dropped files and their chips work the same on the home box and in a conversation.
  const fileProps = (composerId: string) => ({
    onToggleFiles: () => setShowFiles(value => !value), filesOpen: showFiles,
    hasAttachments: attach.files.length > 0, attaching: attach.uploading,
    onDropFiles: (files: FileList) => { setShowFiles(true); void attach.upload(files); },
    attachments: showFiles || attach.files.length > 0
      ? <CoworkAttachments id={`${composerId}-files`} files={attach.files} uploading={attach.uploading} open={showFiles}
        onUpload={files => void attach.upload(files)} onRemove={attach.remove} />
      : null,
  });
  const homeComposer = <CoworkComposer ref={composer} id="cowork-message" size="large" value={message} onChange={setMessage} onSubmit={() => void submit()}
    placeholder="Describe lo que necesitas. Por ejemplo: «escríbele a mis contactos que aún no contacto»"
    ready={ready} sending={sending} submitLabel="Crear trabajo" canAutonomous={canAutonomous} mode={mode} onModeChange={setMode}
    searchContacts={ready ? searchContacts : null} onMention={addMention} templates
    {...fileProps('cowork-message')} footnote={quotaNote || undefined} />;

  return <CoworkMotion><CoworkExportProvider value={exportHandlers}><section aria-label="Cowork" className="cw-shell relative flex h-[calc(100dvh-5rem)] min-h-[540px] min-w-0 overflow-hidden rounded-[20px] border border-cw-border shadow-[var(--cw-shadow-lg)] md:h-[calc(100dvh-5.5rem)]">
    <div className={cn('hidden w-[256px] shrink-0 border-r border-cw-border bg-cw-rail', railVisible && 'lg:block')}>
      <CoworkThreadList threads={threads} loading={loading} selectedThreadId={selectedRoot} onSelect={choose} onNew={() => choose(null)} onClose={() => setRailCollapsed(true)} />
    </div>
    <AnimatePresence>
      {drawerOpen && <m.div key="drawer" initial="hidden" animate="shown" exit="gone" className="absolute inset-0 z-40 flex">
        <m.div custom={-1} variants={cwPanel} className="w-[86%] max-w-[300px] border-r border-cw-border bg-cw-rail shadow-[var(--cw-shadow-lg)]">
          <CoworkThreadList idPrefix="cowork-drawer" threads={threads} loading={loading} selectedThreadId={selectedRoot} onSelect={choose} onNew={() => choose(null)} onClose={() => setDrawerOpen(false)} />
        </m.div>
        <m.button type="button" variants={cwSwap} aria-label="Cerrar lista de trabajos" className="flex-1 bg-black/25" onClick={() => setDrawerOpen(false)} />
      </m.div>}
    </AnimatePresence>

    <div className={cn('relative flex min-w-0 flex-1 flex-col', artifactOpen && 'hidden lg:flex', artifactOpen && maximized && 'lg:hidden')}>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-cw-border px-2.5 sm:px-3">
        <CwButton variant="ghost" size="icon-sm" className={cn(railVisible && 'lg:hidden')} aria-label="Mostrar trabajos" title="Trabajos"
          onClick={() => { if (isDesktop && !artifactOpen) setRailCollapsed(false); else setDrawerOpen(true); }}>
          <PanelLeft aria-hidden="true" />
        </CwButton>
        <h1 className="min-w-0 flex-1 truncate px-1 text-[14px] font-medium text-cw-text">{inConversation ? title : 'Cowork'}</h1>
        {inConversation && status && <CwStatusPill tone={status.tone} pulse={busy} className="hidden sm:inline-flex">{status.label}</CwStatusPill>}
        {inConversation && !artifactOpen && !panelOpen && <CwButton variant="ghost" size="icon-sm" className="hidden xl:inline-flex" onClick={() => setPanelOpen(true)} aria-label="Mostrar resumen" title="Resumen"><PanelRight aria-hidden="true" /></CwButton>}
        <CwButton variant="ghost" size="sm" onClick={() => choose(null)} className={cn(!inConversation && 'hidden')} title="Nuevo trabajo">
          <SquarePen aria-hidden="true" /><span className="hidden sm:inline">Nuevo trabajo</span>
        </CwButton>
      </header>

      <p className="sr-only" aria-live="polite">{inConversation && status ? status.label : ''}</p>
      <CwCollapse show={Boolean(error)} className="shrink-0">
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-cw-border bg-cw-danger-soft px-4 py-2 text-[13px] text-cw-danger">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{error}</p>
          <CwButton size="xs" variant="secondary" onClick={() => { setError(''); setListVersion(value => value + 1); setThreadVersion(value => value + 1); }}><RotateCcw aria-hidden="true" />Reintentar</CwButton>
        </div>
      </CwCollapse>

      {!inConversation
        ? <CoworkHome composer={homeComposer} threads={threads} ready={ready} loading={loading} onSuggestion={applySuggestion} onOpenThread={choose}
          overview={overview} overviewLoading={overviewLoading} offerDraft={offerDraft} onOfferDraftChange={setOfferDraft}
          onSaveOffer={ready && !sending ? async text => {
            const sent = await post(text, null);
            if (sent) setOfferDraft({ offer: '', website: '' });
            return sent;
          } : null} />
        : <>
          <div ref={scroller} onScroll={onScroll} className="cw-scroll min-h-0 flex-1 overflow-y-auto">
            <div ref={conversation} className="mx-auto w-full max-w-[46rem] space-y-9 px-4 pb-8 pt-7 sm:px-6">
              {state?.olderTurnsOmitted && <p className="text-center text-[12px] text-cw-faint">Se muestran los últimos ocho turnos anteriores.</p>}
              {turns.map((turn, index) => <CoworkTurn key={turn.run.id} turn={turn} latest={index === turns.length - 1}
                resolving={resolving} openArtifactId={artifactId} onOpenArtifact={openArtifactPanel}
                onResolve={approve => void resolve(approve)} onRetry={ready ? retry : null} onSuggestion={canFollowUp ? followUp : null}
                budgetExhausted={Boolean(state?.budget?.exhausted)} live={liveRuns.current.has(turn.run.id)}
                liveAnswer={liveAnswer?.runId === turn.run.id ? liveAnswer : null} streamed={streamedRuns.current.has(turn.run.id)}
                cardStatuses={cardStatuses} />)}
              {continuationMissing && latestIsCurrent && latest?.run.status === 'completed' && !optimistic && !queued && ready && <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[38px]">
                <CwButton size="sm" variant="secondary" disabled={sending}
                  onClick={() => { setContinuationMissing(false); void post(CONTINUE_PROMPT, latest.run.id); }}>
                  <CornerDownRight aria-hidden="true" />Seguir con el resultado
                </CwButton>
                <span className="text-[12.5px] text-cw-muted">o escribe qué quieres hacer ahora.</span>
              </div>}
              {optimistic && !turns.some(turn => turn.run.id === optimistic.runId) && <PendingTurn text={optimistic.text} />}
              {selected && !state && !optimistic && <div role="status" className="flex items-center gap-3 py-6 text-[13.5px] text-cw-muted">
                <CoworkMark working size={24} />Cargando conversación…
              </div>}
            </div>
          </div>
          <AnimatePresence>
            {decisionAway && <m.button key="decision" type="button" onClick={goToDecision} {...cwVariants(cwPop)} style={{ x: '-50%' }}
              className="absolute bottom-[132px] left-1/2 z-10 flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-cw-border bg-cw-elevated px-3 text-[12.5px] font-medium text-cw-text shadow-[var(--cw-shadow)] hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
              <span className="h-1.5 w-1.5 rounded-full bg-cw-warning" aria-hidden="true" />Cowork espera tu decisión
              {decisionAway === 'up' ? <ArrowUp className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" />}
            </m.button>}
            {showJump && !decisionAway && <m.button key="jump" type="button" onClick={jumpToEnd} aria-label="Ir al final" {...cwVariants(cwPop)} style={{ x: '-50%' }}
              className="absolute bottom-[132px] left-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-cw-border bg-cw-elevated text-cw-muted shadow-[var(--cw-shadow)] hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </m.button>}
          </AnimatePresence>
          <div className="shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full max-w-[46rem]">
              {latest && state?.canResearch && <ResearchProgress runId={latest.run.id} onAccessDenied={clearPrivateResults} />}
              {canFollowUp && !message.trim() && attach.files.length === 0 && <CoworkQuickActions id="cowork-quick-actions" onPick={followUp} />}
              <CoworkComposer ref={composer} id="cowork-followup" value={message} onChange={setMessage} onSubmit={() => void submit()}
                placeholder={composerPlaceholder} ready={ready} sending={sending} submitLabel="Enviar mensaje"
                searchContacts={ready ? searchContacts : null} onMention={addMention} templates
                onStop={active && !pendingDecision && latestIsCurrent ? () => void cancel() : null} stopping={cancelling}
                canAutonomous={canAutonomous} mode={mode} onModeChange={setMode}
                {...fileProps('cowork-followup')}
                queued={queued ? {
                  text: queuedView ? queuedView.text || `Archivos: ${queuedView.files.join(', ')}` : queued,
                  note: pendingDecision ? 'Se enviará cuando resuelvas la propuesta' : 'Se enviará cuando termine este paso',
                  onCancel: () => {
                    setMessage(queuedView?.text ?? queued); attach.restore(queuedFiles.current); queuedFiles.current = []; setQueued(null);
                    requestAnimationFrame(() => composer.current?.focus());
                  },
                  onSendNow: pendingDecision ? () => void sendQueuedNow() : null,
                } : null}
                footnote="ANTON.IA puede equivocarse. Revisa cada propuesta antes de aprobarla." />
            </div>
          </div>
        </>}
    </div>

    {/* One panel at a time on the right: the open result or the summary. The result
        slides in over the chat on phones and beside it on desktop; closing slides it out,
        stepping out of the layout at once (popLayout) so the summary can take its place.
        The summary has no exit of its own: it only slides back in after a result closes. */}
    <AnimatePresence initial={false} mode="popLayout">
      {openArtifact && <m.div key="artifact" {...cwVariants(cwPanel)} className={cn('flex min-w-0 flex-col bg-cw-elevated max-lg:absolute max-lg:inset-0 max-lg:z-30 lg:flex-1 lg:max-w-[min(56rem,52%)] lg:border-l lg:border-cw-border', maximized && 'lg:max-w-none')}>
        <CoworkArtifactPanel artifact={openArtifact} events={turns.find(turn => turn.run.id === openArtifact.runId)?.events || []}
          canResearch={Boolean(state?.canResearch) && latest?.run.status === 'completed'} canCreateDraft={Boolean(state?.canCreateDraft) && latest?.run.status === 'completed'}
          maximized={maximized} onToggleMaximize={() => setMaximized(value => !value)} onClose={closeArtifact} headingRef={artifactHeading}
          onError={setError} onAccessDenied={clearPrivateResults} onUseReport={askAboutContact} onSend={sendFromPanel} sendHint={panelSendHint}
          onSelectVersion={id => { if (turns.some(turn => turn.run.id === id)) { const doc = artifacts.find(item => item.runId === id && item.kind === 'document'); if (doc) setArtifactId(doc.id); } else choose(id, { pin: true }); }} />
      </m.div>}
    </AnimatePresence>
    {!openArtifact && inConversation && latest && panelOpen && <m.div key="summary" initial={summaryReturns ? 'hidden' : false} animate="shown" variants={cwPanel}
      className="hidden w-[272px] shrink-0 border-l border-cw-border bg-cw-rail xl:block">
      <CoworkSidePanel steps={coworkTurnProgress(latest.run, latest.events)} turnCount={turns.filter(turn => !turn.run.automatic).length}
        artifacts={artifacts.slice().reverse()} openArtifactId={artifactId} onOpenArtifact={openArtifactPanel}
        sources={coworkConsultedSources(turns.flatMap(turn => turn.events))} mode={latest.run.mode}
        budget={state?.budget || null} searchQuota={searchQuota} onClose={() => setPanelOpen(false)} />
    </m.div>}
  </section></CoworkExportProvider></CoworkMotion>;
}
