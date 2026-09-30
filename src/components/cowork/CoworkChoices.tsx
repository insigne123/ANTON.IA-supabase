'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, PencilLine } from 'lucide-react';
import { COWORK_CHOICE_LIMITS, coworkChoiceMessage, type CoworkChoices } from '@/lib/cowork/contracts';
import { cn } from '@/lib/utils';
import { CW_EASE, CwCollapse, cwFadeRise, cwVariants, m, useReducedMotion } from './motion';
import { CwButton } from './ui';

const OPTION = 'inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-2 text-left text-[13.5px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:cursor-default';
const IDLE = 'border-cw-border bg-cw-elevated text-cw-text shadow-[var(--cw-shadow-sm)] enabled:hover:border-cw-border-strong enabled:hover:bg-cw-panel';
const PICKED = 'border-cw-accent bg-cw-accent-soft font-medium text-cw-accent';
/** Long enough for the page to take the message; short enough to try again if it failed. */
const SEND_LOCK_MS = 1500;

/** The box of an option that can be marked with others; its check draws itself when marked. */
function PickMark({ picked }: { picked: boolean }) {
  const reduce = useReducedMotion();
  return <span aria-hidden="true" className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
    picked ? 'border-cw-accent bg-cw-accent text-cw-on-accent' : 'border-cw-border-strong bg-cw-elevated')}>
    {picked && <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
      <m.path d="M2.6 6.3l2.3 2.3 4.6-4.8" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18, ease: CW_EASE }} />
    </svg>}
  </span>;
}

/**
 * The closing question answered by picking (plan 2, V5), under the question itself. With one answer,
 * a tap sends it, like a quick reply. With several, each tap marks or unmarks an option and «Continuar»
 * sends them as the person would write them («RR. HH. y Retail»). «Otra respuesta» opens a field to
 * write one, alone or next to the marked ones. A send locks it for a moment against a double tap: when it
 * goes through, the options leave with the turn; when it fails, they come back as they were, to try again.
 */
export function CoworkChoicesCard({ choices, live, onSelect }: {
  choices: CoworkChoices; live: boolean; onSelect: (message: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [writing, setWriting] = useState(false);
  const [other, setOther] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const fieldId = useId();
  const otherButton = useRef<HTMLButtonElement>(null);
  const unlock = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (unlock.current) clearTimeout(unlock.current); }, []);
  const answers = [...picked, ...(writing && other.trim() ? [other.trim()] : [])];
  const send = (message: string) => {
    if (!message || sent) return;
    setSent(message);
    unlock.current = setTimeout(() => setSent(null), SEND_LOCK_MS);
    onSelect(message);
  };
  const toggle = (option: string) => setPicked(current => current.includes(option) ? current.filter(item => item !== option) : [...current, option]);
  const submitOther = () => choices.multiple ? send(coworkChoiceMessage(answers)) : send(other.trim());
  return <m.div role="group" aria-label={choices.multiple ? 'Elige una o varias respuestas' : 'Elige una respuesta'}
    {...cwVariants(cwFadeRise, live)} className="space-y-2.5">
    {choices.multiple && <p className="text-[12.5px] text-cw-muted">Elige una o varias.</p>}
    <div className="flex flex-wrap gap-2">
      {choices.options.map(option => {
        const marked = choices.multiple ? picked.includes(option) : sent === option;
        return choices.multiple
          ? <button key={option} type="button" role="checkbox" aria-checked={marked} disabled={Boolean(sent)} onClick={() => toggle(option)}
            className={cn(OPTION, marked ? PICKED : IDLE)}>
            <PickMark picked={marked} /><span className="min-w-0 break-words">{option}</span>
          </button>
          : <button key={option} type="button" disabled={Boolean(sent)} onClick={() => send(option)} aria-pressed={marked}
            className={cn(OPTION, marked ? PICKED : IDLE)}>
            <span className="min-w-0 break-words">{option}</span>
          </button>;
      })}
      <button ref={otherButton} type="button" disabled={Boolean(sent)} aria-expanded={writing} aria-controls={fieldId}
        onClick={() => setWriting(open => !open)}
        className={cn(OPTION, writing ? 'border-cw-border-strong bg-cw-panel text-cw-text' : 'border-transparent text-cw-muted enabled:hover:bg-cw-panel enabled:hover:text-cw-text')}>
        <PencilLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Otra respuesta
      </button>
    </div>
    <CwCollapse show={writing} animateIn={live}>
      <form id={fieldId} className="flex items-center gap-2 pt-0.5" onSubmit={event => { event.preventDefault(); submitOther(); }}>
        <input autoFocus value={other} maxLength={COWORK_CHOICE_LIMITS.other} disabled={Boolean(sent)} aria-label="Otra respuesta" placeholder="Escribe tu respuesta"
          onChange={event => setOther(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setWriting(false);
            otherButton.current?.focus();
          }}
          className="h-9 min-w-0 flex-1 rounded-full border border-cw-border bg-cw-elevated px-3.5 text-[13.5px] text-cw-text placeholder:text-cw-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]" />
        {!choices.multiple && <CwButton type="submit" size="icon-sm" variant="primary" aria-label="Enviar respuesta" disabled={!other.trim() || Boolean(sent)}>
          <ArrowUp aria-hidden="true" />
        </CwButton>}
      </form>
    </CwCollapse>
    {choices.multiple && <div className="flex justify-end">
      <CwButton size="sm" variant="primary" disabled={!answers.length || Boolean(sent)} onClick={() => send(coworkChoiceMessage(answers))}>
        {answers.length > 1 ? `Continuar con ${answers.length}` : 'Continuar'}
      </CwButton>
    </div>}
  </m.div>;
}
