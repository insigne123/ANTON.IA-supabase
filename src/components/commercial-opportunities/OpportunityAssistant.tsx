'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, ArrowUp, Check, Copy, MessageSquare, MessagesSquare, PanelLeft, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownText } from '@/components/ui/markdown-text';
import { cn } from '@/lib/utils';
import { ASSISTANT_KINDS, ASSISTANT_SUGGESTIONS, type AssistantMessage, type AssistantThread, type SavedAssistantAnswer } from '@/lib/commercial-opportunities/assistant';
import { humanDate } from '@/lib/commercial-opportunities/report-view';

export type AssistantSidebarData = { available: boolean; threads: AssistantThread[]; opportunities: Array<{ id: string; title: string; updated_at: string }> };
const ACTIVE = ['queued', 'running', 'waiting'];
async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }
const post = (body: unknown) => fetch('/api/commercial-opportunities/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function AssistantAvatar() {
  return (
    <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

function Typing() {
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <p role="status" className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map(dot => <span key={dot} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce" style={{ animationDelay: `${dot * 150}ms` }} />)}
        </span>
        Revisando tus oportunidades…
      </p>
    </div>
  );
}

function Answer({ answer, last, busy, onOpen, onHandoff, onAsk }: { answer: SavedAssistantAnswer; last: boolean; busy: boolean;
  onOpen: (id: string) => void; onHandoff: (id: string, question: string) => void; onAsk: (question: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(answer.answer); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-3">
        <MarkdownText text={answer.answer} className="text-sm leading-7 text-foreground" />
        {answer.cards.length ? (
          <ul className="space-y-2" aria-label="Oportunidades de esta respuesta">
            {answer.cards.map(card => {
              const closes = humanDate(card.deadline, true);
              return (
                <li key={card.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-5 text-foreground">{card.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{[capital(ASSISTANT_KINDS[card.kind] || card.kind), card.buyer, closes ? `cierra el ${closes}` : null].filter(Boolean).join(' · ')}</p>
                    {card.note ? <p className="mt-1 text-xs leading-5 text-foreground/80">{card.note}</p> : null}
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onOpen(card.id)} aria-label={`Abrir ${card.title}`}>Abrir</Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {answer.handoff ? (
          <div className="rounded-xl bg-primary/5 px-3 py-3">
            <p className="text-sm text-foreground">Esto lo responde mejor la conversación de <span className="font-medium">{answer.handoff.title}</span>, que lee sus bases.</p>
            <Button type="button" size="sm" className="mt-2" onClick={() => onHandoff(answer.handoff!.id, answer.handoff!.question)}>
              Seguir en la conversación de esta licitación<ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => void copy()}>
            {copied ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        {last && answer.followups.length ? (
          <div className="flex flex-wrap gap-2" aria-label="Preguntas para seguir">
            {answer.followups.map(followup => (
              <button key={followup} type="button" disabled={busy} onClick={() => onAsk(followup)}
                className="rounded-full border border-border/70 px-3 py-1 text-xs text-foreground/90 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                {followup}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The list on the side, as in a chat app: a new conversation, the person's conversations, and the chats by opportunity. */
export function AssistantSidebar({ data, threadId, onNew, onPick, onDelete, onOpportunity }: { data: AssistantSidebarData | null; threadId: string | null;
  onNew: () => void; onPick: (id: string) => void; onDelete: (id: string) => void; onOpportunity: (id: string) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const row = 'flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <nav aria-label="Conversaciones del asistente" className="flex min-h-0 flex-col gap-4">
      <Button type="button" variant="outline" className="justify-start" onClick={onNew}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Nueva conversación</Button>
      <div className="min-h-0 space-y-4 overflow-y-auto">
        <section aria-labelledby="assistant-threads" className="space-y-1">
          <h3 id="assistant-threads" className="px-2.5 text-xs font-medium text-muted-foreground">Conversaciones</h3>
          {!data ? <p className="px-2.5 py-2 text-xs text-muted-foreground">Cargando…</p>
            : !data.threads.length ? <p className="px-2.5 py-2 text-xs text-muted-foreground">Tus conversaciones aparecerán aquí.</p>
            : <ul className="space-y-0.5">{data.threads.map(thread => (
              <li key={thread.id} className="group relative">
                {confirming === thread.id ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
                    <span>¿Borrar esta conversación?</span>
                    <span className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirming(null)}>No</Button>
                      <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => { setConfirming(null); onDelete(thread.id); }}>Borrar</Button>
                    </span>
                  </div>
                ) : <>
                  <button type="button" aria-current={thread.id === threadId ? 'true' : undefined} onClick={() => onPick(thread.id)}
                    className={cn(row, 'pr-9', thread.id === threadId ? 'bg-muted font-medium text-foreground' : 'text-foreground/85 hover:bg-muted/60')}>
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{thread.title}</span>
                  </button>
                  <button type="button" aria-label={`Borrar «${thread.title}»`} onClick={() => setConfirming(thread.id)}
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>}
              </li>
            ))}</ul>}
        </section>
        {data?.opportunities.length ? (
          <section aria-labelledby="assistant-opportunities" className="space-y-1">
            <h3 id="assistant-opportunities" className="px-2.5 text-xs font-medium text-muted-foreground">Por licitación</h3>
            <ul className="space-y-0.5">{data.opportunities.map(item => (
              <li key={item.id}>
                <button type="button" onClick={() => onOpportunity(item.id)} className={cn(row, 'text-foreground/85 hover:bg-muted/60')}>
                  <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{item.title}</span>
                </button>
              </li>
            ))}</ul>
          </section>
        ) : null}
      </div>
    </nav>
  );
}

/** One conversation: the person's messages on the right, the answers on the left with the opportunities they name. */
export function AssistantConversation({ admin, title, messages, pending, busy, onAsk, onRetry, onOpen, onHandoff }: {
  admin: boolean; title: string; messages: AssistantMessage[]; pending: string | null; busy: boolean;
  onAsk: (question: string) => void; onRetry: (question: string) => void; onOpen: (id: string) => void; onHandoff: (id: string, question: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const waiting = Boolean(pending) || messages.some(message => !message.answer && (!message.job || ACTIVE.includes(message.job.state)));
  const thread: AssistantMessage[] = pending && !messages.some(message => message.question === pending && !message.answer)
    ? [...messages, { id: 'pending', question: pending, answer: null, created_at: '' }] : messages;
  const suggestions = admin ? ASSISTANT_SUGGESTIONS.admin : ASSISTANT_SUGGESTIONS.member;

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [thread.length, waiting]);
  useEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 192)}px`;
  }, [draft]);

  const send = (text = draft) => {
    const question = text.trim();
    if (question.length < 2 || busy || waiting) return;
    setDraft('');
    onAsk(question);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Conversación con el asistente de Oportunidades">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <AssistantAvatar />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">Responde con las oportunidades que puedes ver{admin ? ' y la demanda futura' : ''}. Para las bases de una licitación, te lleva a su conversación.</p>
        </div>
      </header>

      <div className="min-h-[320px] flex-1 space-y-6 overflow-y-auto px-4 py-5" role="log" aria-live="polite" aria-busy={waiting}>
        {!thread.length ? (
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 py-8 text-center">
            <p className="text-base font-medium text-foreground">¿En qué te ayudo con tus oportunidades?</p>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {suggestions.map(suggestion => (
                <button key={suggestion} type="button" disabled={busy} onClick={() => send(suggestion)}
                  className="rounded-xl border border-border/60 px-3 py-2.5 text-left text-sm text-foreground/90 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : thread.map((message, index) => (
          <div key={message.id} className="mx-auto max-w-3xl space-y-4">
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground">{message.question}</p>
            </div>
            {message.answer ? <Answer answer={message.answer} last={index === thread.length - 1} busy={busy || waiting} onOpen={onOpen} onHandoff={onHandoff} onAsk={send} />
              : message.job && !ACTIVE.includes(message.job.state) ? (
                <div className="flex items-start gap-3">
                  <AssistantAvatar />
                  <div className="space-y-2 pt-1 text-sm">
                    <p className="text-muted-foreground">{message.job.error || 'No pude responder esta vez.'}</p>
                    {index === thread.length - 1 ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRetry(message.question)}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Intentar de nuevo</Button> : null}
                  </div>
                </div>
              ) : <Typing />}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="border-t border-border/60 p-3" onSubmit={event => { event.preventDefault(); send(); }}>
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border/80 bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
          <label htmlFor="assistant-question" className="sr-only">Escribe tu pregunta</label>
          <textarea
            ref={input}
            id="assistant-question"
            rows={1}
            value={draft}
            maxLength={2000}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Pregunta por tus licitaciones, cierres o lo que viene"
            className="max-h-48 min-h-[24px] flex-1 resize-none border-0 bg-transparent py-1 text-sm leading-6 shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          />
          <Button type="submit" size="icon" className="h-8 w-8 shrink-0 rounded-full" disabled={busy || waiting || draft.trim().length < 2} aria-label="Enviar pregunta">
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[11px] text-muted-foreground">Enter para enviar · Shift + Enter para una línea nueva. La IA puede equivocarse: abre la oportunidad para confirmar.</p>
      </form>
    </section>
  );
}

/**
 * «Asistente»: the section's general conversation, organized like a chat app. `threadId` lives in the page, so going into
 * an opportunity and back returns to the same conversation.
 */
export function OpportunityAssistant({ admin, threadId, onThread, onOpen, onHandoff }: {
  admin: boolean; threadId: string | null; onThread: (id: string | null) => void;
  onOpen: (id: string) => void; onHandoff: (id: string, question: string | null) => void;
}) {
  const [sidebar, setSidebar] = useState<AssistantSidebarData | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [showList, setShowList] = useState(false);
  const current = useRef(threadId); current.current = threadId;
  // A conversation the first question just created is already on screen: opening it must not blank it.
  const created = useRef<string | null>(null);

  const loadSidebar = useCallback(async () => {
    try { setSidebar(await json(await fetch('/api/commercial-opportunities/assistant', { cache: 'no-store' }))); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudieron cargar tus conversaciones.'); }
  }, []);
  const loadThread = useCallback(async (id: string) => {
    try {
      const value = await json(await fetch(`/api/commercial-opportunities/assistant/${id}`, { cache: 'no-store' }));
      if (current.current === id) setMessages(value.messages || []);
    } catch (e) {
      if (current.current !== id) return;
      // A deleted conversation (another tab) leaves the view instead of showing an error forever.
      setMessages([]); onThread(null); setProblem(e instanceof Error ? e.message : 'No se pudo abrir la conversación.');
    }
  }, [onThread]);
  useEffect(() => { void loadSidebar(); }, [loadSidebar]);
  useEffect(() => {
    if (threadId && created.current === threadId) { created.current = null; return; }
    setMessages([]); if (threadId) void loadThread(threadId);
  }, [threadId, loadThread]);
  // An answer a worker is still preparing arrives by reading the conversation again every few seconds.
  const waitingAnswer = messages.some(message => !message.answer && (!message.job || ACTIVE.includes(message.job.state)));
  useEffect(() => {
    if (!threadId || !waitingAnswer || pending) return;
    const timer = setInterval(() => { if (!document.hidden) void loadThread(threadId); }, 4000);
    return () => clearInterval(timer);
  }, [threadId, waitingAnswer, pending, loadThread]);

  const ask = async (question: string) => {
    setBusy(true); setProblem(''); setPending(question);
    try {
      const result = await post({ action: 'ask', question, requestId: crypto.randomUUID(), threadId: threadId ?? null });
      current.current = result.threadId;
      if (result.threadId !== threadId) { created.current = result.threadId; onThread(result.threadId); }
      // The conversation and the side list together, so the new conversation's name shows with its first answer.
      await Promise.all([loadThread(result.threadId), loadSidebar()]);
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo enviar tu pregunta.'); }
    finally { setPending(null); setBusy(false); }
  };
  const remove = async (id: string) => {
    setProblem('');
    try {
      await post({ action: 'delete', threadId: id });
      if (id === threadId) onThread(null);
      await loadSidebar();
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo borrar la conversación.'); }
  };
  const title = sidebar?.threads.find(thread => thread.id === threadId)?.title || 'Nueva conversación';
  const pick = (id: string | null) => { setProblem(''); setShowList(false); onThread(id); };

  if (sidebar && !sidebar.available) {
    return <section className="rounded-2xl border p-8"><h2 className="font-semibold">El asistente se está preparando</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">Mientras tanto, abre una oportunidad y usa «Preguntar a la IA» para conversar sobre ella.</p></section>;
  }
  return (
    <div className="space-y-3">
      {problem && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">{problem}</p>}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card md:h-[min(78vh,860px)] md:flex-row">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 md:hidden">
          <Button type="button" variant="ghost" size="sm" aria-expanded={showList} aria-controls="assistant-list" onClick={() => setShowList(open => !open)}>
            <PanelLeft className="mr-2 h-4 w-4" aria-hidden="true" />Conversaciones
          </Button>
          {threadId ? <Button type="button" variant="ghost" size="sm" onClick={() => pick(null)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva</Button> : null}
        </div>
        <div id="assistant-list" className={cn('border-border/60 p-3 md:flex md:w-64 md:shrink-0 md:flex-col md:border-r', showList ? 'block border-b' : 'hidden')}>
          <AssistantSidebar data={sidebar} threadId={threadId} onNew={() => pick(null)} onPick={pick} onDelete={id => void remove(id)}
            onOpportunity={id => { setShowList(false); onHandoff(id, null); }} />
        </div>
        <AssistantConversation admin={admin} title={title} messages={messages} pending={pending} busy={busy}
          onAsk={question => void ask(question)} onRetry={question => void ask(question)} onOpen={onOpen} onHandoff={onHandoff} />
      </div>
    </div>
  );
}
