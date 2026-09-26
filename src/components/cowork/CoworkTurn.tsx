'use client';

import { useState } from 'react';
import { Check, ChevronRight, Copy, CornerDownRight, Download, FileText, Library, RotateCcw, Table2, TriangleAlert } from 'lucide-react';
import type { CoworkEvent, CoworkRun } from '@/lib/cowork/contracts';
import {
  coworkDisplayMessage, coworkFileSize, coworkLiveActivity, coworkPlanProgress, coworkProposalView, coworkTurnArtifacts, coworkTurnBlocks, coworkTurnNote, coworkTurnOutput,
  coworkTurnSuggestions, isCoworkActive, type CoworkArtifact,
} from '@/lib/cowork/presentation';
import { coworkReplyBody, type CoworkSuggestion } from '@/lib/cowork/contracts';
import { markdownExcerpt } from '@/lib/cowork/markdown';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import { coworkBlockMeta } from '@/lib/cowork/blocks';
import { cn } from '@/lib/utils';
import { CoworkActivity } from './CoworkActivity';
import { BlockCard, CoworkBlockIcon, MetricsBlock } from './CoworkBlocks';
import { CoworkApproval } from './CoworkApproval';
import { CoworkMarkdown } from './CoworkMarkdown';
import { coworkArtifactUrls } from './ArtifactPreview';
import { CoworkMark, CwButton } from './ui';

export type CoworkTurnData = { run: CoworkRun; events: CoworkEvent[] };

export function CoworkArtifactIcon({ artifact, className }: { artifact: CoworkArtifact; className?: string }) {
  if (artifact.kind === 'block') return <CoworkBlockIcon block={artifact.block} className={className} />;
  const Icon = artifact.kind === 'document' ? FileText : artifact.kind === 'contacts' ? Table2 : artifact.kind === 'sources' ? Library : FileText;
  return <Icon className={className} aria-hidden="true" />;
}

export function coworkArtifactMeta(artifact: CoworkArtifact) {
  if (artifact.kind === 'block') return coworkBlockMeta(artifact.block);
  if (artifact.kind === 'document') return 'Documento';
  if (artifact.kind === 'contacts') return `Tabla · ${artifact.count} ${artifact.companies ? (artifact.count === 1 ? 'empresa' : 'empresas') : (artifact.count === 1 ? 'contacto' : 'contactos')}`;
  if (artifact.kind === 'sources') return `${artifact.count} fuente${artifact.count === 1 ? '' : 's'}`;
  return [artifact.extension.toUpperCase(), coworkFileSize(artifact.size)].filter(Boolean).join(' · ') || 'Archivo';
}

function ArtifactCard({ artifact, active, onOpen }: { artifact: CoworkArtifact; active: boolean; onOpen: (artifact: CoworkArtifact, opener: HTMLElement) => void }) {
  const preview = artifact.kind === 'document' ? markdownExcerpt(artifact.content, 140) : '';
  return <div className={cn('group flex items-stretch overflow-hidden rounded-2xl border bg-cw-elevated shadow-[var(--cw-shadow-sm)] transition-colors',
    active ? 'border-cw-accent' : 'border-cw-border hover:border-cw-border-strong')}>
    <button type="button" onClick={event => onOpen(artifact, event.currentTarget)} aria-label={`Abrir ${artifact.title}`} aria-pressed={active}
      className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--cw-accent-ring)]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cw-border bg-cw-panel text-cw-accent">
        <CoworkArtifactIcon artifact={artifact} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-cw-text">{artifact.title}</span>
        <span className="block truncate text-[12.5px] text-cw-muted">{coworkArtifactMeta(artifact)}{preview ? ` · ${preview}` : ''}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-cw-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </button>
    {artifact.kind === 'file' && <a href={coworkArtifactUrls(artifact.runId, artifact.name).downloadUrl} aria-label={`Descargar ${artifact.name}`}
      className="flex w-11 shrink-0 items-center justify-center border-l border-cw-border text-cw-muted hover:bg-cw-panel hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--cw-accent-ring)]">
      <Download className="h-4 w-4" aria-hidden="true" />
    </a>}
  </div>;
}

