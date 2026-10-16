'use client';
// The «oficina» while a report is prepared: four characters, one per stage the job really goes through (report-progress.ts),
// and one line that says what is happening right now. Nothing here is an estimate: a stage is done only when the job moved on,
// and reading counts the parts the job read.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { REPORT_STAGES, type ReportJobProgress, type ReportStage } from '@/lib/commercial-opportunities/report-progress';

type Seat = 'waiting' | 'working' | 'done';
type Props = { progress: ReportJobProgress; signal?: boolean; tender?: boolean; documents: number; buyer?: string | null };

const NAMES: Record<ReportStage, string> = { gather: 'Mensajero', buyer: 'Becario', read: 'Analista', write: 'Jefe' };
// Writing usually takes 2 to 4 minutes; past this, the start belongs to an earlier attempt and the time would mislead.
const ELAPSED_LIMIT_MS = 15 * 60_000;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const elapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
};

function seatOf(stage: ReportStage, progress: ReportJobProgress): Seat {
  if (progress.stage === 'queued') return 'waiting';
  const at = REPORT_STAGES.indexOf(progress.stage);
  const own = REPORT_STAGES.indexOf(stage);
  return own < at ? 'done' : own === at ? 'working' : 'waiting';
}

/** What each character is doing: in full for the headline, short for its desk (`desk`), so the card does not say it twice. */
function deskLine(stage: ReportStage, seat: Seat, props: Props, desk = false): string {
  const { progress, signal, tender, documents, buyer } = props;
  if (seat === 'waiting') return 'En espera';
  if (stage === 'gather') {
    if (seat === 'done') return documents ? `Reunió ${plural(documents, 'documento', 'documentos')}` : 'Revisó las fuentes';
    if (desk) return 'Trae los documentos';
    return signal ? 'Trae la publicación y sus enlaces' : tender ? 'Trae los formularios y el foro desde Mercado Público' : 'Reúne los documentos y enlaces';
  }
  if (stage === 'buyer') {
    if (seat === 'done') return 'Revisó fuentes públicas';
    if (desk) return signal ? 'Investiga a la empresa' : 'Investiga al comprador';
    return `Busca quién es ${buyer?.trim() || (signal ? 'la empresa' : 'el comprador')} en fuentes públicas`;
  }
  if (stage === 'read') {
    if (seat === 'done') return progress.total ? `Leyó ${plural(progress.total, 'parte', 'partes')}` : 'Leyó los documentos';
    if (!progress.total) return 'Ordena los documentos para leerlos';
    const part = Math.min(progress.read + 1, progress.total);
    if (desk) return `Parte ${part} de ${progress.total}`;
    return `${progress.document ? `Lee «${progress.document}» · ` : 'Lee '}parte ${part} de ${progress.total}`;
  }
  return desk ? (signal ? 'Escribe la ficha' : 'Escribe el informe') : signal ? 'Escribe la ficha comercial' : 'Escribe el informe y decide si conviene postular';
}

/** How long writing has taken, while it is believable. */
function writingTime(progress: ReportJobProgress, now: number): string | null {
  const since = progress.stage === 'write' && progress.since ? now - Date.parse(progress.since) : null;
  return since !== null && since >= 0 && since < ELAPSED_LIMIT_MS ? elapsed(since) : null;
}

export function ReportOffice(props: Props) {
  const { progress, signal } = props;
  const writing = progress.stage === 'write' && Boolean(progress.since);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!writing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [writing, progress.since]);

  const seats = REPORT_STAGES.map(stage => ({ stage, seat: seatOf(stage, props.progress) }));
  const active = seats.find(item => item.seat === 'working');
  const headline = progress.stage === 'queued' ? 'En cola: la oficina empieza en menos de un minuto'
    : active ? `${NAMES[active.stage]} · ${deskLine(active.stage, 'working', props)}` : 'Preparando…';
  const time = writingTime(progress, now);
  const reading = progress.stage === 'read' && progress.total ? Math.min(progress.read / progress.total, 1) : 0;

  return <div className="rounded-2xl border bg-muted/30 p-4 sm:p-5">
    <p className="flex min-w-0 items-start gap-2.5 text-sm font-medium">
      <span aria-hidden="true" className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
      {/* The time ticks every second, so it stays out of what a screen reader announces. */}
      <span className="min-w-0 break-words"><span role="status" aria-live="polite">{headline}</span>
        {time && <span className="font-normal text-muted-foreground"> · lleva {time}</span>}</span>
    </p>

    <ol aria-label="Quién trabaja en tu informe" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {seats.map(({ stage, seat }) => <li key={stage}
        className={cn('flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-2 pb-3 pt-2 text-center transition-colors duration-300',
          seat === 'working' ? 'bg-background shadow-sm ring-1 ring-border' : 'bg-transparent')}>
        <Ghost stage={stage} seat={seat} />
        <span className={cn('text-xs font-semibold', seat === 'waiting' && 'text-muted-foreground')}>{NAMES[stage]}</span>
        <span className={cn('line-clamp-3 text-[11px] leading-4 text-muted-foreground', seat === 'done' && 'text-foreground/80')}>
          {seat === 'done' && <span className="sr-only">Listo: </span>}{deskLine(stage, seat, props, true)}
        </span>
      </li>)}
    </ol>

    <div aria-hidden="true" className="mt-3 grid grid-cols-4 gap-1">
      {/* Only reading is counted; the other stages say they are under way without making up how far. */}
      {seats.map(({ stage, seat }) => <div key={stage} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full bg-primary transition-[width] duration-700 ease-out',
          seat === 'working' && stage !== 'read' && 'bg-primary/50 motion-safe:animate-pulse')}
          style={{ width: seat === 'done' ? '100%' : seat === 'working' ? (stage === 'read' ? `${Math.max(Math.round(reading * 1000) / 10, 4)}%` : '100%') : '0%' }} />
      </div>)}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Suele tardar entre {signal ? '1 y 3' : '2 y 5'} minutos. Puedes seguir trabajando: {signal ? 'la ficha' : 'el informe'} aparecerá aquí y te avisaremos.</p>
  </div>;
}

