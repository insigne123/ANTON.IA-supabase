'use client';

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { ChartColumn, Check, ChevronRight, Copy, Download, ListOrdered, Mail, Megaphone, Pencil, RotateCcw, Send, Table2 } from 'lucide-react';
import type { CoworkBlock } from '@/lib/cowork/contracts';
import type { CoworkArtifact, CoworkPanelBlock } from '@/lib/cowork/presentation';
import {
  coworkBlockFilename, coworkBlockMeta, coworkDraftSteps, coworkEmailText, coworkSequenceText, coworkTableCsv, coworkTableTsv, coworkVersionMessage,
  type CoworkEditedEmail,
} from '@/lib/cowork/blocks';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

type Metrics = Extract<CoworkBlock, { type: 'metrics' }>;
type Table = Extract<CoworkBlock, { type: 'table' }>;
type BlockArtifact = Extract<CoworkArtifact, { kind: 'block' }>;

export function CoworkBlockIcon({ block, className }: { block: Pick<CoworkBlock, 'type'>; className?: string }) {
  const Icon = block.type === 'email_draft' ? Mail : block.type === 'sequence' ? ListOrdered : block.type === 'table' ? Table2 : ChartColumn;
  return <Icon className={className} aria-hidden="true" />;
}

/** Copies text and confirms it in place for a moment. */
export function CopyButton({ text, label, copiedLabel = 'Copiado', size = 'xs', variant = 'ghost' }: {
  text: string; label: string; copiedLabel?: string; size?: 'xs' | 'sm'; variant?: 'ghost' | 'secondary';
}) {
  const [copied, setCopied] = useState(false);
  return <CwButton size={size} variant={variant} aria-live="polite"
    onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
    }}>
    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? copiedLabel : label}
  </CwButton>;
}

