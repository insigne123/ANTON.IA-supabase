'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, CornerDownRight, PanelLeft, PanelRight, RotateCcw, SquarePen, TriangleAlert } from 'lucide-react';
import type { CoworkExecutionMode } from '@/lib/cowork/execution-policy';
import type { CoworkRun } from '@/lib/cowork/contracts';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import {
  coworkCleanTitle, coworkConsultedSources, coworkExpectsContinuation, coworkProposalView, coworkStatusCopy,
  coworkTurnArtifacts, coworkTurnProgress, groupCoworkThreads, isCoworkActive, type CoworkArtifact,
} from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { CoworkArtifactPanel } from './CoworkArtifactPanel';
import { CoworkComposer, type CoworkComposerHandle } from './CoworkComposer';
import { CoworkHome } from './CoworkHome';
import { CoworkSidePanel } from './CoworkSidePanel';
import { CoworkThreadList } from './CoworkThreadList';
import { CoworkTurn, type CoworkTurnData } from './CoworkTurn';
import { FileUpload } from './FileUpload';
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

/** The unsent message of this tab. A draft written before the session resolved
 * has no owner yet; one saved by another account is never shown. */
function readDraft(userId: string | null) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null') as { userId?: string | null; text?: unknown } | null;
    return typeof saved?.text === 'string' && (!saved.userId || saved.userId === userId) ? saved.text : '';
  } catch { return ''; }
}

