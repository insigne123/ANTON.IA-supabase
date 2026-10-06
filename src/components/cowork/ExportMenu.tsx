'use client';

import { ChevronDown, Download, FileSpreadsheet, FileText, LoaderCircle } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { CoworkBlock } from '@/lib/cowork/contracts';
import {
  COWORK_BLOCK_FORMATS, COWORK_BLOCK_NOUN, COWORK_DOCUMENT_FORMATS, COWORK_FORMAT_KIND, COWORK_FORMAT_LABEL, coworkFileSize,
  type CoworkBlockType, type CoworkFileFormat,
} from '@/lib/cowork/export-formats';
import { cn } from '@/lib/utils';
import { DoneMark } from './CoworkActivity';
import { AnimatePresence, cwSwap, cwVariants, m } from './motion';
import { CwButton } from './ui';

/** What to do when a download fails or the session is gone; the workspace provides it once for every card. */
type Handlers = { onError: (message: string) => void; onAccessDenied: () => void };
const ExportHandlers = createContext<Handlers | null>(null);
export const CoworkExportProvider = ExportHandlers.Provider;

function filenameFrom(response: Response, fallback: string) {
  const header = response.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim();
  return name && /^[\w.-]{1,120}$/.test(name) ? name : fallback;
}

/** How long «Archivo listo» stays in the button. */
const READY_MS = 2600;

/**
 * «Descargar» with the formats that fit what it is next to: a contacts table or the document of a turn
 * (read from the run, as before) or a card of the chat (sent as the person sees it, so an edited email
 * is the edited one). The button says what is happening: «Preparando…», then «Archivo listo» with a
 * check that draws itself; the name and size stay in its title and in the announcement for screen readers.
 */
export function ExportMenu({ onError, onAccessDenied, compact = false, size = 'sm', variant = 'secondary', ...source }: {
  onError?: (message: string) => void;
  onAccessDenied?: () => void;
  compact?: boolean;
  size?: 'xs' | 'sm';
  variant?: 'ghost' | 'secondary';
} & (
  /** read: the sequence of the search whose whole list is on screen («Ver todos»); the export carries the whole list too. */
  | { kind: 'contacts' | 'document'; runId: string; read?: number | null; block?: undefined }
  | { kind: CoworkBlockType; block: () => CoworkBlock; runId?: undefined }
)) {
  const handlers = useContext(ExportHandlers);
  const fail = onError ?? handlers?.onError;
  const denied = onAccessDenied ?? handlers?.onAccessDenied;
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<{ name: string; size: number } | null>(null);
  const active = useRef<AbortController | null>(null);
  const sourceKey = source.block ? `${source.kind}` : `${source.kind}:${source.runId}:${source.read ?? ''}`;
  useEffect(() => () => active.current?.abort(), [sourceKey]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setReady(null), READY_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const formats: readonly CoworkFileFormat[] = source.kind === 'contacts' ? ['xlsx', 'csv'] : source.kind === 'document' ? COWORK_DOCUMENT_FORMATS : COWORK_BLOCK_FORMATS[source.kind];
  const noun = source.kind === 'contacts' ? 'contactos' : source.kind === 'document' ? 'documento' : COWORK_BLOCK_NOUN[source.kind];

  async function download(format: CoworkFileFormat) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setReady(null);
    try {
      const response = source.block
        ? await fetch('/api/cowork/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal,
          body: JSON.stringify({ format, block: source.block() }) })
        : await fetch(`/api/cowork/runs/${source.runId}/export?format=${format}${source.read ? `&read=${source.read}` : ''}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) denied?.();
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo descargar el archivo.');
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const name = filenameFrom(response, `cowork-${noun}.${format}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReady({ name, size: blob.size });
    } catch (error) {
      if (!controller.signal.aborted) fail?.(error instanceof Error ? error.message : 'No se pudo descargar el archivo.');
    } finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  const state = busy ? 'busy' : ready ? 'ready' : 'idle';
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <CwButton variant={variant} size={compact ? 'icon-sm' : size} disabled={busy} aria-label={`Descargar ${noun}`}
          title={ready ? `${ready.name} · ${coworkFileSize(ready.size)}` : undefined}>
          <AnimatePresence mode="wait" initial={false}>
            <m.span key={state} className="inline-flex items-center gap-[inherit]" {...cwVariants(cwSwap)}>
              {state === 'busy' ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                : state === 'ready' ? <DoneMark live size={size === 'xs' || compact ? 14 : 16} /> : <Download aria-hidden="true" />}
              {!compact && <span>{state === 'busy' ? 'Preparando…' : state === 'ready' ? 'Archivo listo' : 'Descargar'}</span>}
            </m.span>
          </AnimatePresence>
          {!compact && state === 'idle' && <ChevronDown className="-mr-1 opacity-60" aria-hidden="true" />}
        </CwButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 rounded-xl border-cw-border bg-cw-elevated p-1 text-cw-text shadow-[var(--cw-shadow)]">
        {formats.map(format => {
          const Icon = COWORK_FORMAT_KIND[format] === 'sheet' ? FileSpreadsheet : FileText;
          return <DropdownMenuItem key={format} onSelect={() => void download(format)} className={cn('gap-2 rounded-lg px-2.5 py-2 text-[13px] focus:bg-cw-hover focus:text-cw-text')}>
            <Icon className="h-4 w-4 text-cw-muted" aria-hidden="true" />{COWORK_FORMAT_LABEL[format]}
          </DropdownMenuItem>;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
    <span role="status" className="sr-only">{ready ? `Archivo listo: ${ready.name}, ${coworkFileSize(ready.size)}` : busy ? 'Preparando el archivo…' : ''}</span>
  </>;
}
