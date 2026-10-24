'use client';
// While a report is prepared: one quiet row with the four steps the job really goes through (report-progress.ts), the current
// one marked, and one line that says what is happening right now (OPP-46). A step is done only when the job moved on, and reading
// counts the parts the job read. The only estimate is the time left: from the size of the documents, then from this report's own pace.
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { REPORT_STAGES, reportMinutesLeft, type ReportJobProgress, type ReportStage } from '@/lib/commercial-opportunities/report-progress';

type Seat = 'waiting' | 'working' | 'done';
type Props = { progress: ReportJobProgress; signal?: boolean; tender?: boolean; documents: number; buyer?: string | null };

const STEPS: Record<ReportStage, (signal?: boolean) => string> = {
  gather: () => 'Documentos', buyer: signal => (signal ? 'Empresa' : 'Comprador'), read: () => 'Lectura', write: signal => (signal ? 'Ficha' : 'Informe'),
};
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

/** What each step is doing: in full for the headline, short under the step (`desk`), so the card does not say it twice. */
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

/** About the time left (OPP-19), never a fixed promise: what the size suggests, then the pace of the parts read; nothing honest, nothing. */
function timeLeft(progress: ReportJobProgress, now: number): string {
  if (progress.stage === 'write') return 'Falta poco.';
  const minutes = reportMinutesLeft(progress, now);
  if (!minutes) return '';
  if (minutes > 60) return 'Va más lento de lo habitual: puede tardar más de una hora.';
  const going = progress.stage === 'read' && progress.read > 0;
  if (minutes === 1) return going ? 'Queda alrededor de un minuto.' : 'Tardará alrededor de un minuto.';
  return going ? `Quedan unos ${minutes} minutos.` : `Tardará unos ${minutes} minutos.`;
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
  // Writing shows its seconds; otherwise the time left is worked out again every half minute and with each new part read.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), writing ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [writing, progress.since, progress.stage, progress.read]);
  const seats = REPORT_STAGES.map(stage => ({ stage, seat: seatOf(stage, props.progress) }));
  const active = seats.find(item => item.seat === 'working');
  const headline = progress.stage === 'queued' ? 'En cola: empieza en menos de un minuto'
    : active ? deskLine(active.stage, 'working', props) : 'Preparando…';
  const time = writingTime(progress, now);
  const reading = progress.stage === 'read' && progress.total ? Math.min(progress.read / progress.total, 1) : 0;

  return <div className="rounded-2xl border bg-muted/30 p-4 sm:p-5">
    <p className="flex min-w-0 items-start gap-2.5 text-sm font-medium">
      <span aria-hidden="true" className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
      {/* The time ticks every second, so it stays out of what a screen reader announces. */}
      <span className="min-w-0 break-words"><span role="status" aria-live="polite">{headline}</span>
        {time && <span className="font-normal text-muted-foreground"> · lleva {time}</span>}</span>
    </p>

    <ol aria-label={signal ? 'Pasos de la ficha' : 'Pasos del informe'} className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
      {seats.map(({ stage, seat }) => <li key={stage} aria-current={seat === 'working' ? 'step' : undefined} className="flex min-w-0 items-start gap-2">
        <StepMark seat={seat} />
        <span className="min-w-0">
          <span className={cn('block text-xs font-medium', seat === 'waiting' && 'text-muted-foreground')}>{STEPS[stage](signal)}</span>
          <span className="line-clamp-2 block text-[11px] leading-4 text-muted-foreground">
            {seat === 'done' && <span className="sr-only">Listo: </span>}{deskLine(stage, seat, props, true)}
          </span>
        </span>
      </li>)}
    </ol>

    <div aria-hidden="true" className="mt-3 grid grid-cols-4 gap-1">
      {/* Only reading is counted; the other steps say they are under way without making up how far. */}
      {seats.map(({ stage, seat }) => <div key={stage} className="h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full bg-primary transition-[width] duration-700 ease-out',
          seat === 'working' && stage !== 'read' && 'bg-primary/50 motion-safe:animate-pulse')}
          style={{ width: seat === 'done' ? '100%' : seat === 'working' ? (stage === 'read' ? `${Math.max(Math.round(reading * 1000) / 10, 4)}%` : '100%') : '0%' }} />
      </div>)}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{[timeLeft(progress, now), `Puedes seguir trabajando: ${signal ? 'la ficha' : 'el informe'} aparecerá aquí y te avisaremos.`].filter(Boolean).join(' ')}</p>
  </div>;
}

/** Done (a check), under way (a dot in a ring) or waiting (an empty ring). Decorative: the step's line says the same in words. */
function StepMark({ seat }: { seat: Seat }) {
  if (seat === 'done') return <span aria-hidden="true" className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>;
  if (seat === 'working') return <span aria-hidden="true" className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-2 ring-inset ring-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" /></span>;
  return <span aria-hidden="true" className="mt-px h-4 w-4 shrink-0 rounded-full ring-2 ring-inset ring-muted-foreground/25" />;
}