/** One or two of your own contacts read better as chips than as a table. */
function ContactChips({ artifact, events, active, onOpen }: { artifact: CoworkArtifact; events: CoworkEvent[]; active: boolean; onOpen: (artifact: CoworkArtifact, opener: HTMLElement) => void }) {
  const rows = collectCoworkLeadRows(events.filter(event => event.kind === 'tool.completed').map(event => event.payload));
  return <div className="flex flex-wrap gap-2" role="group" aria-label={artifact.title}>
    {rows.map(row => {
      const name = String(row.name || 'Contacto');
      const initials = name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
      return <button key={row.id} type="button" onClick={event => onOpen(artifact, event.currentTarget)} aria-label={`Abrir ${name} en ${artifact.title}`}
        className={cn('inline-flex max-w-full items-center gap-2 rounded-full border bg-cw-elevated py-1 pl-1 pr-3 text-left text-[13px] shadow-[var(--cw-shadow-sm)] transition-colors hover:border-cw-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]',
          active ? 'border-cw-accent' : 'border-cw-border')}>
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cw-accent-soft text-[10.5px] font-semibold text-cw-accent">{initials || '·'}</span>
        <span className="min-w-0 truncate"><span className="font-medium text-cw-text">{name}</span>{row.company ? <span className="text-cw-muted"> · {String(row.company)}</span> : null}</span>
      </button>;
    })}
  </div>;
}

/** Quick replies under the latest answer: one click sends the message. The
 * first answers the closing question, so it carries the accent. */
function SuggestedReplies({ suggestions, live, onSelect }: { suggestions: CoworkSuggestion[]; live: boolean; onSelect: (message: string) => void }) {
  return <div role="group" aria-label="Respuestas sugeridas" className={cn('flex flex-wrap gap-2', live && 'cw-rise')}>
    {suggestions.map((chip, index) => <button key={chip.label} type="button" onClick={() => onSelect(chip.message)} title={chip.message}
      aria-label={chip.message === chip.label ? chip.label : `${chip.label}: ${chip.message}`}
      className={cn('inline-flex max-w-full items-center rounded-full border px-3.5 py-2 text-[13.5px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]',
        index === 0
          ? 'border-transparent bg-cw-accent-soft font-medium text-cw-accent hover:border-cw-accent'
          : 'border-cw-border bg-cw-elevated text-cw-text shadow-[var(--cw-shadow-sm)] hover:border-cw-border-strong hover:bg-cw-panel')}>
      <span className="truncate">{chip.label}</span>
    </button>)}
  </div>;
}

/** The next step Cowork offers, after the answer and its results. */
function NextStep({ question, live }: { question: string; live: boolean }) {
  return <p className={cn('flex items-start gap-2 text-[15px] font-medium leading-6 text-cw-text', live && 'cw-rise')}>
    <CornerDownRight className="mt-1 h-4 w-4 shrink-0 text-cw-accent" aria-hidden="true" />
    <span className="min-w-0">{question}</span>
  </p>;
}

function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <CwButton size="icon-sm" variant="ghost" className="h-7 w-7" aria-label={copied ? 'Respuesta copiada' : 'Copiar respuesta'} title="Copiar"
    onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
    }}>
    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
  </CwButton>;
}

