'use client';

import type { CoworkStarter } from '@/lib/cowork/starters';
import { cn } from '@/lib/utils';
import { cwPop, cwVariants, m } from './motion';
import { CoworkIcon } from './ui';

/** A saved contact as the «@» list shows it (GET /api/cowork/contacts). */
export type CoworkContactOption = { id: string; name: string; title: string | null; company: string | null; hasEmail: boolean };

export type ComposerShortcutItems =
  | { kind: 'mention'; items: CoworkContactOption[]; loading: boolean; failed: boolean }
  | { kind: 'template'; items: CoworkStarter[] };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join('');

/**
 * The list above the composer while a shortcut is typed (plan 2, V6): saved contacts after «@», templates
 * after «/». Focus stays in the text: the arrows move through the list, Enter or Tab picks, Escape closes;
 * a click picks too. Only a moving pointer changes the active option: a list that opens under a resting
 * one keeps the first, so Enter picks what the arrows show. The text box names this list and its active option (aria-controls and
 * aria-activedescendant), so screen readers follow the arrows.
 */
export function ComposerShortcutList({ id, list, active, onPick, onHover }: {
  id: string; list: ComposerShortcutItems; active: number; onPick: (index: number) => void; onHover: (index: number) => void;
}) {
  const count = list.items.length;
  const empty = list.kind === 'template' ? 'No hay plantillas con ese nombre.'
    : list.loading ? 'Buscando en tus contactos…' : list.failed ? 'No se pudieron buscar tus contactos.' : 'No encontré contactos guardados con ese nombre.';
  return <m.div {...cwVariants(cwPop)} style={{ transformOrigin: 'bottom left' }}
    className="absolute inset-x-2 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-cw-border bg-cw-elevated shadow-[var(--cw-shadow-lg)]">
    <p className="px-3.5 pb-1 pt-2.5 text-[11.5px] font-medium text-cw-muted">{list.kind === 'mention' ? 'Tus contactos guardados' : 'Plantillas'}</p>
    {count > 0
      ? <ul id={id} role="listbox" aria-label={list.kind === 'mention' ? 'Tus contactos guardados' : 'Plantillas'} className="max-h-64 overflow-y-auto px-1.5 pb-1.5">
        {list.kind === 'mention'
          ? list.items.map((contact, index) => <li key={contact.id} id={`${id}-${index}`} role="option" aria-selected={index === active}
            onMouseDown={event => { event.preventDefault(); onPick(index); }} onMouseMove={() => { if (index !== active) onHover(index); }}
            className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5', index === active ? 'bg-cw-accent-soft' : 'hover:bg-cw-hover')}>
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cw-accent-soft text-[11px] font-semibold text-cw-accent">{initials(contact.name) || '·'}</span>
            {/* On the tinted active row the secondary text takes the text color: muted would drop below 4.5:1. */}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-cw-text">{contact.name}</span>
              {(contact.title || contact.company) && <span className={cn('block truncate text-[12px]', index === active ? 'text-cw-text' : 'text-cw-muted')}>{[contact.title, contact.company].filter(Boolean).join(' · ')}</span>}
            </span>
            <span className={cn('shrink-0 text-[11.5px]', index === active ? 'text-cw-text' : 'text-cw-muted')}>{contact.hasEmail ? 'Con correo' : 'Sin correo'}</span>
          </li>)
          : list.items.map((starter, index) => <li key={starter.id} id={`${id}-${index}`} role="option" aria-selected={index === active}
            onMouseDown={event => { event.preventDefault(); onPick(index); }} onMouseMove={() => { if (index !== active) onHover(index); }}
            className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2', index === active ? 'bg-cw-accent-soft' : 'hover:bg-cw-hover')}>
            <CoworkIcon name={starter.icon} className="h-4 w-4 shrink-0 text-cw-accent" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-cw-text">{starter.title}</span>
          </li>)}
      </ul>
      : <p role="status" className="px-3.5 pb-2.5 pt-0.5 text-[13px] text-cw-muted">{empty}</p>}
    <p className="hidden border-t border-cw-border px-3.5 py-1.5 text-[11.5px] text-cw-muted sm:block">↑ ↓ para moverte · Enter para elegir · Esc para cerrar</p>
  </m.div>;
}
