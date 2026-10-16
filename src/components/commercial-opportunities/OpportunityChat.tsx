'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Check, Copy, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownText } from '@/components/ui/markdown-text';
import { cn } from '@/lib/utils';

export type OpportunityChatAnswer = {
  answer?: string;
  citations?: Array<{ chunkId: string; quote: string }>;
  missing?: string[];
  mode?: 'expedient' | 'conversation';
};
export type OpportunityChatMessage = { id: string; question: string; answer: OpportunityChatAnswer | null; created_at?: string };

function AssistantAvatar() {
  return (
    <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <p role="status" className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map(dot => <span key={dot} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce" style={{ animationDelay: `${dot * 150}ms` }} />)}
        </span>
        {label}
      </p>
    </div>
  );
}

function Answer({ answer }: { answer: OpportunityChatAnswer }) {
  const [copied, setCopied] = useState(false);
  const [sources, setSources] = useState(false);
  const citations = answer.citations || [];
  const missing = (answer.missing || []).slice(0, 3);
  const copy = async () => {
    try { await navigator.clipboard.writeText(answer.answer || ''); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-2">
        <MarkdownText text={answer.answer || ''} className="text-sm leading-7 text-foreground" />
        {missing.length ? (
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground/80">Para confirmar</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{missing.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => void copy()}>
            {copied ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
          {citations.length ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" aria-expanded={sources} onClick={() => setSources(open => !open)}>
              <FileText className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {citations.length === 1 ? '1 fuente del expediente' : `${citations.length} fuentes del expediente`}
            </Button>
          ) : null}
        </div>
        {sources && citations.length ? (
          <ul className="space-y-2">
            {citations.map((citation, index) => (
              <li key={`${citation.chunkId}-${index}`}>
                <blockquote className="border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">«{citation.quote}»</blockquote>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * «Preguntar a la IA» as a conversation, the way a chat with Claude reads: the person's messages on the right, the
 * assistant's answers on the left with their sources, a composer that sends with Enter, and suggestions to start.
 */
export function OpportunityChat({ messages, pending, suggestions, documentCount, busy, placeholder, onAsk }: {
  messages: OpportunityChatMessage[];
  /** The question on its way, shown at once while the answer is prepared. */
  pending: string | null;
  suggestions: string[];
  documentCount: number;
  busy: boolean;
  placeholder: string;
  onAsk: (question: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const waiting = Boolean(pending) || messages.some(message => !message.answer?.answer);
  const thread = pending && !messages.some(message => message.question === pending && !message.answer?.answer)
    ? [...messages, { id: 'pending', question: pending, answer: null }] : messages;

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [thread.length, waiting]);
  useEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 192)}px`;
  }, [draft]);

  const send = (text = draft) => {
    const question = text.trim();
    if (question.length < 3 || busy || waiting) return;
    setDraft('');
    onAsk(question);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
  };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col rounded-2xl border border-border/60 bg-card" aria-label="Conversación con la IA sobre esta oportunidad">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <AssistantAvatar />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Asistente del expediente</h2>
          <p className="text-xs text-muted-foreground">
            {documentCount ? `Lee ${documentCount === 1 ? 'el documento' : `los ${documentCount} documentos`} del expediente y te muestra de dónde saca cada dato.` : 'Aún no hay documentos: genera el informe o sube las bases para respuestas con fuentes.'}
          </p>
        </div>
      </header>

      <div className="max-h-[60vh] min-h-[280px] space-y-6 overflow-y-auto px-4 py-5" role="log" aria-live="polite" aria-busy={waiting}>
        {!thread.length ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <p className="text-base font-medium text-foreground">¿En qué te ayudo con esta oportunidad?</p>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {suggestions.map(suggestion => (
                <button key={suggestion} type="button" disabled={busy} onClick={() => send(suggestion)}
                  className="rounded-xl border border-border/60 px-3 py-2.5 text-left text-sm text-foreground/90 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : thread.map(message => (
          <div key={message.id} className="space-y-4">
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground">{message.question}</p>
            </div>
            {message.answer?.answer ? <Answer answer={message.answer} /> : <Typing label={documentCount ? 'Leyendo el expediente…' : 'Pensando…'} />}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="border-t border-border/60 p-3" onSubmit={event => { event.preventDefault(); send(); }}>
        <div className="flex items-end gap-2 rounded-2xl border border-border/80 bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
          <label htmlFor="op-question" className="sr-only">Escribe tu pregunta</label>
          <textarea
            ref={input}
            id="op-question"
            rows={1}
            value={draft}
            maxLength={2000}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="max-h-48 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" className="h-8 w-8 shrink-0 rounded-full" disabled={busy || waiting || draft.trim().length < 3} aria-label="Enviar pregunta">
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Enter para enviar · Shift + Enter para una línea nueva. La IA puede equivocarse: revisa las fuentes.</p>
      </form>
    </section>
  );
}