/** One conversational turn: the request, what was consulted, the reply, results and any decision. */
export function CoworkTurn({ turn, latest, resolving, openArtifactId, onOpenArtifact, onResolve, onRetry, onSuggestion = null, budgetExhausted, live = false }: {
  turn: CoworkTurnData;
  latest: boolean;
  /** The turn finished while you were watching: reveal the answer gently. */
  live?: boolean;
  resolving: boolean;
  openArtifactId: string | null;
  onOpenArtifact: (artifact: CoworkArtifact, opener: HTMLElement) => void;
  onResolve: (approve: boolean) => void;
  onRetry: (() => void) | null;
  /** Sends a quick reply as your next message; null when you cannot send now. */
  onSuggestion?: ((message: string) => void) | null;
  budgetExhausted: boolean;
}) {
  const { run, events } = turn;
  const active = isCoworkActive(run.status);
  const output = coworkTurnOutput(events);
  const proposal = coworkProposalView(run, events);
  const artifacts = coworkTurnArtifacts(run, events);
  // Emails, sequences and tables read as rich cards; figures stay inline.
  const blockCards = artifacts.flatMap(artifact => artifact.kind === 'block' ? [artifact] : []);
  const otherArtifacts = artifacts.filter(artifact => artifact.kind !== 'block');
  const metrics = coworkTurnBlocks(events).flatMap(block => block.type === 'metrics' ? [block] : []);
  const failure = events.slice().reverse().find(event => event.kind === 'run.failed')?.payload;
  const startedAt = events.find(event => event.kind === 'run.started')?.created_at || run.created_at;
  const waitingDecision = proposal?.state === 'pending';
  const working = active && !waitingDecision;
  // The discard confirmation is already shown by the resolved approval row.
  const reply = output?.reply && !(proposal?.state === 'discarded' && /descartad[ao]/i.test(output.reply)) ? output.reply : '';
  // The closing question reads apart, right above the quick replies that answer it.
  const question = reply && !proposal ? output?.question ?? null : null;
  const body = question ? coworkReplyBody(reply, question) : reply;
  // The assistant's explanation of its proposal reads before the card; the
  // outcome of the approved action reads after it.
  const note = proposal ? coworkTurnNote(events) : null;
  // Only the conversation's current answer offers quick replies.
  const suggestions = latest && onSuggestion && run.status === 'completed' && !proposal ? coworkTurnSuggestions(events) : [];
  const replyBlock = reply ? <div className={cn('group/reply', live && 'cw-rise')}>
    {body && <CoworkMarkdown text={body} />}
    {!active && <div className="-ml-1.5 mt-1 flex opacity-100 transition-opacity sm:opacity-0 sm:group-hover/reply:opacity-100 sm:focus-within:opacity-100"><CopyReply text={reply} /></div>}
  </div> : null;

  return <article className="space-y-4" aria-label={run.automatic ? 'Continuación automática' : 'Turno'}>
    {run.automatic
      ? <p className="flex items-center gap-2 text-[12.5px] text-cw-muted"><CornerDownRight className="h-3.5 w-3.5" aria-hidden="true" />Continuó automáticamente con el resultado</p>
      : <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-br-md bg-cw-user px-4 py-2.5 text-[15px] leading-[1.55] text-cw-text">{coworkDisplayMessage(run.message)}</p>
      </div>}

    <div className="flex gap-3">
      <CoworkMark working={working} size={26} className="mt-0.5 hidden sm:inline-flex" />
      <div className="min-w-0 flex-1 space-y-3.5">
        <CoworkActivity events={events} active={working} liveLabel={coworkLiveActivity(run, events)} startedAt={startedAt} plan={coworkPlanProgress(run, events)} />
        {note && <div className={cn(live && 'cw-rise')}><CoworkMarkdown text={note} /></div>}
        {!proposal && replyBlock}
        {!proposal && metrics.map((block, index) => <MetricsBlock key={`metrics-${index}`} block={block} live={live} />)}
        {blockCards.map(artifact => <BlockCard key={artifact.id} artifact={artifact} active={openArtifactId === artifact.id} onOpen={onOpenArtifact} live={live} />)}
        {otherArtifacts.length > 0 && <div className="grid gap-2">
          {otherArtifacts.map(artifact => artifact.kind === 'contacts' && !artifact.external && artifact.count <= 2
            ? <ContactChips key={artifact.id} artifact={artifact} events={events} active={openArtifactId === artifact.id} onOpen={onOpenArtifact} />
            : <ArtifactCard key={artifact.id} artifact={artifact} active={openArtifactId === artifact.id} onOpen={onOpenArtifact} />)}
        </div>}
        {question && <NextStep question={question} live={live} />}
        {suggestions.length > 0 && onSuggestion && <SuggestedReplies suggestions={suggestions} live={live} onSelect={onSuggestion} />}
        {proposal && <CoworkApproval run={run} proposal={proposal} resolving={resolving} interactive={latest} onResolve={onResolve} />}
        {proposal && replyBlock}
        {run.status === 'failed' && <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl bg-cw-danger-soft px-4 py-3 text-[13.5px] text-cw-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{typeof failure?.message === 'string' ? failure.message : 'Tu solicitud sigue guardada. No se pudo completar el trabajo.'}</p>
          {latest && onRetry && <CwButton size="sm" variant="secondary" onClick={onRetry}><RotateCcw aria-hidden="true" />Reintentar</CwButton>}
        </div>}
        {run.status === 'cancelled' && <div className="flex flex-wrap items-center gap-3 text-[13.5px] text-cw-muted">
          <span>Detuviste este trabajo. Lo consultado hasta aquí quedó guardado.</span>
          {latest && onRetry && <CwButton size="xs" variant="ghost" onClick={onRetry}><RotateCcw aria-hidden="true" />Reintentar</CwButton>}
        </div>}
        {latest && budgetExhausted && <p className="rounded-xl border border-cw-border bg-cw-panel px-3.5 py-2.5 text-[13px] text-cw-muted">Se alcanzó el tope de pasos automáticos de este hilo. Lo logrado quedó guardado; escríbeme abajo para seguir.</p>}
      </div>
    </div>
  </article>;
}
