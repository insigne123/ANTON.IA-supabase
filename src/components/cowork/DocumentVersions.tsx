'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { z } from 'zod';

const versionsSchema = z.object({ currentRevision: z.number().int().positive().nullable(), versions: z.array(z.object({ revision: z.number().int().positive(), run_id: z.string().uuid(), title: z.string(), created_at: z.string() })).max(50) });
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
  if (error) return <Button variant="ghost" size="sm" onClick={() => setRefresh(value => value + 1)}>Reintentar historial</Button>;
  if (!state?.versions.length) return null;
  return <div className="flex items-center gap-2 border-b border-border px-4 py-3">
    <Label htmlFor="cowork-document-revision" className="text-xs">Versión</Label>
    <select id="cowork-document-revision" value={runId} onChange={event => onSelect(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {state.versions.map(version => <option key={version.revision} value={version.run_id}>Versión {version.revision}</option>)}
    </select>
  </div>;
}
