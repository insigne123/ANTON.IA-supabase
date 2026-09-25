'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { z } from 'zod';
import { CwButton } from './ui';

const versionsSchema = z.object({ currentRevision: z.number().int().positive().nullable(), versions: z.array(z.object({ revision: z.number().int().positive(), run_id: z.string().uuid(), title: z.string(), created_at: z.string() })).max(50) });

/** Version picker for a document that was revised across turns. */
export function DocumentVersions({ runId, onSelect, onAccessDenied }: {
  runId: string; onSelect: (runId: string) => void; onAccessDenied: () => void;
}) {
  const [state, setState] = useState<z.infer<typeof versionsSchema> | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setState(null); setError(false);
    fetch(`/api/cowork/runs/${runId}/versions`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      if (!response.ok) throw new Error('Versions unavailable');
      const data = versionsSchema.parse(await response.json());
      if (!controller.signal.aborted) setState(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
    // Scope changes remount the document pane; callback identity does not reload data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, refresh]);
  if (error) return <CwButton variant="ghost" size="xs" onClick={() => setRefresh(value => value + 1)}>Reintentar historial</CwButton>;
  if (!state || state.versions.length < 2) return null;
  const current = state.versions.find(version => version.run_id === runId);
  return <div className="flex items-center gap-1.5">
    <History className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" />
    <label htmlFor={`cowork-document-revision-${runId}`} className="sr-only">Versión</label>
    <select id={`cowork-document-revision-${runId}`} value={runId} onChange={event => onSelect(event.target.value)}
      className="h-7 rounded-md border border-cw-border bg-cw-elevated px-1.5 text-[12.5px] text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
      {!current && <option value={runId}>Esta versión</option>}
      {state.versions.map(version => <option key={version.revision} value={version.run_id}>
        Versión {version.revision}{version.revision === state.currentRevision ? ' (última)' : ''}
      </option>)}
    </select>
  </div>;
}
