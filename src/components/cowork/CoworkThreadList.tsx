'use client';

import { useMemo, useState } from 'react';
import { LoaderCircle, PanelLeftClose, Search, SquarePen } from 'lucide-react';
import {
  coworkDateBucket, coworkShortTime, coworkStatusCopy, isCoworkActive, type CoworkThreadSummary,
} from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { CwButton, CwStatusDot } from './ui';

/** Conversations grouped by recency, like a chat sidebar. */
export function CoworkThreadList({ threads, loading, selectedThreadId, onSelect, onNew, onClose, idPrefix = 'cowork-rail' }: {
  idPrefix?: string;
  threads: CoworkThreadSummary[];
  loading: boolean;
  selectedThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
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

  return <nav aria-label="Trabajos recientes" className="flex h-full min-h-0 flex-col">
    <div className="flex items-center gap-1 px-3 pb-2 pt-3">
      <CwButton variant="quiet" className="flex-1 justify-start gap-2.5 px-2.5 text-[14px]" onClick={onNew}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cw-accent text-cw-on-accent"><SquarePen className="!size-3.5" aria-hidden="true" /></span>
        Nuevo trabajo
      </CwButton>
      <CwButton variant="ghost" size="icon-sm" onClick={onClose} aria-label="Ocultar trabajos" title="Ocultar"><PanelLeftClose aria-hidden="true" /></CwButton>
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
      {!loading && threads.length === 0 && <p className="px-3 py-2 text-[13px] leading-5 text-cw-muted">Tus trabajos aparecerán aquí.</p>}
      {groups.map(group => <div key={group.label} className="mt-3 first:mt-1">
        <h2 className="px-3 pb-1 text-[11.5px] font-medium text-cw-faint">{group.label}</h2>
        <ul className="space-y-px">
          {group.items.map(thread => {
            const status = coworkStatusCopy(thread.status);
            const current = selectedThreadId === thread.rootId;
            const flagged = isCoworkActive(thread.status) || thread.status === 'failed';
            return <li key={thread.rootId}>
              <button type="button" onClick={() => onSelect(thread.id)} aria-current={current ? 'page' : undefined}
                title={thread.title}
                className={cn('group flex w-full items-center gap-2 rounded-lg px-3 py-[7px] text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]',
                  current ? 'bg-cw-active font-medium text-cw-text' : 'text-cw-text hover:bg-cw-hover')}>
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                {flagged
                  ? <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-cw-muted"><CwStatusDot tone={status.tone} pulse={isCoworkActive(thread.status) && thread.status !== 'waiting_approval'} /><span className="sr-only">{status.label}</span></span>
                  : <span className="shrink-0 text-[11.5px] text-cw-faint">{coworkShortTime(thread.updatedAt)}</span>}
              </button>
            </li>;
          })}
        </ul>
      </div>)}
    </div>
  </nav>;
}
