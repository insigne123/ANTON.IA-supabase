'use client';

import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { BadgeCheck, ChartColumn, Check, ChevronRight, Copy, ListOrdered, Mail, Megaphone, Minus, Pencil, RotateCcw, Send, Table2, TriangleAlert } from 'lucide-react';
import type { CoworkBlock } from '@/lib/cowork/contracts';
import type { CoworkArtifact, CoworkCardStatus, CoworkCardTone, CoworkDraftReview, CoworkPanelBlock } from '@/lib/cowork/presentation';
import {
  coworkBlockMeta, coworkBlockWithSteps, coworkDraftSteps, coworkEmailText, coworkSequenceText, coworkTableTsv, coworkVersionMessage,
  coworkFigureNumber, coworkWordDiff, coworkChartHeadline, coworkChartRows, coworkChartSummary, coworkChartValue, type CoworkEditedEmail,
} from '@/lib/cowork/blocks';
import { cn } from '@/lib/utils';
import { ExportMenu } from './ExportMenu';
import { AnimatePresence, CW_EASE, CwCount, cwSwap, cwVariants, m, useReducedMotion } from './motion';
import { CwButton } from './ui';

type Metrics = Extract<CoworkBlock, { type: 'metrics' }>;
type Table = Extract<CoworkBlock, { type: 'table' }>;
type Chart = Extract<CoworkBlock, { type: 'chart' }>;
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

/** A figure that counts up when it first appears while you watch; at rest it reads exactly as written. */
function FigureValue({ value, live }: { value: string; live: boolean }) {
  const figure = live ? coworkFigureNumber(value) : null;
  if (!figure) return <>{value}</>;
  return <>{figure.before}<CwCount value={figure.number} format={figure.format} />{figure.after}</>;
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
        <dd className="order-1 text-[22px] font-semibold leading-7 tracking-tight text-cw-text tabular-nums"><FigureValue value={item.value} live={live} /></dd>
        {item.detail && <dd className="order-3 mt-0.5 text-[12px] leading-4 text-cw-faint">{item.detail}</dd>}
      </div>)}
    </dl>
    <div className="-mb-1 -ml-1.5 mt-2.5 flex flex-wrap items-center gap-1">
      <ExportMenu kind="metrics" block={() => block} size="xs" variant="ghost" />
    </div>
  </section>;
}

/** One color per series, from the app's own tokens: the accent and two greys that keep their contrast on the card, light and dark. */
const SERIES_FILL = ['var(--cw-accent)', 'var(--cw-muted)', 'var(--cw-faint)'] as const;
const PLOT_HEIGHT = 128;

/** The chart's figures as text that pastes as a table. */
function chartTsv(chart: Chart) {
  return [['', ...chart.series.map(series => series.name)], ...coworkChartRows(chart).map(row => row.map(String))].map(row => row.join('\t')).join('\n');
}

/**
 * Figures drawn from the reads of the turn (charts.ts). Bars grow from the base and a line draws itself
 * the first time the card appears while you watch; at rest, and with reduced motion, it is already drawn.
 * The drawing is hidden from screen readers, which get a sentence and the table of values instead.
 */