function writeDraft(userId: string | null, text: string) {
  try {
    if (text.trim()) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ userId, text }));
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
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-br-md bg-cw-user px-4 py-2.5 text-[15px] leading-[1.55] text-cw-text">{text}</p>
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

  const isDesktop = useMedia('(min-width: 1024px)');
  const pending = useRef<{ message: string; requestId: string; parentRunId: string | null; mode: CoworkExecutionMode } | null>(null);
  const composer = useRef<CoworkComposerHandle>(null);
  const contactRef = useRef<string | null>(null);
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

  const request = useCallback(async (url: string, options?: RequestInit) => {
    const response = await fetch(url, { ...options, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) clearPrivateResults();
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la solicitud.'), { status: response.status });
    return data;
  }, [clearPrivateResults]);

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
    const saved = readDraft(userId);
    if (!saved) return;
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
    writeDraft(userId, message);
  }, [message, userId]);

  // Selected conversation: poll while work is in flight and follow continuations.
  useEffect(() => {
    if (!selected) { setAwaitingContinuation(false); setContinuationMissing(false); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const openedAt = Date.now();
    let completionSeenAt: number | null = null;
    let failures = 0;
    async function poll() {
      try {
        const data: ThreadState = await request(`/api/cowork/runs/${selected}`, { signal: controller.signal });
        if (disposed) return;
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
          return;
        }
        let delay: number | null = null;
        if (isCoworkActive(status)) {
          const approvedNotStarted = status === 'waiting_approval'
            && data.events.some(event => event.kind === 'effect.approved' || event.kind === 'search.approved')
            && !data.events.some(event => event.kind === 'effect.started' || event.kind === 'search.started');
          const decisionPending = status === 'waiting_approval' && coworkProposalView(data.run, data.events)?.state === 'pending';
          // Nothing moves while a decision waits on you; otherwise stay close to live.
          delay = decisionPending ? 10000 : Date.now() - openedAt < 60000 ? 2000 : 4000;
          if (status === 'queued' || status === 'waiting_workers' || approvedNotStarted) wake();
          setAwaitingContinuation(false);
          setContinuationMissing(false);
        } else if (coworkExpectsContinuation(data.events) && !data.continuation) {
          completionSeenAt ??= Date.now();
          // An old completion is not worth waiting for: measure from when it happened.
          const completedAt = Date.parse(data.events.slice().reverse().find(event => event.kind === 'run.completed')?.created_at || '');
          const since = Number.isFinite(completedAt) ? Math.min(completionSeenAt, completedAt) : completionSeenAt;
          const waiting = Date.now() - since < CONTINUATION_GRACE_MS;
          setAwaitingContinuation(waiting);
          setContinuationMissing(!waiting);
          if (waiting) delay = 2000;
        } else {
          setAwaitingContinuation(false);
          setContinuationMissing(false);
        }
        if (delay !== null) timer = setTimeout(poll, delay);
      } catch (problem) {
        if (disposed || controller.signal.aborted) return;
        const status = (problem as { status?: number }).status;
        setError(problem instanceof Error ? problem.message : 'No se pudo actualizar el trabajo.');
        if (status !== 401 && status !== 403 && status !== 404 && failures < 3) {
          failures += 1;
          timer = setTimeout(poll, 4000 * failures);
        }
      }
    }
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [selected, threadVersion, request, wake]);

  // Restore from the URL and follow browser navigation.
  useEffect(() => {
    const restore = () => {
      const id = new URL(window.location.href).searchParams.get('work');
      setSelected(id && UUID.test(id) ? id : null);
      setState(null); setArtifactId(null); setError(''); setOptimistic(null); setQueued(null);
      stickToBottom.current = true;
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const choose = useCallback((id: string | null, options: { pin?: boolean } = {}) => {
    pinnedRun.current = options.pin ? id : null;
    setWorkUrl(id, 'push');
    setState(null); setSelected(id); setArtifactId(null); setMaximized(false); setDrawerOpen(false); setError('');
    setOptimistic(null); setQueued(null); setShowFiles(false);
    stickToBottom.current = true;
    if (!id) requestAnimationFrame(() => composer.current?.focus());
  }, []);

  // While following a continuation the previous state stays on screen until the new turn loads.
  const turns: CoworkTurnData[] = useMemo(() => state && selected
    ? [...(state.ancestors || []), { run: state.run, events: state.events }] : [], [state, selected]);
  const latest = turns[turns.length - 1] || null;
  const latestIsCurrent = Boolean(latest && latest.run.id === selected);
  const artifacts = useMemo(() => turns.flatMap(turn => coworkTurnArtifacts(turn.run, turn.events)), [turns]);
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

  async function post(text: string, parentRunId: string | null) {
    // A contact picked from a table travels as a reference the model can use,
    // without showing its ID in the composer or in your message bubble.
    const reference = contactRef.current;
    const outgoing = reference && !text.includes(reference) ? `${text}\n\n(ID del contacto: ${reference})` : text;
    if (pending.current?.message !== outgoing || pending.current?.parentRunId !== parentRunId || pending.current?.mode !== mode) {
      pending.current = { message: outgoing, requestId: crypto.randomUUID(), parentRunId, mode };
    }
    setSending(true); setError('');
    setOptimistic({ text, runId: null });
    stickToBottom.current = true;
    try {
      const data = await request('/api/cowork/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      });
      pending.current = null;
      contactRef.current = null;
      setOptimistic({ text, runId: data.id });
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
    const text = message.trim();
    if (!text || sending || !ready) return;
    if (!selected) {
      setMessage('');
      if (!await post(text, null)) setMessage(text);
      return;
    }
    if (!latest || !latestIsCurrent) { setQueued(text); setMessage(''); return; }
    const status = latest.run.status;
    if (pendingDecision) {
      // Writing instead of deciding means "no, do this instead".
      if (!await resolve(false)) return;
      setMessage('');
      if (!await post(text, latest.run.id)) setMessage(text);
      return;
    }
    if (busy) { setQueued(text); setMessage(''); return; }
    setMessage('');
    if (!await post(text, status === 'completed' ? latest.run.id : (latest.run.parent_run_id ?? null))) setMessage(text);
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
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeArtifact(); };
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

  const homeComposer = <CoworkComposer ref={composer} id="cowork-message" size="large" value={message} onChange={setMessage} onSubmit={() => void submit()}
    placeholder="Describe lo que necesitas. Por ejemplo: «prioriza mis respuestas pendientes de hoy»"
    ready={ready} sending={sending} submitLabel="Crear trabajo" canAutonomous={canAutonomous} mode={mode} onModeChange={setMode}
    footnote={quotaNote || undefined} />;

  return <section aria-label="Cowork" className="cw-shell relative flex h-[calc(100dvh-5rem)] min-h-[540px] min-w-0 overflow-hidden rounded-[20px] border border-cw-border shadow-[var(--cw-shadow-lg)] md:h-[calc(100dvh-5.5rem)]">
    <div className={cn('hidden w-[256px] shrink-0 border-r border-cw-border bg-cw-rail', railVisible && 'lg:block')}>
      <CoworkThreadList threads={threads} loading={loading} selectedThreadId={selectedRoot} onSelect={choose} onNew={() => choose(null)} onClose={() => setRailCollapsed(true)} />
    </div>
    {drawerOpen && <div className="cw-fade absolute inset-0 z-40 flex">
      <div className="w-[86%] max-w-[300px] border-r border-cw-border bg-cw-rail shadow-[var(--cw-shadow-lg)]">
        <CoworkThreadList idPrefix="cowork-drawer" threads={threads} loading={loading} selectedThreadId={selectedRoot} onSelect={choose} onNew={() => choose(null)} onClose={() => setDrawerOpen(false)} />
      </div>
      <button type="button" aria-label="Cerrar lista de trabajos" className="flex-1 bg-black/25" onClick={() => setDrawerOpen(false)} />
    </div>}

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
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-cw-border bg-cw-danger-soft px-4 py-2 text-[13px] text-cw-danger">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">{error}</p>
        <CwButton size="xs" variant="secondary" onClick={() => { setError(''); setListVersion(value => value + 1); setThreadVersion(value => value + 1); }}><RotateCcw aria-hidden="true" />Reintentar</CwButton>
      </div>}

      {!inConversation
        ? <CoworkHome composer={homeComposer} threads={threads} ready={ready} loading={loading} onSuggestion={applySuggestion} onOpenThread={choose} />
        : <>
          <div ref={scroller} onScroll={onScroll} className="cw-scroll min-h-0 flex-1 overflow-y-auto">
            <div ref={conversation} className="mx-auto w-full max-w-[46rem] space-y-9 px-4 pb-8 pt-7 sm:px-6">
              {state?.olderTurnsOmitted && <p className="text-center text-[12px] text-cw-faint">Se muestran los últimos ocho turnos anteriores.</p>}
              {turns.map((turn, index) => <CoworkTurn key={turn.run.id} turn={turn} latest={index === turns.length - 1}
                resolving={resolving} openArtifactId={artifactId} onOpenArtifact={openArtifactPanel}
                onResolve={approve => void resolve(approve)} onRetry={ready ? retry : null} onSuggestion={canFollowUp ? followUp : null}
                budgetExhausted={Boolean(state?.budget?.exhausted)} live={liveRuns.current.has(turn.run.id)} />)}
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
          {showJump && <button type="button" onClick={jumpToEnd} aria-label="Ir al final"
            className="absolute bottom-[132px] left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-cw-border bg-cw-elevated text-cw-muted shadow-[var(--cw-shadow)] hover:text-cw-text">
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>}
          <div className="shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full max-w-[46rem]">
              <CoworkComposer ref={composer} id="cowork-followup" value={message} onChange={setMessage} onSubmit={() => void submit()}
                placeholder={composerPlaceholder} ready={ready} sending={sending} submitLabel="Enviar mensaje"
                onStop={active && !pendingDecision && latestIsCurrent ? () => void cancel() : null} stopping={cancelling}
                canAutonomous={canAutonomous} mode={mode} onModeChange={setMode}
                onToggleFiles={latest && latest.run.status === 'completed' ? () => setShowFiles(value => !value) : null} filesOpen={showFiles}
                attachments={showFiles && latest && latest.run.status === 'completed' ? <FileUpload key={`files-${latest.run.id}`} runId={latest.run.id} onError={setError} onAccessDenied={clearPrivateResults} /> : null}
                queued={queued ? {
                  text: queued,
                  note: pendingDecision ? 'Se enviará cuando resuelvas la propuesta' : 'Se enviará cuando termine este paso',
                  onCancel: () => { setMessage(queued); setQueued(null); requestAnimationFrame(() => composer.current?.focus()); },
                  onSendNow: pendingDecision ? () => void sendQueuedNow() : null,
                } : null}
                footnote="ANTON.IA puede equivocarse. Revisa cada propuesta antes de aprobarla." />
            </div>
          </div>
        </>}
    </div>

    {openArtifact
      ? <div className={cn('flex min-w-0 flex-1 flex-col lg:max-w-[min(56rem,52%)] lg:border-l lg:border-cw-border', maximized && 'lg:max-w-none')}>
        <CoworkArtifactPanel artifact={openArtifact} events={turns.find(turn => turn.run.id === openArtifact.runId)?.events || []}
          canResearch={Boolean(state?.canResearch) && latest?.run.status === 'completed'} canCreateDraft={Boolean(state?.canCreateDraft) && latest?.run.status === 'completed'}
          maximized={maximized} onToggleMaximize={() => setMaximized(value => !value)} onClose={closeArtifact} headingRef={artifactHeading}
          onError={setError} onAccessDenied={clearPrivateResults} onUseReport={askAboutContact}
          onSelectVersion={id => { if (turns.some(turn => turn.run.id === id)) { const doc = artifacts.find(item => item.runId === id && item.kind === 'document'); if (doc) setArtifactId(doc.id); } else choose(id, { pin: true }); }} />
      </div>
      : inConversation && latest && panelOpen && <div className="hidden w-[272px] shrink-0 border-l border-cw-border bg-cw-rail xl:block">
        <CoworkSidePanel steps={coworkTurnProgress(latest.run, latest.events)} turnCount={turns.filter(turn => !turn.run.automatic).length}
          artifacts={artifacts.slice().reverse()} openArtifactId={artifactId} onOpenArtifact={openArtifactPanel}
          sources={coworkConsultedSources(turns.flatMap(turn => turn.events))} mode={latest.run.mode}
          budget={state?.budget || null} searchQuota={searchQuota} onClose={() => setPanelOpen(false)} />
      </div>}
  </section>;
}
