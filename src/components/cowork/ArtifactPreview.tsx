'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

const PREVIEWABLE = new Set(['html', 'png', 'svg']);

/** Isolated preview of a generated artifact. HTML renders on demand inside a
 * sandboxed frame with an opaque origin (no allow-same-origin): it cannot
 * reach the app DOM, cookies or the network; the server also serves it with a
 * sandbox CSP. Images render as plain pictures. Anything else is download
 * only. Preview never loads until the user opens it. */
export function ArtifactPreview({ runId, name, size }: {
  runId: string; name: string; size?: number;
}) {
  const [open, setOpen] = useState(false);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const viewUrl = `/api/cowork/runs/${runId}/artifacts?name=${encodeURIComponent(name)}&view=1`;
  const downloadUrl = `/api/cowork/runs/${runId}/artifacts?name=${encodeURIComponent(name)}`;
  return <div className="space-y-2">
    <p className="text-sm">
      <a className="underline underline-offset-2" href={downloadUrl}>{name}</a>
      {typeof size === 'number' ? <span className="text-muted-foreground"> · {(size / 1024).toFixed(1)} KB</span> : null}
    </p>
    {PREVIEWABLE.has(ext) && <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        {open ? 'Ocultar vista previa' : 'Vista previa'}
      </Button>
      {open && (ext === 'html'
        ? <iframe title={`Vista previa de ${name}`} src={viewUrl} sandbox="allow-scripts"
            className="h-96 w-full rounded-lg border border-border bg-white" />
        : <img src={viewUrl} alt={`Vista previa de ${name}`} className="max-h-96 w-auto rounded-lg border border-border" />)}
      {open && ext === 'html' && <p className="text-xs text-muted-foreground">Vista aislada: sin acceso a la app ni a la red.</p>}
    </div>}
  </div>;
}