export function ChartBlock({ block, live = false, tall = false }: { block: Chart; live?: boolean; /** On the canvas, twice as high. */ tall?: boolean }) {
  const reduce = useReducedMotion();
  const animate = live && !reduce;
  const max = Math.max(1, ...block.series.flatMap(series => series.values));
  const plotHeight = tall ? PLOT_HEIGHT * 2 : PLOT_HEIGHT;
  // With few points every bar says its value; with many, the table and the export do.
  const showValues = block.labels.length <= (tall ? 12 : 6);
  const slot = (value: number) => Math.max(value > 0 ? 3 : 0, Math.round(value / max * plotHeight));
  return <section aria-label={block.title} className={cn('rounded-2xl border border-cw-border bg-cw-elevated p-4 shadow-[var(--cw-shadow-sm)]', live && 'cw-rise')}>
    <header className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h3 className="text-[14px] font-semibold tracking-tight text-cw-text">{block.title}</h3>
      {block.period && <p className="text-[12.5px] text-cw-muted">{block.period}</p>}
    </header>
    {block.series.length > 1 && <ul aria-hidden="true" className="mb-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-cw-muted">
      {block.series.map((series, index) => <li key={series.name} className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: SERIES_FILL[index] }} />{series.name}
      </li>)}
    </ul>}
    <div role="img" aria-label={coworkChartSummary(block)}>
      {block.kind === 'bar'
        ? <div aria-hidden="true" className="flex items-end gap-3 border-b border-cw-border" style={{ height: plotHeight + (showValues ? 22 : 0) }}>
          {block.labels.map((label, index) => <div key={`${label}-${index}`} className="flex min-w-0 flex-1 items-end justify-center gap-1">
            {block.series.map((series, at) => {
              const value = series.values[index];
              return <div key={series.name} className="flex min-w-0 max-w-10 flex-1 flex-col items-center justify-end">
                {showValues && <span className="mb-1 text-[12px] font-medium leading-4 tabular-nums text-cw-muted">
                  {live && Number.isInteger(value) && !block.unit ? <CwCount value={value} announce={false} /> : coworkChartValue(block, value)}
                </span>}
                <m.div className="w-full rounded-t-md" title={`${series.name} · ${label}: ${coworkChartValue(block, value)}`}
                  style={{ height: slot(value), background: SERIES_FILL[at], transformOrigin: 'bottom' }}
                  initial={animate ? { scaleY: 0 } : false} animate={{ scaleY: 1 }}
                  transition={{ duration: 0.5, ease: CW_EASE, delay: 0.08 + (index * block.series.length + at) * 0.04 }} />
              </div>;
            })}
          </div>)}
        </div>
        : <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full border-b border-cw-border" style={{ height: plotHeight }}>
          {block.series.map((series, at) => <m.path key={series.name} fill="none" stroke={SERIES_FILL[at]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
            vectorEffect="non-scaling-stroke" pathLength={1}
            d={series.values.map((value, index) => `${index ? 'L' : 'M'}${(index / (block.labels.length - 1) * 100).toFixed(2)} ${(100 - value / max * 96 - 2).toFixed(2)}`).join(' ')}
            initial={animate ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: CW_EASE, delay: 0.08 + at * 0.12 }} />)}
        </svg>}
      <div aria-hidden="true" className="mt-1.5 flex justify-between gap-3 text-[12.5px] text-cw-muted">
        {block.kind === 'bar'
          ? block.labels.map((label, index) => <span key={`${label}-${index}`} className="min-w-0 flex-1 truncate text-center">{label}</span>)
          : <><span>{block.labels[0]}</span><span>{block.labels[block.labels.length - 1]}</span></>}
      </div>
    </div>
    <table className="sr-only">
      <caption>{block.title}{block.period ? `, ${block.period}` : ''}</caption>
      <thead><tr><th scope="col">{block.kind === 'bar' ? 'Categoría' : 'Punto'}</th>{block.series.map(series => <th key={series.name} scope="col">{series.name}</th>)}</tr></thead>
      <tbody>{block.labels.map((label, index) => <tr key={`${label}-${index}`}><th scope="row">{label}</th>
        {block.series.map(series => <td key={series.name}>{coworkChartValue(block, series.values[index])}</td>)}</tr>)}</tbody>
    </table>
    <div className="-mb-1 -ml-1.5 mt-2.5 flex flex-wrap items-center gap-1">
      <CopyButton text={chartTsv(block)} label="Copiar datos" />
      <ExportMenu kind="chart" block={() => block} size="xs" variant="ghost" />
    </div>
  </section>;
}

const STATUS_TONE: Record<CoworkCardTone, { text: string; dot: string }> = {
  neutral: { text: 'text-cw-muted', dot: 'bg-cw-border-strong' },
  accent: { text: 'text-cw-accent', dot: 'bg-cw-accent' },
  attention: { text: 'text-cw-warning', dot: 'bg-cw-warning' },
  success: { text: 'text-cw-success', dot: 'bg-cw-success' },
  danger: { text: 'text-cw-danger', dot: 'bg-cw-danger' },
};
const DRAFT_STATUS: CoworkCardStatus = { label: 'Borrador · no se ha enviado', tone: 'neutral' };
const EDITED_STATUS: CoworkCardStatus = { label: 'Editado por ti · no se ha enviado', tone: 'accent' };
/** Fired in this tab when the panel saves or clears an edit of a card (detail: its key). */
const DRAFT_EDIT_EVENT = 'cowork:draft-edit';

/** Whether this card's text was edited in the panel; the edit lives in this tab only. */
function useEditedHere(key: string) {
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    const read = () => { try { setEdited(sessionStorage.getItem(key) !== null); } catch { setEdited(false); } };
    read();
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === key) read(); };
    window.addEventListener(DRAFT_EDIT_EVENT, changed);
    return () => window.removeEventListener(DRAFT_EDIT_EVENT, changed);
  }, [key]);
  return edited;
}