function downloadCsv(table: Table) {
  const url = URL.createObjectURL(new Blob([coworkTableCsv(table)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = coworkBlockFilename(table.title, 'csv');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Figures read at a glance: value first, then what it is and over what base. */
export function MetricsBlock({ block, live = false }: { block: Metrics; live?: boolean }) {
  return <section aria-label={block.title} className={cn('rounded-2xl border border-cw-border bg-cw-elevated p-4 shadow-[var(--cw-shadow-sm)]', live && 'cw-rise')}>
    <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h3 className="text-[14px] font-semibold tracking-tight text-cw-text">{block.title}</h3>
      {block.period && <p className="text-[12.5px] text-cw-muted">{block.period}</p>}
    </header>
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {block.items.map(item => <div key={`${item.label}-${item.value}`} className="flex flex-col rounded-xl bg-cw-panel px-3 py-2.5">
        <dt className="order-2 text-[12.5px] font-medium text-cw-muted">{item.label}</dt>
        <dd className="order-1 text-[22px] font-semibold leading-7 tracking-tight text-cw-text tabular-nums">{item.value}</dd>
        {item.detail && <dd className="order-3 mt-0.5 text-[12px] leading-4 text-cw-faint">{item.detail}</dd>}
      </div>)}
    </dl>
  </section>;
}

function CardShell({ artifact, active, onOpen, children, actions }: {
  artifact: BlockArtifact; active: boolean; onOpen: (artifact: CoworkArtifact, opener: HTMLElement) => void;
  children: ReactNode; actions: ReactNode;
}) {
  return <section aria-label={artifact.title} className={cn('overflow-hidden rounded-2xl border bg-cw-elevated shadow-[var(--cw-shadow-sm)] transition-colors',
    active ? 'border-cw-accent' : 'border-cw-border')}>
    <button type="button" onClick={event => onOpen(artifact, event.currentTarget)} aria-label={`Abrir ${artifact.title}`} aria-pressed={active}
      className="group flex w-full items-center gap-3 border-b border-cw-border px-3.5 py-3 text-left transition-colors hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--cw-accent-ring)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cw-accent-soft text-cw-accent">
        <CoworkBlockIcon block={artifact.block} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-cw-text">{artifact.title}</span>
        <span className="block truncate text-[12.5px] text-cw-muted">{coworkBlockMeta(artifact.block)}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[12.5px] font-medium text-cw-accent sm:flex">Abrir<ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-cw-faint sm:hidden" aria-hidden="true" />
    </button>
    <div className="px-3.5 py-3">{children}</div>
    <div className="flex flex-wrap items-center gap-1 border-t border-cw-border bg-cw-panel px-2.5 py-1.5">{actions}</div>
  </section>;
}

/** A result the person will copy, review or export, shown as a card in the chat. */
export function BlockCard({ artifact, active, onOpen, live = false }: {
  artifact: BlockArtifact; active: boolean; onOpen: (artifact: CoworkArtifact, opener: HTMLElement) => void; live?: boolean;
}) {
  const { block } = artifact;
  const open = (event: MouseEvent<HTMLButtonElement>) => onOpen(artifact, event.currentTarget);
  const openButton = <CwButton size="xs" variant="ghost" onClick={open}><ChevronRight aria-hidden="true" />Abrir</CwButton>;
  return <div className={cn(live && 'cw-rise')}>
    {block.type === 'email_draft' && <CardShell artifact={artifact} active={active} onOpen={onOpen}
      actions={<><CopyButton text={coworkEmailText(block)} label="Copiar correo" />{openButton}</>}>
      <p className="text-[13.5px] font-semibold text-cw-text">{block.subject}</p>
      <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-[13.5px] leading-[1.55] text-cw-muted">{block.body}</p>
    </CardShell>}
    {block.type === 'sequence' && <CardShell artifact={artifact} active={active} onOpen={onOpen}
      actions={<><CopyButton text={coworkSequenceText(block)} label="Copiar secuencia" />{openButton}</>}>
      <ol className="space-y-1.5">
        {block.steps.map((step, index) => <li key={`${step.day}-${index}`} className="flex items-center gap-2.5 text-[13.5px]">
          <span className="w-14 shrink-0 rounded-md bg-cw-panel px-1.5 py-0.5 text-center text-[12px] font-medium tabular-nums text-cw-muted">Día {step.day}</span>
          <span className="min-w-0 truncate text-cw-text">{step.subject}</span>
        </li>)}
      </ol>
    </CardShell>}
    {block.type === 'table' && <CardShell artifact={artifact} active={active} onOpen={onOpen}
      actions={<>
        <CwButton size="xs" variant="ghost" onClick={() => downloadCsv(block)}><Download aria-hidden="true" />Descargar CSV</CwButton>
        <CopyButton text={coworkTableTsv(block)} label="Copiar tabla" />{openButton}
      </>}>
      <TableGrid block={block} limit={5} />
    </CardShell>}
  </div>;
}

function TableGrid({ block, limit }: { block: Table; limit?: number }) {
  const rows = limit ? block.rows.slice(0, limit) : block.rows;
  return <div className="cw-scroll -mx-1 overflow-x-auto px-1">
    <table className="w-full min-w-[28rem] border-collapse text-left text-[13px]">
      <caption className="sr-only">{block.title}</caption>
      <thead>
        <tr>{block.columns.map(column => <th key={column} scope="col" className="whitespace-nowrap border-b border-cw-border px-2 py-1.5 text-[12px] font-semibold text-cw-muted">{column}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => <tr key={index} className="border-b border-cw-border last:border-0">
          {row.map((cell, column) => <td key={column} className={cn('px-2 py-1.5 align-top text-cw-text', column === 0 && 'font-medium')}>{cell || <span className="text-cw-faint">—</span>}</td>)}
        </tr>)}
      </tbody>
    </table>
    {limit && block.rows.length > limit && <p className="mt-1.5 text-[12.5px] text-cw-muted">{block.rows.length - limit} {block.rows.length - limit === 1 ? 'fila más' : 'filas más'} en la tabla completa</p>}
  </div>;
}

function EmailBody({ subject, body, to }: { subject: string; body: string; to?: string[] | null }) {
  return <div className="space-y-4">
    {to && to.length > 0 && <div>
      <p className="mb-1.5 text-[12px] font-medium text-cw-muted">Para</p>
      <p className="flex flex-wrap gap-1.5">{to.map(item => <span key={item} className="rounded-full border border-cw-border bg-cw-panel px-2.5 py-0.5 text-[12.5px] text-cw-text">{item}</span>)}</p>
    </div>}
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-cw-muted">Asunto</p>
        <CopyButton text={subject} label="Copiar asunto" />
      </div>
      <p className="text-[15px] font-semibold text-cw-text">{subject}</p>
    </div>
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-cw-muted">Cuerpo</p>
        <CopyButton text={body} label="Copiar cuerpo" />
      </div>
      <p className="whitespace-pre-line rounded-xl border border-cw-border bg-cw-panel px-4 py-3.5 text-[14.5px] leading-[1.65] text-cw-text">{body}</p>
    </div>
  </div>;
}

type Draftable = Extract<CoworkPanelBlock, { type: 'email_draft' | 'sequence' }>;
const LIMITS = { subject: 300, body: 12000 };

/** Edits survive closing and reopening the panel in this tab; nothing leaves the browser. */
function useSessionSteps(key: string, original: CoworkEditedEmail[]) {
  const [steps, setSteps] = useState<CoworkEditedEmail[]>(original);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      const fits = Array.isArray(saved) && saved.length === original.length
        && saved.every(step => step && typeof step.subject === 'string' && typeof step.body === 'string');
      setSteps(fits ? saved.map((step: CoworkEditedEmail, index: number) => ({ ...original[index], subject: step.subject, body: step.body })) : original);
    } catch { setSteps(original); }
  }, [key, original]);
  const save = (next: CoworkEditedEmail[]) => {
    setSteps(next);
    try {
      if (JSON.stringify(next) === JSON.stringify(original)) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(next));
    } catch { /* The edit still works for as long as the panel is open. */ }
  };
  return [steps, save] as const;
}

