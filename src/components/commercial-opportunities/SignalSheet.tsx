'use client';
// The commercial sheet of a signal (a company that is hiring, a LinkedIn post) as one page: what the radar saw, drawn as numbers and bars;
// how it fits the company's offer; who to contact and what to say; a follow-up line and what is still missing. It draws the model of
// signal-sheet.ts, the same one the PDF draws, so the download is this page on paper.
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Circle, Copy, Download, ExternalLink, Linkedin, ListChecks, Mail, MessageCircleQuestion, Phone, Search, Sparkles, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { IMPACT_LABELS, humanDate } from '@/lib/commercial-opportunities/report-view';
import { reportChecklist, reportItemKey, reportProgress, type ReportMark, type ReportMarks } from '@/lib/commercial-opportunities/report-marks';
import { STRENGTH_LABELS } from '@/lib/commercial-opportunities/signal-brief';
import { SECTION_TITLES, buildSignalSheet, sheetSections, type SectionId, type SheetInput, type SignalSheet } from '@/lib/commercial-opportunities/signal-sheet';
import { MarkedItem, useReportMarks, type MarkChange } from './ReportMarks';
import { PriorityStars } from './PriorityStars';

const TONES = { go: 'bg-cw-success-soft text-cw-success', evaluate: 'bg-cw-warning-soft text-cw-warning', no: 'bg-muted text-muted-foreground', pending: 'bg-muted text-muted-foreground' };
const IMPACT_TONES: Record<string, string> = { high: 'bg-destructive/10 text-destructive', medium: 'bg-cw-warning-soft text-cw-warning', low: 'bg-muted text-muted-foreground' };
const CHANNEL_ICONS = { linkedin: Linkedin, email: Mail, call: Phone, research: Search } as const;
const SUGGESTED = ['¿A quién debería contactar primero?', '¿Qué le digo en el primer mensaje?', '¿Qué sabemos de esta empresa?'];
/** The five bands of the fit meter, from the lowest score to the highest; the same cuts as the stars (priority.ts). */
const BANDS = ['bg-red-100 dark:bg-red-400/20', 'bg-amber-100 dark:bg-amber-400/20', 'bg-yellow-100 dark:bg-yellow-400/20', 'bg-emerald-100 dark:bg-emerald-400/20', 'bg-emerald-200 dark:bg-emerald-400/30'];

export type SignalSheetPanelProps = {
  item: SheetInput['item'];
  report: OpportunityReport | null;
  decisionMakerTitles?: string[];
  contactsCount?: number;
  /** The team's marks; absent while the table does not exist, and then the sheet has no checks. */
  marks?: { available: boolean; items: ReportMarks } | null;
  onMark?: (change: MarkChange) => Promise<ReportMark | null>;
  people?: Array<{ user_id: string; name: string }>;
  onTask: (title: string, evidence: string) => void;
  onAsk: (question: string) => void;
  onContacts?: () => void;
  onGenerate?: () => void;
  generating?: boolean;
  /** The PDF of this sheet (the export route draws it from the same model). */
  downloadHref?: string;
  now?: number;
};

const Section = ({ id, title, hint, action, children }: { id: SectionId; title: string; hint?: string; action?: ReactNode; children: ReactNode }) =>
  <section id={`sheet-${id}`} aria-labelledby={`sheet-${id}-title`} className="scroll-mt-24 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0"><h3 id={`sheet-${id}-title`} className="text-lg font-semibold">{title}</h3>{hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}</div>
      {action}
    </div>
    {children}
  </section>;

