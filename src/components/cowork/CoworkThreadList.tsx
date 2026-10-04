'use client';

import { useMemo, useRef, useState } from 'react';
import { LoaderCircle, MoreHorizontal, PanelLeftClose, Pencil, RotateCcw, Search, SquarePen, Trash2, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  coworkDateBucket, coworkShortTime, coworkStatusCopy, isCoworkActive, type CoworkThreadSummary,
} from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { CwButton, CwStatusDot } from './ui';

const TITLE_MAX = 120;

/**
 * Conversations grouped by recency, like a chat sidebar. With `onRename`/`onDelete` (the server can keep names), each one
 * has a menu: «Renombrar» edits the name in place (Enter saves, Esc cancels) and «Eliminar» hides it, with «Deshacer»
 * in the notice; a conversation that is still working cannot be deleted.
 * When the list could not be read it says so, with «Reintentar», instead of looking empty.
 * `closeStyle` «dismiss» closes with an X, as in a sheet; «collapse» folds the side rail.
 */
export function CoworkThreadList({ threads, loading, error = '', onRetry, selectedThreadId, onSelect, onNew, onClose, onRename, onDelete,
  idPrefix = 'cowork-rail', closeStyle = 'collapse' }: {
  idPrefix?: string;
  threads: CoworkThreadSummary[];
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  closeStyle?: 'collapse' | 'dismiss';
  selectedThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  onRename?: (rootId: string, title: string) => Promise<boolean>;
  onDelete?: (thread: CoworkThreadSummary) => void;
}) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ rootId: string; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const skipBlurSave = useRef(false);
  const term = filter.trim().toLocaleLowerCase('es');
  const groups = useMemo(() => {
    const now = new Date();
    const result: Array<{ label: string; items: CoworkThreadSummary[] }> = [];
    for (const thread of threads) {
      if (term && !thread.title.toLocaleLowerCase('es').includes(term)) continue;
      const label = coworkDateBucket(thread.updatedAt, now);
      const group = result.find(item => item.label === label);
      if (group) group.items.push(thread); else result.push({ label, items: [thread] });
    }
    return result;
  }, [threads, term]);

  const save = async () => {
    if (!editing || !onRename || saving) return;
    const current = threads.find(thread => thread.rootId === editing.rootId);
    const next = editing.draft.replace(/\s+/g, ' ').trim();
    if (current && next === current.title) { setEditing(null); return; }
    setSaving(true);
    const ok = await onRename(editing.rootId, next);
    setSaving(false);
    if (ok) setEditing(null);
  };

  return <nav aria-label="Trabajos recientes" className="flex h-full min-h-0 flex-col">
    <div className="flex items-center gap-1 px-3 pb-2 pt-3">
      <CwButton variant="quiet" className="flex-1 justify-start gap-2.5 px-2.5 text-[14px]" onClick={onNew}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cw-accent text-cw-on-accent"><SquarePen className="!size-3.5" aria-hidden="true" /></span>
        Nuevo trabajo
      </CwButton>
      {closeStyle === 'dismiss'
        ? <CwButton variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar trabajos" title="Cerrar"><X aria-hidden="true" /></CwButton>
        : <CwButton variant="ghost" size="icon-sm" onClick={onClose} aria-label="Ocultar trabajos" title="Ocultar"><PanelLeftClose aria-hidden="true" /></CwButton>}
    </div>
    {threads.length > 6 && <div className="px-3 pb-2">
      <label htmlFor={`${idPrefix}-filter`} className="sr-only">Buscar trabajos</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cw-faint" aria-hidden="true" />
        <input id={`${idPrefix}-filter`} value={filter} onChange={event => setFilter(event.target.value)} placeholder="Buscar trabajos"
          className="h-8 w-full rounded-lg border border-transparent bg-cw-hover pl-8 pr-2 text-[13px] text-cw-text placeholder:text-cw-faint focus-visible:border-cw-border focus-visible:bg-cw-elevated focus-visible:outline-none" />
      </div>
    </div>}
    <div className="cw-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {loading && threads.length === 0 && <p role="status" className="flex items-center gap-2 px-3 py-2 text-[13px] text-cw-muted"><LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />Cargando trabajos…</p>}
      {!loading && error && threads.length === 0 && <div className="space-y-2 px-3 py-2">
        <p className="text-[13px] leading-5 text-cw-text">No pudimos cargar tus trabajos.</p>
        {onRetry && <CwButton size="xs" variant="secondary" onClick={onRetry}><RotateCcw aria-hidden="true" />Reintentar</CwButton>}
      </div>}
      {!loading && !error && threads.length === 0 && <div className="px-3 py-2">
        <p className="text-[13px] font-medium leading-5 text-cw-text">Aún no tienes trabajos</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-cw-muted">Lo que le pidas a Cowork queda aquí para retomarlo.</p>
      </div>}
      {term && threads.length > 0 && groups.length === 0 && <div className="space-y-1.5 px-3 py-2">
        <p className="text-[13px] leading-5 text-cw-muted">Ningún trabajo coincide con «{filter.trim()}».</p>
        <CwButton size="xs" variant="ghost" className="-ml-2" onClick={() => setFilter('')}>Limpiar búsqueda</CwButton>
      </div>}
      {groups.map(group => <div key={group.label} className="mt-3 first:mt-1">
        <h2 className="px-3 pb-1 text-[11.5px] font-medium text-foreground/70">{group.label}</h2>
        <ul className="space-y-px">
          {group.items.map(thread => {
            const status = coworkStatusCopy(thread.status);
            const current = selectedThreadId === thread.rootId;
            const working = isCoworkActive(thread.status);
            const flagged = working || thread.status === 'failed';
            const manageable = Boolean(onRename || onDelete);
            if (editing?.rootId === thread.rootId) {
              return <li key={thread.rootId} className="px-1 py-0.5">
                <label htmlFor={`${idPrefix}-rename`} className="sr-only">Nombre del trabajo</label>
                <input id={`${idPrefix}-rename`} autoFocus value={editing.draft} maxLength={TITLE_MAX} disabled={saving}
                  onChange={event => setEditing({ rootId: thread.rootId, draft: event.target.value })}
                  onFocus={event => event.currentTarget.select()}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); void save(); }
                    if (event.key === 'Escape') { event.preventDefault(); skipBlurSave.current = true; setEditing(null); }
                  }}
                  onBlur={() => { if (skipBlurSave.current) { skipBlurSave.current = false; return; } void save(); }}
                  aria-describedby={`${idPrefix}-rename-help`}
                  className="h-8 w-full rounded-lg border border-cw-border-strong bg-cw-elevated px-2.5 text-[13.5px] text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]" />
                <p id={`${idPrefix}-rename-help`} className="px-1 pt-1 text-[11.5px] text-cw-muted">Enter guarda · Esc cancela · vacío vuelve al primer mensaje</p>
              </li>;
            }
            return <li key={thread.rootId} className="group/thread relative">
              <button type="button" onClick={() => onSelect(thread.id)} aria-current={current ? 'page' : undefined}
                title={thread.title}
                className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-[7px] text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]',
                  manageable && 'pr-9',
                  current ? 'bg-cw-active font-medium text-cw-text' : 'text-cw-text hover:bg-cw-hover')}>
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                {flagged
                  ? <span className={cn('flex shrink-0 items-center gap-1.5 text-[11.5px] text-cw-muted', manageable && 'transition-opacity group-focus-within/thread:opacity-0 group-hover/thread:opacity-0 [@media(hover:none)]:opacity-0')}><CwStatusDot tone={status.tone} pulse={working && thread.status !== 'waiting_approval'} /><span className="sr-only">{status.label}</span></span>
                  : <span className={cn('shrink-0 text-[11.5px] text-foreground/70', manageable && 'transition-opacity group-focus-within/thread:opacity-0 group-hover/thread:opacity-0 [@media(hover:none)]:opacity-0')}>{coworkShortTime(thread.updatedAt)}</span>}
              </button>
              {manageable && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={`Opciones de «${thread.title}»`}
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-cw-muted opacity-0 transition-opacity hover:bg-cw-hover hover:text-cw-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] group-focus-within/thread:opacity-100 group-hover/thread:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48 rounded-xl border-cw-border bg-cw-elevated p-1 text-cw-text shadow-[var(--cw-shadow)]">
                  {onRename && <DropdownMenuItem onSelect={() => setEditing({ rootId: thread.rootId, draft: thread.title })}
                    className="gap-2 rounded-lg px-2.5 py-2 text-[13px] focus:bg-cw-hover focus:text-cw-text">
                    <Pencil className="h-4 w-4 text-cw-muted" aria-hidden="true" />Renombrar
                  </DropdownMenuItem>}
                  {onDelete && <DropdownMenuItem disabled={working} onSelect={() => onDelete(thread)}
                    className="gap-2 rounded-lg px-2.5 py-2 text-[13px] text-cw-danger focus:bg-cw-danger-soft focus:text-cw-danger data-[disabled]:text-cw-muted">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />{working ? 'Eliminar (espera a que termine)' : 'Eliminar'}
                  </DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>}
            </li>;
          })}
        </ul>
      </div>)}
    </div>
  </nav>;
}