/** One office ghost: the same body for all, and what each one carries says its job. Decorative: its desk says the same in words. */
function Ghost({ stage, seat }: { stage: ReportStage; seat: Seat }) {
  return <span aria-hidden="true" className={cn('relative inline-flex h-16 w-14 items-end justify-center transition-opacity duration-300',
    seat === 'waiting' && 'opacity-45', seat === 'working' && 'motion-safe:animate-ghost-float')}>
    <svg viewBox="0 0 48 52" className="h-16 w-14 overflow-visible">
      {seat === 'working' && <ellipse cx="24" cy="49" rx="13" ry="2.2" className="fill-primary/15" />}
      <path d="M24 5C13.5 5 7 12.5 7 22.5V44l4.25-3 4.25 3 4.25-3 4.25 3 4.25-3 4.25 3 4.25-3L41 44V22.5C41 12.5 34.5 5 24 5Z"
        className="fill-background stroke-foreground/35" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="19" cy="22" r="1.9" className="fill-foreground" />
      <circle cx="29" cy="22" r="1.9" className="fill-foreground" />
      {seat === 'done' && <path d="M20.5 28.5c1.9 1.6 5.1 1.6 7 0" className="fill-none stroke-foreground" strokeWidth="1.4" strokeLinecap="round" />}
      <g className="text-primary">
        {stage === 'gather' && <>
          <path d="M11.2 14.4C13.5 7.6 34.5 7.6 36.8 14.4Z" className="fill-current" />
          <rect x="31" y="12.6" width="10.5" height="2.6" rx="1.3" className="fill-current" />
          <rect x="28.5" y="30" width="14" height="10" rx="1.6" className="fill-background stroke-current" strokeWidth="1.5" />
          <path d="M29 31l6.5 5 6.5-5" className="fill-none stroke-current" strokeWidth="1.5" strokeLinejoin="round" />
        </>}
        {stage === 'buyer' && <>
          <circle cx="35" cy="33" r="5" className="fill-background stroke-current" strokeWidth="1.8" />
          <path d="M38.6 36.6l4.6 4.6" className="stroke-current" strokeWidth="2.2" strokeLinecap="round" />
          <rect x="13" y="30" width="7" height="9" rx="1.2" className="fill-current opacity-80" />
        </>}
        {stage === 'read' && <>
          <circle cx="19" cy="22" r="4.2" className="fill-none stroke-current" strokeWidth="1.5" />
          <circle cx="29" cy="22" r="4.2" className="fill-none stroke-current" strokeWidth="1.5" />
          <path d="M23.2 22h1.6" className="stroke-current" strokeWidth="1.5" />
          <rect x="13" y="31" width="22" height="11" rx="1.6" className="fill-background stroke-current" strokeWidth="1.5" />
          <path d="M10.5 43.5h27" className="stroke-current" strokeWidth="2" strokeLinecap="round" />
          <path d="M17 35h8M17 38h12" className="stroke-current opacity-70" strokeWidth="1.3" strokeLinecap="round" />
        </>}
        {stage === 'write' && <>
          <path d="M21.6 27h4.8l-1 2.6h-2.8Z" className="fill-current" />
          <path d="M22.8 29.6h2.4l1.6 9.4-2.8 2.8-2.8-2.8Z" className="fill-current" />
        </>}
      </g>
      {seat === 'done' && <g>
        <circle cx="40" cy="9" r="6" className="fill-primary" />
        <path d="M37.3 9.1l1.9 1.9 3.6-3.8" className="fill-none stroke-primary-foreground" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>}
    </svg>
  </span>;
}
