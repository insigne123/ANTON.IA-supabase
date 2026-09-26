'use client';

import { useState, type RefObject } from 'react';
import { ArrowLeft, Check, Copy, Maximize2, Minimize2, X } from 'lucide-react';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import type { CoworkArtifact } from '@/lib/cowork/presentation';
import { ArtifactPreview } from './ArtifactPreview';
import { CoworkBlockView } from './CoworkBlocks';
import { ContactResults } from './ContactResults';
import { CoworkMarkdown } from './CoworkMarkdown';
import { CoworkArtifactIcon, coworkArtifactMeta } from './CoworkTurn';
import { DocumentVersions } from './DocumentVersions';
import { ExportMenu } from './ExportMenu';
import { ResearchSources } from './ResearchSources';
import { CwButton } from './ui';

const KIND_LABEL: Record<CoworkArtifact['kind'], string> = {
  block: 'Resultado', document: 'Documento', contacts: 'Tabla', file: 'Archivo', sources: 'Fuentes',
};
const BLOCK_LABEL = { email_draft: 'Correo', sequence: 'Secuencia', table: 'Tabla' } as const;

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', '');
}

/** The open result, beside the conversation (or full screen on phones). */
export function CoworkArtifactPanel({ artifact, events, canResearch, canCreateDraft, maximized, onToggleMaximize, onClose, headingRef,
  onError, onAccessDenied, onUseReport, onSelectVersion, onSend = null, sendHint }: {
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

  return <aside aria-label={artifact.kind === 'document' ? 'Documento' : label} className="cw-slide-in flex h-full min-h-0 flex-col bg-cw-elevated">
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
        <CwButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onToggleMaximize}
          aria-label={maximized ? 'Reducir panel' : 'Ampliar panel'} title={maximized ? 'Reducir' : 'Ampliar'}>
          {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </CwButton>
        <CwButton variant="ghost" size="icon-sm" onClick={onClose} aria-label={closeLabel} title="Cerrar"><X aria-hidden="true" /></CwButton>
      </div>
    </header>
    <div className="cw-scroll min-h-0 flex-1 overflow-y-auto">
      {artifact.kind === 'block' && <div className="mx-auto w-full max-w-[46rem] px-4 py-6 sm:px-8">
        <CoworkBlockView key={artifact.id} block={artifact.block} draftKey={`cowork:draft:${artifact.id}`} onSend={onSend} sendHint={sendHint} />
      </div>}
      {artifact.kind === 'document' && <article className="mx-auto w-full max-w-[46rem] px-5 py-8 sm:px-10 sm:py-10">
        <CoworkMarkdown text={artifact.content} variant="document" />
      </article>}
      {artifact.kind === 'contacts' && <div className="px-4 py-5 sm:px-6">
        <ContactResults key={artifact.runId} runId={artifact.runId} events={events} onError={onError} onAccessDenied={onAccessDenied}
          canResearch={canResearch} onUseReport={onUseReport} showHeader={false} />
      </div>}
      {artifact.kind === 'file' && <div className="px-4 py-5 sm:px-6">
        <ArtifactPreview key={artifact.id} runId={artifact.runId} name={artifact.name} size={artifact.size ?? undefined} defaultOpen />
      </div>}
      {artifact.kind === 'sources' && <div className="px-4 py-5 sm:px-6">
        <ResearchSources events={events} runId={artifact.runId} sequence={artifact.sequence} canCreateDraft={canCreateDraft} onAccessDenied={onAccessDenied} />
      </div>}
    </div>
  </aside>;
}