/** One figure with its words: «32 · En la última semana · 11,7 veces su ritmo anterior». */
const Kpi = ({ value, label, note, small }: { value: string; label: string; note?: string; small?: boolean }) =>
  <div className="min-w-0 rounded-2xl bg-muted/50 px-4 py-3">
    <p className={cn('font-semibold tabular-nums tracking-tight text-primary', small ? 'text-lg' : 'text-3xl')}>{value}</p>
    <p className="mt-1 text-sm font-medium">{label}</p>
    {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
  </div>;

/** Horizontal bars, the longest being the largest; the number and the share are written, so the bars never carry the information alone. */
function BarList({ title, bars }: { title: string; bars: Array<{ label: string; value: number; share: number; percent: number | null }> }) {
  return <div className="min-w-0">
    <h4 className="text-sm font-semibold">{title}</h4>
    <ul className="mt-3 space-y-2.5">{bars.map(bar => <li key={bar.label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
      <span className="truncate" title={bar.label}>{bar.label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round(bar.share * 100))}%` }} /></span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">{bar.value}{bar.percent !== null ? ` · ${Math.round(bar.percent * 100)} %` : ''}</span>
    </li>)}</ul>
  </div>;
}

/** Last week against the weekly average before it, on one scale. */
function PaceBars({ pace }: { pace: { lastWeek: number; priorWeekly: number } }) {
  const peak = Math.max(pace.lastWeek, pace.priorWeekly, 1);
  const rows: Array<[string, number, string]> = [['Promedio anterior', pace.priorWeekly, 'bg-muted-foreground/50'], ['Última semana', pace.lastWeek, 'bg-primary']];
  return <div>
    <h4 className="text-sm font-semibold">Ritmo de contratación</h4>
    <ul className="mt-3 space-y-2.5">{rows.map(([label, value, color]) => <li key={label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
      <span className="truncate" title={label}>{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className={cn('block h-full rounded-full', color)} style={{ width: `${Math.max(4, Math.round((value / peak) * 100))}%` }} /></span>
      <span className="text-right text-xs font-medium tabular-nums">{new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(value)}</span></li>)}</ul>
  </div>;
}

/** The score on a scale of five bands with a marker; the words say the same. */
function FitMeter({ score, meaning }: { score: number; meaning: string }) {
  return <div>
    <div className="relative pt-6" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-valuetext={`${score} de 100: ${meaning}`} aria-label="Calce con tu oferta">
      <div className="flex h-3 overflow-hidden rounded-full">{BANDS.map((band, index) => <span key={band} className={cn('h-full', band)} style={{ width: index === 0 ? '30%' : index === 1 ? '20%' : index === 2 ? '15%' : index === 3 ? '15%' : '20%' }} />)}</div>
      <span className="absolute top-0 -translate-x-1/2 text-xs font-semibold tabular-nums" style={{ left: `${score}%` }}>{score}</span>
      <span className="absolute top-[1.35rem] h-5 w-0.5 -translate-x-1/2 rounded bg-foreground" style={{ left: `${score}%` }} aria-hidden="true" />
    </div>
    <p className="mt-2 text-sm text-muted-foreground">Afinidad con tu oferta: <span className="font-medium text-foreground">{score} de 100</span> · {meaning}</p>
  </div>;
}

const Dots = ({ filled }: { filled: number }) => <span className="inline-flex gap-1" aria-hidden="true">{[1, 2, 3].map(position => <span key={position} className={cn('h-2.5 w-2.5 rounded-full', position <= filled ? 'bg-primary' : 'bg-muted-foreground/25')} />)}</span>;

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2200); }
    catch { window.prompt('Copia el mensaje', text); }
  };
  return <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => void copy()} aria-live="polite">
    {copied ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}{copied ? 'Copiado' : label}</Button>;
}

/** The follow-up on an axis (where the days fall) and, below it, each step in words. */
function Timeline({ steps }: { steps: SignalSheet['cadence'] }) {
  const last = Math.max(...steps.map(step => step.day), 1);
  return <div>
    <div className="relative mx-2 h-6" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-muted" />
      {steps.map((step, index) => <span key={index} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-4 ring-background" style={{ left: `${(step.day / last) * 100}%` }} />)}
      <span className="absolute -bottom-3 left-0 text-[10px] text-muted-foreground">Día 0</span>
      <span className="absolute -bottom-3 right-0 text-[10px] text-muted-foreground">Día {last}</span>
    </div>
    <ol className="mt-7 space-y-3">{steps.map((step, index) => { const Icon = CHANNEL_ICONS[step.channel]; return <li key={index} className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Día {step.day} · {step.channelLabel}</p><p className="text-sm">{step.action}</p></div>
    </li>; })}</ol>
    <p className="mt-4 text-xs text-muted-foreground">Es una propuesta: ajusta los días según cómo responda la persona.</p>
  </div>;
}

export function SignalSheetPanel({ item, report, decisionMakerTitles, contactsCount = 0, marks: initialMarks, onMark, people, onTask, onAsk, onContacts, onGenerate, generating = false, downloadHref, now }: SignalSheetPanelProps) {
  const sheet = useMemo(() => buildSignalSheet({ item, report, decisionMakerTitles, contactsCount, now }), [item, report, decisionMakerTitles, contactsCount, now]);
  const { interactive, marks, pending, change } = useReportMarks(initialMarks, onMark);
  const authorOf = (id?: string | null) => people?.find(person => person.user_id === id)?.name ?? null;
  const markProps = { marks: interactive ? marks : null, pending, onChange: (input: MarkChange) => void change(input), authorOf, whenOf: (at?: string | null) => humanDate(at, true) };
  const checklist = useMemo(() => (report && sheet ? reportChecklist(report, sheet.nextSteps) : []), [report, sheet]);
  const progress = reportProgress(checklist, marks);
  if (!sheet) return null;
  const sections = sheetSections(sheet);
  const has = (id: SectionId) => sections.includes(id);
  const missing = sheet.completeness.items.filter(entry => !entry.done);
  const highlighted = interactive ? checklist.filter(entry => marks[entry.key]?.highlight) : [];
  const hiring = sheet.pulse.kind === 'hiring' ? sheet.pulse : null;
  const post = sheet.pulse.kind === 'post' ? sheet.pulse : null;

  return <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
    <article className="min-w-0 space-y-10">
      <section aria-label="Resumen de la ficha" className="rounded-3xl border bg-background p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PriorityStars score={sheet.stars.score} />
          {sheet.decision ? <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', TONES[sheet.decision.tone])}>{sheet.decision.label}</span> : null}
          {sheet.relation ? <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', sheet.relation.code === 'new' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>{sheet.relation.label}</span> : null}
          <span className="text-xs text-muted-foreground">{sheet.preparedAt ? `Preparada el ${sheet.preparedAt}` : 'Lo que ya vio el radar'}</span>
        </div>
        <h2 className="mt-4 max-w-3xl text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{sheet.headline}</h2>
        {sheet.executive ? <p className="mt-3 max-w-3xl text-[15px] leading-7 text-foreground/90">{sheet.executive}</p> : null}
        {(sheet.links.length > 0 || downloadHref) ? <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {sheet.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{link.label}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>)}
          {downloadHref ? <Button asChild variant="outline" size="sm" className="ml-auto"><a href={downloadHref}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Descargar ficha en PDF</a></Button> : null}
        </div> : null}
        {interactive && progress.total > 0 ? <div className="mt-6 space-y-2" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3 text-sm"><p className="font-medium">Avance</p><p className="tabular-nums text-muted-foreground">{progress.done} de {progress.total} listos</p></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Ítems listos">
            <div className="h-full rounded-full bg-cw-success transition-[width] duration-500 ease-out" style={{ width: `${progress.percent}%` }} /></div>
        </div> : null}
        {sheet.whyNow.length > 0 ? <div className="mt-7"><h3 className="text-sm font-semibold">Por qué ahora</h3>
          <ol className="mt-3 space-y-2">{sheet.whyNow.map((reason, index) => <li key={index} className="flex gap-3 text-sm leading-6">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden="true">{index + 1}</span><span>{reason}</span></li>)}</ol></div> : null}
        {sheet.nextSteps.length > 0 ? <div className="mt-7"><h3 className="text-sm font-semibold">Qué hacer ahora</h3>
          <ul className="mt-3 space-y-2">{sheet.nextSteps.map((step, index) => <li key={index} className="rounded-2xl bg-muted/40 px-3 py-2.5">
            <MarkedItem markKey={reportItemKey('step', step)} label={step} {...markProps}>
              <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-3">
                <span className="mark-title flex min-w-0 gap-2 text-sm">{!interactive ? <span className="font-semibold tabular-nums text-muted-foreground">{index + 1}.</span> : null}<span>{step}</span></span>
                <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onTask(step, '')}>Crear tarea</Button>
              </div>
            </MarkedItem></li>)}</ul></div> : null}
        {!sheet.written && onGenerate ? <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary/5 p-4">
          <p className="max-w-xl text-sm">Esto es lo que el radar ya sabe. La IA puede escribir la ficha completa: a quién contactar, qué decir y cómo hacer el seguimiento.</p>
          <Button onClick={onGenerate} disabled={generating}><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{generating ? 'Preparando…' : 'Generar ficha comercial'}</Button></div> : null}
      </section>

      {highlighted.length > 0 ? <section aria-label="Destacados" className="rounded-2xl border border-cw-warning/25 bg-cw-warning-soft/60 p-4">
        <h3 className="text-sm font-semibold">Destacados <span className="font-normal tabular-nums text-muted-foreground">{highlighted.length}</span></h3>
        <ul className="mt-2 flex flex-wrap gap-2">{highlighted.map(entry => <li key={entry.key}><a href={`#mark-${entry.key.replace(':', '-')}`} className="block max-w-[22rem] truncate rounded-full bg-background px-3 py-1 text-xs shadow-sm ring-1 ring-cw-warning/20 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{entry.label}</a></li>)}</ul>
      </section> : null}

      {sheet.warnings.length > 0 ? <section aria-label="Antes de decidir" className="rounded-2xl bg-cw-warning-soft p-5">
        <h3 className="text-sm font-semibold">Antes de decidir</h3>
        <ul className="mt-2 space-y-1.5 text-sm">{sheet.warnings.map((warning, index) => <li key={index} className="flex gap-2"><span aria-hidden="true">·</span><span>{warning}</span></li>)}</ul>
      </section> : null}

      <Section id="pulse" title={SECTION_TITLES.pulse} hint={hiring ? hiring.window : undefined}>
        <div className={cn('grid gap-3', hiring ? 'grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2')}>
          {sheet.pulse.kpis.map(kpi => <Kpi key={kpi.label} value={kpi.value} label={kpi.label} note={kpi.note} small={!hiring} />)}
        </div>
        {hiring ? <div className="space-y-6 rounded-3xl border p-5 sm:p-6">
          <div className="grid gap-8 md:grid-cols-2"><BarList title="Cargos que buscan" bars={hiring.roles} />{hiring.regions.length ? <BarList title="Dónde buscan" bars={hiring.regions} /> : null}</div>
          {hiring.pace ? <PaceBars pace={hiring.pace} /> : null}
          {hiring.publishers.length ? <p className="text-xs text-muted-foreground">Publicados en: {hiring.publishers.join(', ')}.</p> : null}
        </div> : post ? <figure className="rounded-3xl border-l-4 border-primary bg-muted/40 p-5">
          <figcaption className="text-xs font-medium text-muted-foreground">{[post.post.author, post.post.when, post.post.ago].filter(Boolean).join(' · ')}</figcaption>
          <blockquote className="mt-2 whitespace-pre-wrap text-[15px] leading-7">{post.post.text}</blockquote>
          {post.post.truncated ? <p className="mt-2 text-xs text-muted-foreground">El texto de la publicación está cortado.</p> : null}
        </figure> : null}
      </Section>

      <Section id="fit" title={SECTION_TITLES.fit}>
        <div className="space-y-5 rounded-3xl border p-5 sm:p-6">
          <FitMeter score={sheet.fit.score} meaning={sheet.fit.meaning} />
          {sheet.fit.services.length > 0 ? <ul className="divide-y">{sheet.fit.services.map(service => <li key={service.service} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className="mt-1.5"><Dots filled={service.strength === 'strong' ? 3 : service.strength === 'medium' ? 2 : 1} /></span>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="font-medium">{service.service}</p><p className="text-xs text-muted-foreground">{STRENGTH_LABELS[service.strength]}</p></div>
              {service.why ? <p className="mt-0.5 text-sm text-muted-foreground">{service.why}</p> : null}</div></li>)}</ul> : null}
          {sheet.fit.gaps.length > 0 ? <div><h4 className="text-sm font-semibold">Lo que habría que respaldar</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">{sheet.fit.gaps.map((gap, index) => <li key={index} className="flex gap-2"><span aria-hidden="true">·</span><span>{gap}</span></li>)}</ul></div> : null}
        </div>
      </Section>

      {has('company') ? <Section id="company" title={SECTION_TITLES.company}>
        {sheet.company.summary ? <p className="max-w-3xl text-[15px] leading-7">{sheet.company.summary}</p> : null}
        {sheet.company.facts.length > 0 ? <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
          {sheet.company.facts.map(fact => <div key={fact.label} className="min-w-0 bg-background px-4 py-3"><dt className="text-xs text-muted-foreground">{fact.label}</dt><dd className="mt-0.5 break-words text-sm font-medium">{fact.value}</dd></div>)}</dl> : null}
      </Section> : null}

      {has('buyers') ? <Section id="buyers" title={SECTION_TITLES.buyers} hint="Cargos que suelen decidir o influir en esta compra. Búscalos en LinkedIn y revisa a quién ya conoces."
        action={onContacts ? <Button variant="outline" size="sm" onClick={onContacts}><Users className="mr-2 h-4 w-4" aria-hidden="true" />Buscar a quién escribir{contactsCount > 0 ? ` · ${contactsCount}` : ''}</Button> : undefined}>
        <ul className="grid gap-3 sm:grid-cols-2">{sheet.buyers.map(buyer => <li key={buyer.title} className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border p-4">
          <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{buyer.title}</p>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', buyer.priority === 'primary' ? 'bg-cw-success-soft text-cw-success' : 'bg-muted text-muted-foreground')}>{buyer.priority === 'primary' ? 'Principal' : 'Apoyo'}</span></div>
            {buyer.why ? <p className="mt-1 text-sm text-muted-foreground">{buyer.why}</p> : null}</div>
          <a href={buyer.searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <Linkedin className="h-3.5 w-3.5" aria-hidden="true" />Buscar en LinkedIn<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></a>
        </li>)}</ul>
      </Section> : null}

      {has('approach') && sheet.approach ? <Section id="approach" title={SECTION_TITLES.approach}>
        <div className="rounded-3xl bg-primary/5 p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Ángulo</p><p className="mt-1.5 max-w-3xl text-[15px] leading-7">{sheet.approach.angle}</p></div>
        {(sheet.approach.hooks.length > 0 || sheet.approach.avoid.length > 0) ? <div className="grid gap-4 md:grid-cols-2">
          {sheet.approach.hooks.length > 0 ? <div className="rounded-2xl border p-4"><h4 className="text-sm font-semibold">Qué mencionar</h4>
            <ul className="mt-2 space-y-1.5 text-sm">{sheet.approach.hooks.map((hook, index) => <li key={index} className="flex gap-2"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-cw-success" aria-hidden="true" /><span>{hook}</span></li>)}</ul></div> : null}
          {sheet.approach.avoid.length > 0 ? <div className="rounded-2xl border p-4"><h4 className="text-sm font-semibold text-destructive">Qué evitar</h4>
            <ul className="mt-2 space-y-1.5 text-sm">{sheet.approach.avoid.map((entry, index) => <li key={index} className="flex gap-2"><span className="mt-0.5 shrink-0 text-destructive" aria-hidden="true">×</span><span>{entry}</span></li>)}</ul></div> : null}
        </div> : null}
      </Section> : null}

      {has('messages') ? <Section id="messages" title={SECTION_TITLES.messages} hint="Cámbiales el nombre y envíalos tú: la ficha no escribe a nadie por su cuenta.">
        <ul className="space-y-3">{sheet.messages.map((message, index) => { const Icon = CHANNEL_ICONS[message.channel]; return <li key={index} className="overflow-hidden rounded-2xl border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{message.channelLabel}{message.subject ? ` · ${message.subject}` : ''}</span></p>
            <span className="flex items-center gap-2">{message.channel === 'linkedin' ? <span className={cn('text-xs tabular-nums', message.body.length > 300 ? 'text-destructive' : 'text-muted-foreground')}>{message.body.length} / 300</span> : null}
              <CopyButton text={message.subject ? `${message.subject}\n\n${message.body}` : message.body} /></span></div>
          <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6">{message.body}</p></li>; })}</ul>
      </Section> : null}

      {has('cadence') ? <Section id="cadence" title={SECTION_TITLES.cadence}><div className="rounded-3xl border p-5 sm:p-6"><Timeline steps={sheet.cadence} /></div></Section> : null}

      {has('objections') ? <Section id="objections" title={SECTION_TITLES.objections}>
        <div className="divide-y rounded-2xl border">{sheet.objections.map((entry, index) => <details key={index} className="group p-4">
          <summary className="cursor-pointer list-none rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex items-center justify-between gap-3">{entry.objection}<span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span></span></summary>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{entry.answer}</p></details>)}</div>
      </Section> : null}

      {has('validate') ? <Section id="validate" title={SECTION_TITLES.validate}>
        <ul className="divide-y rounded-2xl border">{sheet.validate.map(entry => <li key={entry.title} className="p-4">
          <MarkedItem markKey={reportItemKey('requirement', entry.title)} label={entry.title} {...markProps}>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="mark-title min-w-0 font-medium">{entry.title}</p>
              <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onTask(entry.action || entry.title, '')}>Crear tarea</Button></div>
            {entry.action ? <p className="mt-1.5 text-sm">{entry.action}</p> : null}
            {entry.owner ? <p className="mt-1 text-xs text-muted-foreground">{entry.owner}</p> : null}
          </MarkedItem></li>)}</ul>
      </Section> : null}

      {has('plan') ? <Section id="plan" title={SECTION_TITLES.plan}>
        <ol className="divide-y rounded-2xl border">{sheet.plan.map(entry => <li key={entry.title} className="p-4">
          <MarkedItem markKey={reportItemKey('task', entry.title)} label={entry.title} {...markProps}>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="mark-title min-w-0 font-medium">{entry.title}</p>
              <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onTask(entry.title, entry.result)}>Crear tarea</Button></div>
            {entry.owner ? <p className="mt-1 text-xs text-muted-foreground">{entry.owner}</p> : null}
            {entry.result ? <p className="mt-2 text-sm text-muted-foreground">Resultado: {entry.result}</p> : null}
          </MarkedItem></li>)}</ol>
      </Section> : null}

      {has('risks') ? <Section id="risks" title={SECTION_TITLES.risks}>
        <ul className="divide-y rounded-2xl border">{sheet.risks.map(risk => <li key={risk.title} className="p-4">
          <MarkedItem markKey={reportItemKey('risk', risk.title)} label={risk.title} checkable={false} {...markProps}>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="mark-title min-w-0 font-medium">{risk.title}</p>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', IMPACT_TONES[risk.impact])}>{IMPACT_LABELS[risk.impact] ?? risk.impact}</span></div>
            <p className="mt-1.5 text-sm">{risk.mitigation}</p>
          </MarkedItem></li>)}</ul>
      </Section> : null}

      {has('questions') ? <Section id="questions" title={SECTION_TITLES.questions}>
        <ol className="space-y-2 text-sm">{sheet.questions.map((question, index) => <li key={question} className="rounded-xl px-1">
          <MarkedItem markKey={reportItemKey('question', question)} label={question} checkable={false} {...markProps}>
            <p className="mark-title"><span className="mr-1.5 tabular-nums text-muted-foreground">{index + 1}.</span>{question}</p>
          </MarkedItem></li>)}</ol>
      </Section> : null}

      {has('sample') ? <Section id="sample" title={SECTION_TITLES.sample} hint="Algunos de los avisos que vio el radar, para abrirlos y leerlos tú.">
        <ul className="divide-y rounded-2xl border">{sheet.sample.map((ad, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <div className="min-w-0"><p className="font-medium">{ad.title}</p><p className="text-xs text-muted-foreground">{[ad.where, ad.when, ad.publisher].filter(Boolean).join(' · ')}</p></div>
          {ad.url ? <a href={ad.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Abrir aviso<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}</li>)}</ul>
      </Section> : null}

      {missing.length > 0 ? <Section id="pending" title={SECTION_TITLES.pending}>
        <div className="rounded-3xl border p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3 text-sm"><p className="font-medium">{sheet.completeness.done} de {sheet.completeness.total} partes listas</p><p className="tabular-nums text-muted-foreground">{sheet.completeness.percent} %</p></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sheet.completeness.percent} aria-label="Partes de la ficha listas"><div className="h-full rounded-full bg-cw-success" style={{ width: `${sheet.completeness.percent}%` }} /></div>
          <ul className="mt-4 space-y-2">{missing.map(entry => <li key={entry.key} className="flex items-start gap-2.5 text-sm"><Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" /><span><span className="font-medium">{entry.label}</span>{entry.action ? <span className="text-muted-foreground"> · {entry.action}</span> : null}</span></li>)}</ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {missing.some(entry => entry.key !== 'contacts') && onGenerate ? <Button variant="outline" size="sm" onClick={onGenerate} disabled={generating}><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{sheet.written ? 'Actualizar ficha' : 'Generar ficha comercial'}</Button> : null}
            {missing.some(entry => entry.key === 'contacts') && onContacts ? <Button variant="outline" size="sm" onClick={onContacts}><Users className="mr-2 h-4 w-4" aria-hidden="true" />Buscar contactos</Button> : null}
          </div>
        </div>
      </Section> : null}

      <section aria-label="Preguntar a la IA" className="rounded-2xl border bg-muted/30 p-5">
        <h3 className="flex items-center gap-2 font-semibold"><MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />¿Dudas? Pregúntale a la IA</h3>
        <p className="mt-1 text-sm text-muted-foreground">Responde con lo que sabemos de esta empresa y te muestra de dónde lo sacó.</p>
        <div className="mt-3 flex flex-wrap gap-2">{SUGGESTED.map(question => <Button key={question} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => onAsk(question)}>{question}</Button>)}</div>
      </section>
    </article>

    <nav aria-label="En esta ficha" className="hidden lg:block">
      <div className="sticky top-20 space-y-1 border-l pl-3 text-sm">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" />En esta ficha</p>
        {sections.filter(id => id !== 'summary').map(id => <a key={id} href={`#sheet-${id}`} className="block rounded py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{SECTION_TITLES[id]}</a>)}
      </div>
    </nav>
  </div>;
}
