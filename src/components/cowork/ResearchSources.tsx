import type { CoworkEvent } from '@/lib/cowork/contracts';
import { z } from 'zod';
import { ResearchDraft } from './ResearchDraft';

const sourceSchema = z.object({ id: z.string(), url: z.string().url().refine(url => /^https?:\/\//i.test(url)), title: z.string().optional(), retrievedAt: z.string() });
const observationSchema = z.object({
  action: z.literal('research.get_existing'),
  result: z.object({
    availability: z.literal('available'),
    research: z.object({ snapshotId: z.string().uuid().optional(), capturedAt: z.string(), status: z.string(), truncated: z.boolean(), sources: z.array(sourceSchema).max(100) }),
  }),
});

export function ResearchSources({ events, runId, canCreateDraft = false, onAccessDenied }: {
  events: CoworkEvent[]; runId: string; canCreateDraft?: boolean; onAccessDenied: () => void;
}) {
  const reports = events.filter(event => event.kind === 'tool.completed')
    .map(event => ({ sequence: event.sequence, parsed: observationSchema.safeParse(event.payload) }))
    .filter(item => item.parsed.success);
  if (!reports.length) return null;
  return <section aria-label="Fuentes de investigación" className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-medium">Investigación consultada</h3>
    <p className="text-xs text-muted-foreground">Fuentes del informe guardado. No se consultaron nuevamente en este trabajo.</p>
    {reports.map(({ sequence, parsed }) => {
      if (!parsed.success) return null;
      const report = parsed.data.result.research;
      return <details key={sequence} className="text-sm">
        <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{report.sources.length} fuentes · {report.capturedAt.slice(0, 10)}</summary>
        <ul className="mt-3 space-y-2">{report.sources.map(source => <li key={source.id} className="break-words"><a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{source.title || new URL(source.url).hostname}</a></li>)}</ul>
        {report.truncated && <p className="mt-2 text-xs text-muted-foreground">Se utilizó una selección de la evidencia del informe.</p>}
        {canCreateDraft && report.snapshotId && <ResearchDraft key={`${runId}:${report.snapshotId}`} runId={runId} snapshotId={report.snapshotId} onAccessDenied={onAccessDenied} />}
      </details>;
    })}
  </section>;
}
