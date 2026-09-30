'use client';

import { COWORK_QUICK_ACTIONS } from '@/lib/cowork/starters';
import { CoworkIcon } from './ui';

/** Four short actions above the composer while a conversation is open: one tap sends them. They show only when a message can
 * go out now (the workspace passes null otherwise) and the box is empty, so they never compete with what is being typed.
 * On phones the row scrolls sideways instead of wrapping into a wall of buttons. */
export function CoworkQuickActions({ onPick, id }: { onPick: (prompt: string) => void; id: string }) {
  return <nav aria-label="Acciones rápidas" id={id} className="cw-scroll -mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
    {COWORK_QUICK_ACTIONS.map(item => <button key={item.id} type="button" onClick={() => onPick(item.prompt)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cw-border bg-cw-elevated px-3 py-1.5 text-[13px] text-cw-text transition-colors hover:border-cw-border-strong hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
      <CoworkIcon name={item.icon} className="h-3.5 w-3.5 text-cw-accent" />{item.title}
    </button>)}
  </nav>;
}
