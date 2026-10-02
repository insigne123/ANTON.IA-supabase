'use client';

import { ArrowRight } from 'lucide-react';
import { COWORK_GUIDE } from '@/lib/cowork/capabilities-guide';
import { helpSectionHref } from '@/lib/help/manual';
import { CoworkIcon } from './ui';

/**
 * «¿Qué puedes hacer?»: everything Cowork does, group by group, with examples that start a conversation at a tap
 * («Probar») and a link to the help center. The same content the model reads when asked with other words.
 */
export function CoworkGuide({ onTry, disabled = false }: { onTry: (message: string) => void; disabled?: boolean }) {
  return <section aria-labelledby="cw-guide-title" className="space-y-3">
    <div>
      <h2 id="cw-guide-title" className="text-[15px] font-semibold tracking-tight text-cw-text">Lo que puedo hacer por ti</h2>
      <p className="mt-1 text-[13px] leading-5 text-cw-muted">Toca un ejemplo para probarlo. Antes de enviar, gastar créditos o cambiar algo te pido aprobación.</p>
    </div>
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {COWORK_GUIDE.map(group => <li key={group.id} className="flex flex-col rounded-2xl border border-cw-border bg-cw-elevated p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cw-accent-soft text-cw-accent">
            <CoworkIcon name={group.icon} className="h-4 w-4" />
          </span>
          <h3 className="text-[14px] font-semibold text-cw-text">{group.title}</h3>
        </div>
        <p className="mt-2 flex-1 text-[13px] leading-5 text-cw-muted">{group.summary}</p>
        <div className="mt-3 flex flex-col gap-1.5">
          {group.examples.map(example => <button key={example.label} type="button" disabled={disabled} onClick={() => onTry(example.message)}
            aria-label={`Probar: ${example.label}`}
            className="group flex items-center justify-between gap-2 rounded-xl border border-cw-border bg-cw-panel px-3 py-2 text-left text-[13px] text-cw-text transition-colors hover:border-cw-border-strong hover:bg-cw-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:cursor-not-allowed disabled:opacity-60">
            <span className="min-w-0"><span className="text-cw-muted">Probar: </span>{example.label}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-cw-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>)}
        </div>
        <a href={helpSectionHref(group.helpSection)} className="mt-3 self-start rounded text-[12.5px] text-cw-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
          Ver en Ayuda
        </a>
      </li>)}
    </ul>
  </section>;
}
