'use client';

import { Download, Loader2 } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export function ExportMenu({ runId, kind, onError, onAccessDenied }: {
  runId: string;
  kind: 'contacts' | 'document';
  onError: (message: string) => void;
  onAccessDenied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), [runId]);

  async function download(format: string) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/export?format=${format}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) onAccessDenied();
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo descargar el archivo.');
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `cowork-${kind === 'contacts' ? 'contactos' : 'documento'}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) onError(error instanceof Error ? error.message : 'No se pudo descargar el archivo.');
    } finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline" disabled={busy} aria-label={kind === 'contacts' ? 'Descargar contactos' : 'Descargar documento'}>
      {busy ? <Loader2 className="motion-safe:animate-spin" /> : <Download />}<span>{busy ? 'Preparando…' : 'Descargar'}</span>
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {(kind === 'contacts' ? [['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)']] : [['pdf', 'PDF (.pdf)'], ['md', 'Markdown (.md)']]).map(([format, label]) =>
        <DropdownMenuItem key={format} onSelect={() => void download(format)}>{label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