const FIELD = 'w-full rounded-[10px] border border-cw-border bg-cw-elevated px-3 text-cw-text placeholder:text-cw-faint focus-visible:border-cw-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]';

/** Subject and body of one email, editable; shared by the panel and the campaign review. */
export function CoworkEmailFields<T extends { subject: string; body: string }>({ step, index, total, idPrefix, onChange }: {
  step: T; index: number; total: number; idPrefix: string; onChange: (step: T) => void;
}) {
  const name = total > 1 ? ` del correo ${index + 1}` : '';
  const rows = Math.min(18, Math.max(6, step.body.split('\n').length + 1));
  return <div className="space-y-3">
    <div>
      <label htmlFor={`${idPrefix}-subject-${index}`} className="mb-1 block text-[12px] font-medium text-cw-muted">Asunto{name}</label>
      <input id={`${idPrefix}-subject-${index}`} value={step.subject} maxLength={LIMITS.subject} aria-invalid={!step.subject.trim()}
        onChange={event => onChange({ ...step, subject: event.target.value })} className={cn(FIELD, 'h-10 text-[15px] font-semibold')} />
    </div>
    <div>
      <label htmlFor={`${idPrefix}-body-${index}`} className="mb-1 block text-[12px] font-medium text-cw-muted">Cuerpo{name}</label>
      <textarea id={`${idPrefix}-body-${index}`} value={step.body} maxLength={LIMITS.body} rows={rows} aria-invalid={!step.body.trim()}
        onChange={event => onChange({ ...step, body: event.target.value })} className={cn(FIELD, 'resize-y py-3 text-[14.5px] leading-[1.65]')} />
    </div>
  </div>;
}

/** An email or a sequence you can edit before using it: the exact text you leave
 * is what gets sent to Cowork, and what a campaign created from it will carry. */
