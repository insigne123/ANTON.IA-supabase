'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { HelpAnswer } from '@/lib/help/answer-help-question';
import { cn } from '@/lib/utils';

const MAX = 500;

/** «Pregúntale a la IA»: one question, answered only from the manual, with the sections it comes from. */
export function AskHelp({ sectionId, onNavigate, className }: {
  /** The screen the person asks from. */
  sectionId?: string | null;
  /** Called when a link of the answer is followed (the help panel closes). */
  onNavigate?: () => void;
  className?: string;
}) {
  const id = useId();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'loading' } | { status: 'error'; message: string } | { status: 'done'; answer: HelpAnswer }>({ status: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const loading = state.status === 'loading';

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 3 || loading) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setAsked(text);
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/help/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, sectionId: sectionId || null }),
        signal: current.signal,
      });
      const data = await response.json().catch(() => null);
      if (current.signal.aborted) return;
      if (!response.ok || !data) {
        setState({ status: 'error', message: data?.error || 'No pudimos responder ahora. Busca en el Centro de ayuda.' });
        return;
      }
      setState({ status: 'done', answer: data as HelpAnswer });
      setQuestion('');
    } catch {
      if (!current.signal.aborted) setState({ status: 'error', message: 'No pudimos responder ahora. Revisa tu conexión y vuelve a intentarlo.' });
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-3.5" aria-hidden />
        </span>
        <h3 id={`${id}-title`} className="text-sm font-semibold">Pregúntale a la IA</h3>
      </div>
      <form onSubmit={ask} className="space-y-2">
        <Label htmlFor={`${id}-question`} className="sr-only">Tu pregunta</Label>
        <Textarea
          id={`${id}-question`}
          value={question}
          maxLength={MAX}
          rows={3}
          placeholder="Ej.: ¿Por qué un contacto pasó de «Por completar» a «Por escribir»?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className="resize-none text-sm"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Responde con lo que dice el manual. {question.length > MAX - 80 ? `${MAX - question.length} caracteres disponibles.` : ''}</p>
          <Button type="submit" size="sm" disabled={loading || question.trim().length < 3}>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {loading ? 'Buscando…' : 'Preguntar'}
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="space-y-2">
        {state.status === 'error' && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{state.message}</p>
        )}
        {state.status === 'done' && (
          <div className="space-y-2 rounded-xl border bg-muted/40 p-3 text-sm">
            <p className="text-xs text-muted-foreground">Tu pregunta: <span className="text-foreground">{asked}</span></p>
            {state.answer.source === 'ai' ? (
              <>
                <p className="whitespace-pre-line leading-relaxed">{state.answer.answer}</p>
                {state.answer.sections.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Leer más:</span>
                    {state.answer.sections.map((section) => (
                      <Link key={section.id} href={section.href} onClick={onNavigate}
                        className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {section.title}
                      </Link>
                    ))}
                  </div>
                )}
              </>
            ) : state.answer.matches.length > 0 ? (
              <>
                <p className="text-muted-foreground">La IA no está disponible ahora. Esto es lo que dice el manual:</p>
                <ul className="space-y-2">
                  {state.answer.matches.map((match) => (
                    <li key={`${match.section.id}:${match.q}`}>
                      {match.q && <p className="font-medium">{match.q}</p>}
                      <p className="leading-relaxed">{match.a}</p>
                      <Link href={match.section.href} onClick={onNavigate}
                        className="rounded text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {match.section.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>No encontramos esto en el manual. Prueba con otras palabras o pregúntale al administrador de tu organización.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
