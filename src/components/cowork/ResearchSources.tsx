import type { CoworkEvent } from '@/lib/cowork/contracts';
import { z } from 'zod';
import { ExternalLink } from 'lucide-react';
import { ResearchDraft } from './ResearchDraft';

const sourceSchema = z.object({ id: z.string(), url: z.string().url().refine(url => /^https?:\/\//i.test(url)), title: z.string().optional(), retrievedAt: z.string() });
const observationSchema = z.object({
  action: z.literal('research.get_existing'),
  result: z.object({
    availability: z.literal('available'),
    research: z.object({ snapshotId: z.string().uuid().optional(), capturedAt: z.string(), status: z.string(), truncated: z.boolean(), sources: z.array(sourceSchema).max(100) }),
  }),
});

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Sources of saved research reports observed in a run. `sequence` narrows to one report. */
export function ResearchSources({ events, runId, canCreateDraft = false, onAccessDenied, sequence }: {
  events: CoworkEvent[]; runId: string; canCreateDraft?: boolean; onAccessDenied: () => void; sequence?: number;
}) {
  const reports = events.filter(event => event.kind === 'tool.completed' && (sequence === undefined || event.sequence === sequence))
    .map(event => ({ sequence: event.sequence, parsed: observationSchema.safeParse(event.payload) }))
    .filter(item => item.parsed.success);
  if (!reports.length) return null;
  return <section aria-label="Fuentes de investigación" className="space-y-4">
    <p className="text-[12.5px] leading-5 text-cw-muted">Fuentes del informe guardado. No se consultaron nuevamente en este trabajo.</p>
    {reports.map(({ sequence: key, parsed }) => {
      if (!parsed.success) return null;
      const report = parsed.data.result.research;
      return <div key={key} className="space-y-3">
        <p className="text-[12.5px] font-medium text-cw-muted">{report.sources.length} fuente{report.sources.length === 1 ? '' : 's'} · capturado el {shortDate(report.capturedAt)}</p>
        <ol className="divide-y divide-cw-border overflow-hidden rounded-2xl border border-cw-border bg-cw-elevated">
          {report.sources.map((source, index) => <li key={source.id}>
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--cw-accent-ring)]">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cw-panel text-[11.5px] font-semibold text-cw-muted ring-1 ring-cw-border">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[13.5px] font-medium text-cw-text group-hover:text-cw-accent">{source.title || host(source.url)}</span>
                <span className="block truncate text-[12px] text-cw-muted">{host(source.url)}</span>
              </span>
              <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-cw-faint" aria-hidden="true" />
            </a>
          </li>)}
        </ol>
        {report.truncated && <p className="text-[12px] text-cw-muted">Se utilizó una selección de la evidencia del informe.</p>}
        {canCreateDraft && report.snapshotId && <ResearchDraft key={`${runId}:${report.snapshotId}`} runId={runId} snapshotId={report.snapshotId} onAccessDenied={onAccessDenied} />}
      </div>;
    })}
  </section>;
}