function DraftView({ block, draftKey, onSend, sendHint }: {
  block: Draftable; draftKey: string; onSend: ((message: string) => void) | null; sendHint: string;
}) {
  // Polling hands over a new object with the same content: keep the edit.
  const originalText = JSON.stringify(coworkDraftSteps(block));
  const original = useMemo(() => JSON.parse(originalText) as CoworkEditedEmail[], [originalText]);
  const [steps, setSteps] = useSessionSteps(draftKey, original);
  const [editing, setEditing] = useState(false);
  const edited = JSON.stringify(steps) !== JSON.stringify(original);
  const complete = steps.every(step => step.subject.trim() && step.body.trim());
  const text = block.type === 'email_draft' ? coworkEmailText(steps[0]) : coworkSequenceText({ ...block, steps: steps.map((step, index) => ({ ...step, day: step.day ?? index + 1 })) });
  const send = (intent: 'use' | 'campaign') => onSend?.(coworkVersionMessage(block, steps.map(step => ({ ...step, subject: step.subject.trim(), body: step.body.trim() })), intent, edited));
  const update = (index: number, step: CoworkEditedEmail) => setSteps(steps.map((item, at) => at === index ? step : item));
  const sequence = block.type === 'sequence';

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2">
      {editing
        ? <CwButton key="done" size="sm" variant="primary" onClick={() => setEditing(false)} disabled={!complete}><Check aria-hidden="true" />Listo</CwButton>
        : <CwButton key="edit" size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Editar</CwButton>}
      {!editing && <CopyButton text={text} label={sequence ? 'Copiar secuencia completa' : 'Copiar correo completo'} size="sm" variant="secondary" />}
      {edited && <CwButton size="sm" variant="ghost" onClick={() => setSteps(original)}><RotateCcw aria-hidden="true" />Volver al original</CwButton>}
      {edited && <span className="rounded-full bg-cw-accent-soft px-2.5 py-0.5 text-[12px] font-medium text-cw-accent">Editado por ti</span>}
    </div>
    {block.type === 'email_draft' && block.to && block.to.length > 0 && <div>
      <p className="mb-1.5 text-[12px] font-medium text-cw-muted">Para</p>
      <p className="flex flex-wrap gap-1.5">{block.to.map(item => <span key={item} className="rounded-full border border-cw-border bg-cw-panel px-2.5 py-0.5 text-[12.5px] text-cw-text">{item}</span>)}</p>
    </div>}
    {sequence
      ? <ol className="space-y-4">
        {steps.map((step, index) => {
          const day = step.day ?? index + 1;
          const previous = index > 0 ? steps[index - 1].day ?? index : null;
          return <li key={index} className="rounded-2xl border border-cw-border bg-cw-elevated p-4">
            <p className="mb-3 flex items-center gap-2 text-[12.5px] font-medium text-cw-muted">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cw-accent-soft text-[12px] font-semibold text-cw-accent">{index + 1}</span>
              Día {day}{previous === null ? ' · primer envío' : ` · ${day - previous} ${day - previous === 1 ? 'día' : 'días'} después`}
            </p>
            {editing ? <CoworkEmailFields step={step} index={index} total={steps.length} idPrefix="cw-draft" onChange={next => update(index, next)} /> : <EmailBody subject={step.subject} body={step.body} />}
          </li>;
        })}
      </ol>
      : editing ? <CoworkEmailFields step={steps[0]} index={0} total={1} idPrefix="cw-draft" onChange={next => update(0, next)} /> : <EmailBody subject={steps[0].subject} body={steps[0].body} />}
    {!complete && <p role="alert" className="text-[12.5px] text-cw-danger">Cada correo necesita asunto y cuerpo.</p>}
    <section aria-label="Qué hago con esta versión" className="rounded-2xl border border-cw-border bg-cw-panel p-4">
      <p className="text-[13.5px] font-semibold text-cw-text">¿Qué hago con {edited ? 'tu versión' : sequence ? 'esta secuencia' : 'este correo'}?</p>
      <p className="mt-0.5 text-[12.5px] leading-5 text-cw-muted">Cowork usa el texto tal cual, sin reescribirlo. Crear la campaña te pide aprobación y no envía nada.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <CwButton size="sm" variant="primary" disabled={!onSend || !complete || editing} onClick={() => send('campaign')}><Megaphone aria-hidden="true" />Crear campaña con esta versión</CwButton>
        <CwButton size="sm" variant="secondary" disabled={!onSend || !complete || editing} onClick={() => send('use')}><Send aria-hidden="true" />Usar esta versión</CwButton>
      </div>
      {(!onSend || editing) && <p className="mt-2 text-[12px] text-cw-muted">{editing ? 'Toca «Listo» para usar lo que editaste.' : sendHint}</p>}
    </section>
  </div>;
}

/** The whole card in the side panel: everything visible, each part copyable;
 * emails and sequences can be edited and used as they are. */
export function CoworkBlockView({ block, draftKey, onSend = null, sendHint = 'Disponible cuando Cowork termine el paso actual.' }: {
  block: CoworkPanelBlock; draftKey: string; onSend?: ((message: string) => void) | null; sendHint?: string;
}) {
  if (block.type === 'email_draft' || block.type === 'sequence') return <DraftView block={block} draftKey={draftKey} onSend={onSend} sendHint={sendHint} />;
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      <CwButton size="sm" onClick={() => downloadCsv(block)}><Download aria-hidden="true" />Descargar CSV</CwButton>
      <CopyButton text={coworkTableTsv(block)} label="Copiar tabla" size="sm" variant="secondary" />
    </div>
    <TableGrid block={block} />
  </div>;
}
