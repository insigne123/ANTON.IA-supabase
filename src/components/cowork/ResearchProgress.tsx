'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { displayLeadName } from '@/lib/lead-name';
import { coworkResearchFinished, coworkResearchStatusText } from '@/lib/cowork/research-notice';
import { cn } from '@/lib/utils';

type Item = { leadId: string; name: string | null; company: string | null; status: string };
type Progress = { items: Item[]; label: string; active: boolean };

/**
 * The research this conversation started, while it runs: «Investigando 2 · 1 lista», and each person on demand. When it
 * finishes, Cowork tells the conversation by itself (research-notice.ts), so the card only promises that and goes away.
 */
export function ResearchProgress({ runId, onAccessDenied }: { runId: string; onAccessDenied: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch(`/api/cowork/runs/${runId}/research-progress`, { cache: 'no-store', signal: controller.signal });
        if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
        // A convenience: when it cannot read, it simply stays hidden.
        if (!response.ok) return;
        const data = await response.json() as Progress;
        if (controller.signal.aborted) return;
        setProgress(data);
        if (data.active) timer = setTimeout(poll, 8000);
      } catch {
        // Hidden as well.
      }
    }
    setProgress(null);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
    // The parent handler is not a polling dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
  if (!progress?.active) return null;
  return <section aria-label="Investigaciones en curso" className="mb-2 rounded-xl border border-cw-border bg-cw-elevated px-3 py-2 text-[12.5px]">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}
      className="flex w-full items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
      <LoaderCircle className="h-3.5 w-3.5 shrink-0 text-cw-accent motion-safe:animate-spin" aria-hidden="true" />
      <span role="status" className="shrink-0 font-medium text-cw-text">{progress.label}</span>
      <span className="min-w-0 flex-1 truncate text-cw-muted">· Te aviso aquí cuando terminen</span>
      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-cw-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
      <span className="sr-only">{open ? 'Ocultar personas' : 'Ver personas'}</span>
    </button>
    {open && <ul className="mt-2 space-y-1 border-t border-cw-border pt-2">
      {progress.items.map(item => <li key={item.leadId} className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate">{displayLeadName(item.name || 'Contacto sin nombre').text}
          {item.company && <span className="text-cw-muted"> · {item.company}</span>}</span>
        <span className={cn('shrink-0', coworkResearchFinished(item.status) ? 'text-cw-success' : 'text-cw-muted')}>{coworkResearchStatusText(item.status)}</span>
      </li>)}
    </ul>}
  </section>;
}
