'use client';

import { useState, type RefObject } from 'react';
import { ArrowLeft, Check, Copy, Download, Layers, Maximize2, Minimize2, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import type { CoworkArtifact } from '@/lib/cowork/presentation';
import { ArtifactPreview, coworkArtifactUrls } from './ArtifactPreview';
import { CoworkCodeArtifact } from './CoworkCodeArtifact';
import { CoworkBlockView } from './CoworkBlocks';
import { ContactResults } from './ContactResults';
import { CoworkMarkdown } from './CoworkMarkdown';
import { CoworkArtifactIcon, coworkArtifactMeta } from './CoworkTurn';
import { DocumentVersions } from './DocumentVersions';
import { ExportMenu } from './ExportMenu';
import { ResearchSources } from './ResearchSources';
import { cwSwap, m } from './motion';
import { CwButton } from './ui';

const KIND_LABEL: Record<CoworkArtifact['kind'], string> = {
  block: 'Resultado', document: 'Documento', contacts: 'Tabla', file: 'Archivo', sources: 'Fuentes', code: 'Artefacto',
};
const BLOCK_LABEL = { email_draft: 'Correo', sequence: 'Secuencia', table: 'Tabla', chart: 'Gráfico' } as const;

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', '');
}

/** The open result, beside the conversation (or full screen on phones). */
export function CoworkArtifactPanel({ artifact, events, canResearch, canCreateDraft, maximized, onToggleMaximize, onClose, headingRef,
  onError, onAccessDenied, onUseReport, onSelectVersion, onSend = null, sendHint, versions = [], onOpenArtifact, others = [] }: {
  artifact: CoworkArtifact;
  events: CoworkEvent[];
  canResearch: boolean;
  canCreateDraft: boolean;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
  onError: (message: string) => void;
  onAccessDenied: () => void;
  onUseReport: (leadId: string) => void;
  onSelectVersion: (runId: string) => void;
  /** Sends a version of an email or sequence as the next message; null while it cannot be sent. */
  onSend?: ((message: string) => void) | null;
  sendHint?: string;
  /** The versions of a code artifact in this conversation (the same key), oldest first. */
  versions?: CoworkArtifact[];
  /** Opens another artifact (a version) in the panel. */
  onOpenArtifact?: (artifact: CoworkArtifact) => void;
  /** Every result of the conversation, newest first (a code artifact once, at its latest version): switch without closing. */
  others?: CoworkArtifact[];
}) {
  const [copied, setCopied] = useState(false);
  const label = artifact.kind === 'block' ? BLOCK_LABEL[artifact.block.type] : KIND_LABEL[artifact.kind];
  const closeLabel = artifact.kind === 'document' ? 'Cerrar documento' : `Cerrar ${label.toLowerCase()}`;

  async function copyDocument() {
    if (artifact.kind !== 'document') return;
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  }

  return <aside aria-label={artifact.kind === 'document' ? 'Documento' : label} className="flex h-full min-h-0 flex-col bg-cw-elevated">
    <header className="flex shrink-0 items-center gap-2 border-b border-cw-border px-3 py-2.5 sm:px-4">
      <CwButton variant="ghost" size="icon-sm" className="lg:hidden" onClick={onClose} aria-label="Volver a la conversación"><ArrowLeft aria-hidden="true" /></CwButton>
      <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cw-border bg-cw-panel text-cw-accent sm:flex">
        <CoworkArtifactIcon artifact={artifact} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 ref={headingRef} tabIndex={-1} className="truncate text-[14.5px] font-semibold tracking-tight text-cw-text focus-visible:outline-none">{artifact.title}</h2>
        <p className="truncate text-[12px] text-cw-muted">{coworkArtifactMeta(artifact)}{when(artifact.createdAt) ? ` · ${when(artifact.createdAt)}` : ''}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {artifact.kind === 'document' && <>
          <div className="hidden md:block"><DocumentVersions key={artifact.runId} runId={artifact.runId} onSelect={onSelectVersion} onAccessDenied={onAccessDenied} /></div>
          <CwButton variant="ghost" size="icon-sm" onClick={() => void copyDocument()} aria-label={copied ? 'Documento copiado' : 'Copiar documento'} title="Copiar Markdown">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </CwButton>
          <div className="hidden sm:block"><ExportMenu key={artifact.runId} runId={artifact.runId} kind="document" onError={onError} onAccessDenied={onAccessDenied} /></div>
          <div className="sm:hidden"><ExportMenu key={`${artifact.runId}-compact`} runId={artifact.runId} kind="document" onError={onError} onAccessDenied={onAccessDenied} compact /></div>
        </>}
        {artifact.kind === 'code' && <>
          {versions.length > 1 && onOpenArtifact && <>
            <label htmlFor={`version-${artifact.id}`} className="sr-only">Versión del artefacto</label>
            <select id={`version-${artifact.id}`} value={artifact.id} onChange={event => { const next = versions.find(item => item.id === event.target.value); if (next) onOpenArtifact(next); }}
              className="h-8 rounded-lg border border-cw-border bg-cw-elevated px-2 text-[13px] text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
              {versions.map(item => <option key={item.id} value={item.id}>{item.kind === 'code' ? `Versión ${item.version}` : item.title}</option>)}
            </select>
          </>}
          <a href={coworkArtifactUrls(artifact.runId, artifact.name).downloadUrl} title="Descargar el artefacto (HTML que funciona sin conexión)"
            aria-label="Descargar el artefacto" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cw-muted hover:bg-cw-hover hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] [&_svg]:size-4">
            <Download aria-hidden="true" />
          </a>
        </>}
        {others.length > 1 && onOpenArtifact && <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <CwButton variant="ghost" size="icon-sm" aria-label={`Resultados de esta conversación (${others.length})`} title="Resultados de esta conversación">
              <Layers aria-hidden="true" />
            </CwButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[min(24rem,70vh)] w-72 overflow-y-auto rounded-xl border-cw-border bg-cw-elevated p-1 text-cw-text shadow-[var(--cw-shadow)]">
            <DropdownMenuLabel className="px-2.5 py-1.5 text-[12px] font-medium text-cw-muted">Resultados de esta conversación</DropdownMenuLabel>
            {others.map(item => {
              const current = item.id === artifact.id || (item.kind === 'code' && artifact.kind === 'code' && item.key === artifact.key);
              return <DropdownMenuItem key={item.id} onSelect={() => { if (!current) onOpenArtifact(item); }} aria-current={current ? 'true' : undefined}
                className="gap-2.5 rounded-lg px-2.5 py-2 focus:bg-cw-hover focus:text-cw-text">
                <CoworkArtifactIcon artifact={item} className="h-4 w-4 shrink-0 text-cw-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-cw-muted">{coworkArtifactMeta(item)}</span>
                </span>
                {current && <Check className="h-4 w-4 shrink-0 text-cw-accent" aria-hidden="true" />}
              </DropdownMenuItem>;
            })}
          </DropdownMenuContent>
        </DropdownMenu>}
        <CwButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onToggleMaximize}
          aria-label={maximized ? 'Reducir panel' : 'Ampliar panel'} title={maximized ? 'Reducir' : 'Ampliar'}>
          {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </CwButton>
        <CwButton variant="ghost" size="icon-sm" onClick={onClose} aria-label={closeLabel} title="Cerrar"><X aria-hidden="true" /></CwButton>
      </div>
    </header>
    {/* Opening another result fades the new content in, so the change reads as a change of
        page. The old content leaves at once: the title and the content always match. */}
    {artifact.kind === 'code' && <m.div key={artifact.id} initial="hidden" animate="shown" variants={cwSwap} className="flex min-h-0 flex-1 flex-col">
      <CoworkCodeArtifact artifact={artifact} onSend={onSend} sendHint={sendHint} />
    </m.div>}
    {artifact.kind !== 'code' && <m.div key={artifact.id} initial="hidden" animate="shown" variants={cwSwap} className="cw-scroll min-h-0 flex-1 overflow-y-auto">
      {artifact.kind === 'block' && <div className="mx-auto w-full max-w-[46rem] px-4 py-6 sm:px-8">
        <CoworkBlockView key={artifact.id} block={artifact.block} draftKey={`cowork:draft:${artifact.id}`} onSend={onSend} sendHint={sendHint} />
      </div>}
      {artifact.kind === 'document' && <article className="mx-auto w-full max-w-[46rem] px-5 py-8 sm:px-10 sm:py-10">
        <CoworkMarkdown text={artifact.content} variant="document" />
      </article>}
      {artifact.kind === 'contacts' && <div className="px-4 py-5 sm:px-6">
        <ContactResults key={artifact.runId} runId={artifact.runId} events={events} onError={onError} onAccessDenied={onAccessDenied}
          canResearch={canResearch} onUseReport={onUseReport} showHeader={false} onSend={onSend} sendHint={sendHint} />
      </div>}
      {artifact.kind === 'file' && <div className="px-4 py-5 sm:px-6">
        <ArtifactPreview key={artifact.id} runId={artifact.runId} name={artifact.name} size={artifact.size ?? undefined} defaultOpen onAccessDenied={onAccessDenied} />
      </div>}
      {artifact.kind === 'sources' && <div className="px-4 py-5 sm:px-6">
        <ResearchSources events={events} runId={artifact.runId} sequence={artifact.sequence} canCreateDraft={canCreateDraft} onAccessDenied={onAccessDenied} />
      </div>}
    </m.div>}
  </aside>;
}
