'use client';

import { ChevronDown, Download, FileSpreadsheet, FileText, LoaderCircle } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

function filenameFrom(response: Response, fallback: string) {
  const header = response.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim();
  return name && /^[\w.-]{1,120}$/.test(name) ? name : fallback;
}

export function ExportMenu({ runId, kind, onError, onAccessDenied, compact = false }: {
  runId: string;
  kind: 'contacts' | 'document';
  onError: (message: string) => void;
  onAccessDenied: () => void;
  compact?: boolean;
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
      link.href = url; link.download = filenameFrom(response, `cowork-${kind === 'contacts' ? 'contactos' : 'documento'}.${format}`);
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) onError(error instanceof Error ? error.message : 'No se pudo descargar el archivo.');
    } finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  const options = kind === 'contacts'
    ? [['xlsx', 'Excel (.xlsx)', FileSpreadsheet], ['csv', 'CSV (.csv)', FileSpreadsheet]] as const
    : [['pdf', 'PDF (.pdf)', FileText], ['md', 'Markdown (.md)', FileText]] as const;

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <CwButton variant="secondary" size={compact ? 'icon-sm' : 'sm'} disabled={busy} aria-label={kind === 'contacts' ? 'Descargar contactos' : 'Descargar documento'}>
        {busy ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
        {!compact && <span>{busy ? 'Preparando…' : 'Descargar'}</span>}
        {!compact && !busy && <ChevronDown className="-mr-1 opacity-60" aria-hidden="true" />}
      </CwButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-44 rounded-xl border-cw-border bg-cw-elevated p-1 text-cw-text shadow-[var(--cw-shadow)]">
      {options.map(([format, label, Icon]) =>
        <DropdownMenuItem key={format} onSelect={() => void download(format)} className={cn('gap-2 rounded-lg px-2.5 py-2 text-[13px] focus:bg-cw-hover focus:text-cw-text')}>
          <Icon className="h-4 w-4 text-cw-muted" aria-hidden="true" />{label}
        </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