/** Where the card stands, at the end of its actions: a draft nobody sent, your edit, or what a
 * later turn did with it. A change of status swaps in place. */
function CardStatusLine({ status }: { status: CoworkCardStatus }) {
  const tone = STATUS_TONE[status.tone];
  return <span className="ml-auto flex min-w-0 max-w-full items-center px-1.5">
    <AnimatePresence initial={false} mode="wait">
      <m.span key={status.label} {...cwVariants(cwSwap)} className={cn('flex min-w-0 items-center gap-1.5 text-[12px] font-medium', tone.text)}>
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
        <span className="truncate">{status.label}</span>
      </m.span>
    </AnimatePresence>
  </span>;
}

/** What the Reviewer did with the card before you saw it: reviewed with nothing to fix, what it fixed,
 * or what is still to look at (it could not fix it in time). */
function ReviewLine({ review, live }: { review: CoworkDraftReview; live: boolean }) {
  const pending = review.outcome === 'pending';
  return <div className={cn('mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-5', pending ? 'text-cw-warning' : 'text-cw-muted', live && 'cw-fade')}>
    {pending ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cw-success" aria-hidden="true" />}
    {pending
      ? <span className="min-w-0"><span className="font-medium">Revísalo antes de usarlo</span>
        {review.changes.slice(0, 2).map(change => <span key={change} className="block text-cw-muted">{change}</span>)}</span>
      : <span className="min-w-0"><span className="font-medium text-cw-text">Revisado</span>
        {' · '}{review.outcome === 'fixed' && review.changes.length ? review.changes.join(' · ') : 'sin ajustes'}</span>}
  </div>;
}

function CardShell({ artifact, active, onOpen, children, actions, status = null, review = null, live = false }: {
  artifact: BlockArtifact; active: boolean; onOpen: (artifact: CoworkArtifact, opener: HTMLElement) => void;
  children: ReactNode; actions: ReactNode; status?: CoworkCardStatus | null; review?: CoworkDraftReview | null; live?: boolean;
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
    <div className="px-3.5 py-3">{children}{review && <ReviewLine review={review} live={live} />}</div>
    <div className="flex flex-wrap items-center gap-1 border-t border-cw-border bg-cw-panel px-2.5 py-1.5">{actions}{status && <CardStatusLine status={status} />}</div>
  </section>;
}

/** A result the person will copy, review or export, shown as a card in the chat. Emails and
 * sequences say where they stand: `status` is what a later turn did with them (see
 * coworkCardStatuses); without one they are drafts nobody sent, or your edit of one. */
export function BlockCard({ artifact, active, onOpen, live = false, status = null, review = null }: {
  artifact: BlockArtifact; active: boolean; onOpen: (artifact: CoworkArtifact, opener: HTMLElement) => void; live?: boolean;
  status?: CoworkCardStatus | null;
  /** How the Reviewer left this turn's emails (coworkDraftReview); null when nobody reviewed them. */
  review?: CoworkDraftReview | null;
}) {
  const { block } = artifact;
  const editedHere = useEditedHere(`cowork:draft:${artifact.id}`);
  const draftStatus = status || (editedHere ? EDITED_STATUS : DRAFT_STATUS);
  const open = (event: MouseEvent<HTMLButtonElement>) => onOpen(artifact, event.currentTarget);
  const openButton = <CwButton size="xs" variant="ghost" onClick={open}><ChevronRight aria-hidden="true" />Abrir</CwButton>;
  return <div className={cn(live && 'cw-rise')}>
    {block.type === 'email_draft' && <CardShell artifact={artifact} active={active} onOpen={onOpen} status={draftStatus} review={review} live={live}
      actions={<><CopyButton text={coworkEmailText(block)} label="Copiar correo" />
        <ExportMenu kind="email_draft" block={() => savedDraft(block, artifact.id)} size="xs" variant="ghost" />{openButton}</>}>
      <p className="text-[13.5px] font-semibold text-cw-text">{block.subject}</p>
      <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-[13.5px] leading-[1.55] text-cw-muted">{block.body}</p>
    </CardShell>}
    {block.type === 'sequence' && <CardShell artifact={artifact} active={active} onOpen={onOpen} status={draftStatus} review={review} live={live}
      actions={<><CopyButton text={coworkSequenceText(block)} label="Copiar secuencia" />
        <ExportMenu kind="sequence" block={() => savedDraft(block, artifact.id)} size="xs" variant="ghost" />{openButton}</>}>
      <ol className="space-y-1.5">
        {block.steps.map((step, index) => <li key={`${step.day}-${index}`} className="flex items-center gap-2.5 text-[13.5px]">
          <span className="w-14 shrink-0 rounded-md bg-cw-panel px-1.5 py-0.5 text-center text-[12px] font-medium tabular-nums text-cw-muted">Día {step.day}</span>
          <span className="min-w-0 truncate text-cw-text">{step.subject}</span>
        </li>)}
      </ol>
    </CardShell>}
    {block.type === 'chart' && <CardShell artifact={artifact} active={active} onOpen={onOpen}
      actions={<><CopyButton text={chartTsv(block)} label="Copiar datos" />
        <ExportMenu kind="chart" block={() => block} size="xs" variant="ghost" />{openButton}</>}>
      <p className="text-[13.5px] leading-[1.55] text-cw-muted">{coworkChartHeadline(block)}</p>
    </CardShell>}
    {block.type === 'table' && <CardShell artifact={artifact} active={active} onOpen={onOpen}
      actions={<>
        <ExportMenu kind="table" block={() => block} size="xs" variant="ghost" />
        <CopyButton text={coworkTableTsv(block)} label="Copiar tabla" />{openButton}
      </>}>
      <TableGrid block={block} limit={5} live={live} />
    </CardShell>}
  </div>;
}

const YES = new Set(['sí', 'si', 'yes']);
const NO = new Set(['no']);
/** Columns whose cells are all «Sí» or «No» (at least one): they read as icons. */
function yesNoColumns(block: Table) {
  return block.columns.map((_, column) => {
    const cells = block.rows.map(row => (row[column] || '').trim().toLocaleLowerCase('es')).filter(Boolean);
    return cells.length > 0 && cells.every(cell => YES.has(cell) || NO.has(cell));
  });
}

function Cell({ value, yesNo }: { value: string; yesNo: boolean }) {
  if (!value) return <span className="text-cw-faint">—</span>;
  if (!yesNo) return <>{value}</>;
  const yes = YES.has(value.trim().toLocaleLowerCase('es'));
  return <span className={cn('inline-flex items-center', yes ? 'text-cw-success' : 'text-cw-faint')}>
    {yes ? <Check className="h-4 w-4" aria-hidden="true" /> : <Minus className="h-4 w-4" aria-hidden="true" />}
    <span className="sr-only">{yes ? 'Sí' : 'No'}</span>
  </span>;
}

/** The rows of a table; in a card that appears while you watch, they come in one after another. */
function TableGrid({ block, limit, live = false }: { block: Table; limit?: number; live?: boolean }) {
  const rows = limit ? block.rows.slice(0, limit) : block.rows;
  const yesNo = useMemo(() => yesNoColumns(block), [block]);
  return <div className="cw-scroll -mx-1 overflow-x-auto px-1">
    <table className="w-full min-w-[28rem] border-collapse text-left text-[13px]">
      <caption className="sr-only">{block.title}</caption>
      <thead>
        <tr>{block.columns.map(column => <th key={column} scope="col" className="whitespace-nowrap border-b border-cw-border px-2 py-1.5 text-[12px] font-semibold text-cw-muted">{column}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => <tr key={index} className={cn('border-b border-cw-border last:border-0', live && 'cw-rise')}
          style={live ? { animationDelay: `${120 + index * 45}ms` } : undefined}>
          {row.map((cell, column) => <td key={column} className={cn('px-2 py-1.5 align-top text-cw-text', column === 0 && 'font-medium')}><Cell value={cell} yesNo={yesNo[column]} /></td>)}
        </tr>)}
      </tbody>
    </table>
    {limit && block.rows.length > limit && <p className="mt-1.5 text-[12.5px] text-cw-muted">{block.rows.length - limit} {block.rows.length - limit === 1 ? 'fila más' : 'filas más'} en la tabla completa</p>}
  </div>;
}

/** Text with the words an edit changed marked for a moment (.cw-changed fades them out). */
function Marked({ text, before }: { text: string; before: string | null }) {
  const parts = useMemo(() => before === null || before === text ? null : coworkWordDiff(before, text), [before, text]);
  if (!parts) return <>{text}</>;
  return <>{parts.map((part, index) => part.changed ? <mark key={index} className="cw-changed">{part.text}</mark> : <Fragment key={index}>{part.text}</Fragment>)}</>;
}

/** One email to read and copy. `before`: the original, whose changed words get marked for a moment. */
function EmailBody({ subject, body, to, before = null }: { subject: string; body: string; to?: string[] | null; before?: { subject: string; body: string } | null }) {
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
      <p className="text-[15px] font-semibold text-cw-text"><Marked text={subject} before={before?.subject ?? null} /></p>
    </div>
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-cw-muted">Cuerpo</p>
        <CopyButton text={body} label="Copiar cuerpo" />
      </div>
      <p className="whitespace-pre-line rounded-xl border border-cw-border bg-cw-panel px-4 py-3.5 text-[14.5px] leading-[1.65] text-cw-text"><Marked text={body} before={before?.body ?? null} /></p>
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
    // The card in the chat says «Editado por ti» while the edit is kept.
    window.dispatchEvent(new CustomEvent(DRAFT_EDIT_EVENT, { detail: key }));
  };
  return [steps, save] as const;
}

/** The card as the person has it now: their edit of it, if they made one in the panel, else as Cowork wrote it. */
function savedDraft(block: Extract<CoworkBlock, { type: 'email_draft' | 'sequence' }>, artifactId: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`cowork:draft:${artifactId}`) || 'null');
    const original = coworkDraftSteps(block);
    if (Array.isArray(saved) && saved.length === original.length && saved.every(step => step && typeof step.subject === 'string' && typeof step.body === 'string')) {
      return coworkBlockWithSteps(block, saved.map((step, index) => ({ ...original[index], subject: step.subject, body: step.body })));
    }
  } catch { /* As Cowork wrote it. */ }
  return block;
}

/** The text field of Cowork's cards, shared by the forms that edit an email. */
export const FIELD = 'w-full rounded-[10px] border border-cw-border bg-cw-elevated px-3 text-cw-text placeholder:text-cw-faint focus-visible:border-cw-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]';

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
  // Right after «Listo», the words that differ from the original are marked for a moment.
  const [marking, setMarking] = useState(false);
  useEffect(() => {
    if (!marking) return;
    const timer = setTimeout(() => setMarking(false), 3200);
    return () => clearTimeout(timer);
  }, [marking]);
  const edited = JSON.stringify(steps) !== JSON.stringify(original);
  const complete = steps.every(step => step.subject.trim() && step.body.trim());
  const text = block.type === 'email_draft' ? coworkEmailText(steps[0]) : coworkSequenceText({ ...block, steps: steps.map((step, index) => ({ ...step, day: step.day ?? index + 1 })) });
  const send = (intent: 'use' | 'campaign') => onSend?.(coworkVersionMessage(block, steps.map(step => ({ ...step, subject: step.subject.trim(), body: step.body.trim() })), intent, edited));
  const update = (index: number, step: CoworkEditedEmail) => setSteps(steps.map((item, at) => at === index ? step : item));
  const sequence = block.type === 'sequence';

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2">
      {editing
        ? <CwButton key="done" size="sm" variant="primary" onClick={() => { setEditing(false); setMarking(edited); }} disabled={!complete}><Check aria-hidden="true" />Listo</CwButton>
        : <CwButton key="edit" size="sm" variant="secondary" onClick={() => { setEditing(true); setMarking(false); }}><Pencil aria-hidden="true" />Editar</CwButton>}
      {!editing && <CopyButton text={text} label={sequence ? 'Copiar secuencia completa' : 'Copiar correo completo'} size="sm" variant="secondary" />}
      {!editing && <ExportMenu kind={block.type} block={() => coworkBlockWithSteps(block, steps)} />}
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
            {editing ? <CoworkEmailFields step={step} index={index} total={steps.length} idPrefix="cw-draft" onChange={next => update(index, next)} />
              : <EmailBody subject={step.subject} body={step.body} before={marking ? original[index] : null} />}
          </li>;
        })}
      </ol>
      : editing ? <CoworkEmailFields step={steps[0]} index={0} total={1} idPrefix="cw-draft" onChange={next => update(0, next)} />
        : <EmailBody subject={steps[0].subject} body={steps[0].body} before={marking ? original[0] : null} />}
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
  if (block.type === 'chart') return <ChartBlock block={block} tall />;
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      <ExportMenu kind="table" block={() => block} />
      <CopyButton text={coworkTableTsv(block)} label="Copiar tabla" size="sm" variant="secondary" />
    </div>
    <TableGrid block={block} />
  </div>;
}
