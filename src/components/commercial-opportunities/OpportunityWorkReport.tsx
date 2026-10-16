'use client';
// The report as one document: the decision and what to do now on top, then requirements, plan, risks, questions and the
// detailed analysis, with a short index. A LinkedIn signal reads as a commercial plan, not as a tender.
import { useMemo, useState } from 'react';
import { Award, Check, Copy, Flag, Highlighter, Hourglass, ListChecks, MessageCircleQuestion, PenLine, Phone, Upload, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { opportunityFinancialScenario } from '@/lib/commercial-opportunities/workspace';
import { IMPACT_LABELS, consultationEmail, humanDate, isSignalReport, opportunityReportWarnings, reportDecision, reportKeyDates, reportNextSteps, statusLabel } from '@/lib/commercial-opportunities/report-view';
import { parseReportDate, reportChecklist, reportItemKey, reportProgress, reportRoute, type ReportMark, type ReportMarks } from '@/lib/commercial-opportunities/report-marks';
import { RoutePath, type RouteNode } from './RoutePath';
import { MarkedItem, ReminderMenu, useReportMarks, type MarkChange } from './ReportMarks';

const TONES = { go: 'bg-cw-success-soft text-cw-success', evaluate: 'bg-cw-warning-soft text-cw-warning', no: 'bg-muted text-muted-foreground', pending: 'bg-muted text-muted-foreground' };
const IMPACT_TONES: Record<string, string> = { high: 'bg-destructive/10 text-destructive', medium: 'bg-cw-warning-soft text-cw-warning', low: 'bg-muted text-muted-foreground' };
const REQUIREMENT_TONES: Record<string, string> = { blocked: 'text-destructive', pending: 'text-cw-warning', unknown: 'text-muted-foreground', supported: 'text-muted-foreground' };
export const SUGGESTED_QUESTIONS = {
  tender: ['¿Qué documentos tengo que preparar para postular?', '¿Cuál es la fecha de cierre y hasta cuándo puedo hacer consultas?', '¿Cómo se evalúan las ofertas?', '¿Qué garantías y multas hay?'],
  signal: ['¿A quién debería contactar primero?', '¿Qué le digo en el primer mensaje?', '¿Qué sabemos de esta empresa?'],
};

type Opportunity = { title: string; buyer?: string | null; deadline?: string | null; amount?: number | null; currency?: string | null };
const ROUTE_ICONS: Record<string, typeof PenLine> = { prepare: PenLine, ask: MessageCircleQuestion, submit: Upload, wait: Hourglass, decide: Award, contact: Phone };
export function OpportunityWorkReport({ report, opportunity, onTask, onAsk, onContacts, marks: initialMarks, onMark, people }: {
  report: OpportunityReport & { route?: { steps: Array<{ title: string; detail: string; date: string; kind: 'prepare' | 'ask' | 'submit' | 'wait' | 'decide' | 'contact' }> } | null };
  opportunity: Opportunity; onTask: (title: string, evidence: string) => void;
  onAsk: (question: string) => void; onContacts?: () => void;
  /** The team's marks; absent while the table does not exist, and then the report reads as before. */
  marks?: { available: boolean; items: ReportMarks } | null;
  onMark?: (change: MarkChange) => Promise<ReportMark | null>;
  people?: Array<{ user_id: string; name: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const { interactive, marks, saving, change } = useReportMarks(initialMarks, onMark);
  const itemMarks = interactive ? marks : null;
  const authorOf = (id?: string | null) => people?.find(p => p.user_id === id)?.name ?? null;
  const whenOf = (at?: string | null) => humanDate(at, true);
  const markProps = { marks: itemMarks, disabled: saving, onChange: (input: MarkChange) => void change(input), authorOf, whenOf };
  const signal = isSignalReport(report);
  const decision = reportDecision(report);
  const dates = reportKeyDates(report, opportunity.deadline);
  const steps = reportNextSteps(report);
  const route = reportRoute(report);
  // Reports made before version 4 can carry system notes; the person only sees what to know or get.
  const warnings = opportunityReportWarnings(report.warnings, [], false);
  const blocking = report.requirements.filter(r => r.status === 'blocked').length;
  const money = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
  const facts = signal ? [] : [
    ['Cierre', dates.closes ?? 'Por confirmar'],
    ['Consultas hasta', dates.questions ?? 'Por confirmar'],
    ['Monto', opportunity.amount ? `${money(opportunity.amount)} ${opportunity.currency || ''}`.trim() : 'No informado'],
    ['Requisitos', report.requirements.length ? `${report.requirements.length}${blocking ? ` · ${blocking} bloquean` : ''}` : 'Sin bases leídas'],
  ];
  const sections = ([
    ['next', 'Qué hacer ahora', true],
    ['route', signal ? 'Ruta comercial' : 'Ruta de la postulación', route.length >= 3],
    ['dates', 'Fechas clave', report.milestones.length > 0],
    ['requirements', signal ? 'Qué validar' : 'Requisitos', report.requirements.length > 0],
    ['plan', signal ? 'Pasos comerciales' : 'Plan de trabajo', report.tasks.length > 0],
    ['risks', 'Riesgos', report.risks.length > 0],
    ['questions', signal ? 'Preguntas para conversar' : 'Preguntas al comprador', report.questions.length > 0],
    ['numbers', 'Números', report.scenarios.length > 0],
    ['analysis', 'Análisis detallado', report.sections.length > 0],
    ['sources', 'Documentos leídos', report.coverage.length > 0],
  ] as Array<[string, string, boolean]>).filter(([, , shown]) => shown);
  const copyEmail = async () => {
    const text = consultationEmail(report, { title: opportunity.title, buyer: opportunity.buyer });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt('Copia el correo de consultas', text); }
  };
  const checklist = useMemo(() => reportChecklist(report, steps), [report, steps]);
  const progress = reportProgress(checklist, marks);
  const routeNodes: RouteNode[] = route.map((step, index) => {
    const done = Boolean(marks[step.key]?.done);
    const firstOpen = route.findIndex(other => !marks[other.key]?.done);
    return { id: step.key, title: step.title, meta: step.date || null, detail: step.detail || null, icon: (() => { const Icon = ROUTE_ICONS[step.kind]; return Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : undefined; })(),
      state: done ? 'done' : index === firstOpen ? 'current' : 'next',
      action: interactive ? <button type="button" role="checkbox" aria-checked={done} disabled={saving} onClick={() => void change({ key: step.key, label: step.title, done: !done })}
        className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        {done ? 'Hecho · deshacer' : 'Marcar hecho'}</button> : null };
  });
  const labels = new Map<string, string>([...checklist.map(item => [item.key, item.label] as const),
    ...report.milestones.map(m => [reportItemKey('date', m.label), m.label] as const), ...report.risks.map(r => [reportItemKey('risk', r.title), r.title] as const),
    ...report.questions.map(q => [reportItemKey('question', q), q] as const)]);
  const highlighted = interactive ? Object.values(marks).filter(m => m.highlight && labels.has(m.key)) : [];
  const datedMilestones = report.milestones.flatMap(m => { const parsed = parseReportDate(m.date); return parsed ? [{ uid: reportItemKey('date', m.label), label: m.label, date: m.date, at: parsed.at }] : []; })
    .filter(event => event.at.getTime() > Date.now());
  const heading = (id: string, title: string, count?: number) =>
    <h3 id={`report-${id}`} className="scroll-mt-24 text-lg font-semibold">{title}{count ? <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{count}</span> : null}</h3>;

  const jump = (key: string) => document.getElementById(`mark-${key.replace(':', '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
    <article className="min-w-0 space-y-10">
      <section aria-labelledby="report-next" className="rounded-3xl border bg-background p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', TONES[decision.tone])}>{decision.label}</span>
          <span className="text-xs text-muted-foreground">Preparado el {humanDate(report.generatedAt) ?? 'hoy'}</span>
        </div>
        <p className="mt-4 max-w-3xl text-[15px] leading-7 text-foreground/90">{report.executive}</p>
        {facts.length > 0 && <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
          {facts.map(([label, value]) => <div key={label} className="min-w-0 bg-background px-4 py-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm font-semibold">{value}</dd></div>)}
        </dl>}
        {interactive && progress.total > 0 && <div className="mt-6 space-y-2" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <p className="font-medium">{signal ? 'Avance' : 'Avance de la postulación'}</p>
            <p className="tabular-nums text-muted-foreground">{progress.done} de {progress.total} listos</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Ítems listos">
            <div className="h-full rounded-full bg-cw-success transition-[width] duration-500 ease-out" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>}
        <h3 id="report-next" className="mt-7 text-sm font-semibold">Qué hacer ahora</h3>
        <ol className="mt-3 space-y-2">
          {steps.map((step, i) => <li key={i} className="rounded-2xl bg-muted/40 px-3 py-2.5">
            <MarkedItem markKey={reportItemKey('step', step)} label={step} {...markProps}>
              <div className="flex items-start justify-between gap-3">
                <span className="mark-title flex min-w-0 gap-2 text-sm">{!interactive && <span className="font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>}<span>{step}</span></span>
                <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onTask(step, '')}>Crear tarea</Button>
              </div>
            </MarkedItem>
          </li>)}
        </ol>
        {report.reasons.length > 0 && <ul className="mt-5 space-y-1.5 text-sm text-muted-foreground">{report.reasons.map((r, i) => <li key={i} className="flex gap-2"><span aria-hidden="true">·</span><span>{r}</span></li>)}</ul>}
        {signal && onContacts && <Button variant="outline" className="mt-5" onClick={onContacts}><Users className="mr-2 h-4 w-4" aria-hidden="true" />Buscar a quién contactar</Button>}
      </section>

      {highlighted.length > 0 && <section aria-label="Destacados" className="rounded-2xl border border-cw-warning/25 bg-cw-warning-soft/60 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Highlighter className="h-4 w-4 text-cw-warning" aria-hidden="true" />Destacados <span className="font-normal tabular-nums text-muted-foreground">{highlighted.length}</span></h3>
        <ul className="mt-2 flex flex-wrap gap-2">{highlighted.map(m => <li key={m.key}>
          <button type="button" onClick={() => jump(m.key)} className="max-w-[22rem] truncate rounded-full bg-background px-3 py-1 text-left text-xs shadow-sm ring-1 ring-cw-warning/20 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{labels.get(m.key)}</button>
        </li>)}</ul>
      </section>}

      {warnings.length > 0 && <section aria-label="Antes de decidir" className="rounded-2xl bg-cw-warning-soft p-5">
        <h3 className="text-sm font-semibold">Antes de decidir</h3>
        <ul className="mt-2 space-y-1.5 text-sm">{warnings.map((w, i) => <li key={i} className="flex gap-2"><span aria-hidden="true">·</span><span>{w}</span></li>)}</ul>
      </section>}

      {route.length >= 3 && <section aria-labelledby="report-route" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>{heading('route', signal ? 'Ruta comercial' : 'Ruta de la postulación')}
            <p className="mt-1 text-sm text-muted-foreground">{report.route?.steps?.length ? 'La IA ordenó los pasos según las fechas y lo que piden los documentos.' : 'Los pasos del plan y las fechas del informe, en orden.'}</p></div>
          <Flag className="h-5 w-5 text-muted-foreground/60" aria-hidden="true" />
        </div>
        <div className="rounded-3xl border bg-gradient-to-b from-muted/30 to-background px-3 py-6 sm:px-6"><RoutePath nodes={routeNodes} label={signal ? 'Ruta comercial' : 'Ruta de la postulación'} /></div>
      </section>}

      {report.milestones.length > 0 && <section aria-labelledby="report-dates" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">{heading('dates', 'Fechas clave')}
          {datedMilestones.length > 1 && <ReminderMenu title={opportunity.title} events={datedMilestones} label="Recordatorios de todas" />}</div>
        <ol className="space-y-3 border-l-2 border-primary/30 pl-4">{report.milestones.map((m, i) => { const key = reportItemKey('date', m.label); const event = datedMilestones.find(e => e.uid === key); return <li key={i}>
          <MarkedItem markKey={key} label={m.label} checkable={false} {...markProps}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="mark-title text-sm font-medium">{m.label}</p><p className="text-sm text-muted-foreground">{m.date}</p></div>
              {event && <ReminderMenu title={opportunity.title} events={[event]} compact />}
            </div>
          </MarkedItem></li>; })}</ol>
      </section>}

      {report.requirements.length > 0 && <section aria-labelledby="report-requirements" className="space-y-3">
        {heading('requirements', signal ? 'Qué validar con la empresa' : 'Requisitos para postular', report.requirements.length)}
        <ul className="divide-y rounded-2xl border">{report.requirements.map((r, i) => <li key={i} className="p-4">
          <MarkedItem markKey={reportItemKey('requirement', r.title)} label={r.title} {...markProps}>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="mark-title min-w-0 font-medium">{r.title}</p>
              <span className={cn('shrink-0 text-xs font-medium', REQUIREMENT_TONES[r.status])}>{statusLabel(r.status)}</span></div>
            {r.action && <p className="mt-1.5 text-sm">{r.action}</p>}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{[r.role, r.due].filter(Boolean).join(' · ')}</p>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onTask(r.action || r.title, r.evidence.map(e => e.quote).join('\n'))}>Crear tarea</Button>
            </div>
          </MarkedItem>
        </li>)}</ul>
      </section>}

      {report.tasks.length > 0 && <section aria-labelledby="report-plan" className="space-y-3">
        {heading('plan', signal ? 'Pasos comerciales' : 'Plan de trabajo', report.tasks.length)}
        <ol className="divide-y rounded-2xl border">{report.tasks.map((t, i) => <li key={i} className="p-4">
          <MarkedItem markKey={reportItemKey('task', t.title)} label={t.title} {...markProps}>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="mark-title min-w-0 font-medium">{t.title}</p>
              <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onTask(t.title, t.evidence)}>Crear tarea</Button></div>
            <p className="mt-1 text-xs text-muted-foreground">{[t.role, t.due].filter(Boolean).join(' · ')}</p>
            {(t.dependency || t.evidence) && <p className="mt-2 text-sm text-muted-foreground">{[t.dependency && `Antes: ${t.dependency}`, t.evidence && `Resultado: ${t.evidence}`].filter(Boolean).join(' · ')}</p>}
          </MarkedItem>
        </li>)}</ol>
      </section>}

      {report.risks.length > 0 && <section aria-labelledby="report-risks" className="space-y-3">
        {heading('risks', 'Riesgos y cómo cubrirlos', report.risks.length)}
        <ul className="divide-y rounded-2xl border">{report.risks.map((r, i) => <li key={i} className="p-4">
          <MarkedItem markKey={reportItemKey('risk', r.title)} label={r.title} checkable={false} {...markProps}>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="mark-title min-w-0 font-medium">{r.title}</p>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', IMPACT_TONES[r.impact])}>{IMPACT_LABELS[r.impact] ?? r.impact}</span></div>
            <p className="mt-1.5 text-sm">{r.mitigation}</p>
          </MarkedItem>
        </li>)}</ul>
      </section>}

      {report.questions.length > 0 && <section aria-labelledby="report-questions" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {heading('questions', signal ? 'Preguntas para la primera conversación' : 'Preguntas para el comprador', report.questions.length)}
          {!signal && <Button variant="outline" size="sm" onClick={() => void copyEmail()}>
            {copied ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />}{copied ? 'Correo copiado' : 'Copiar como correo de consultas'}</Button>}
        </div>
        {!signal && dates.questions && <p className="text-sm text-muted-foreground">Envíalas antes del cierre de consultas: {dates.questions}.</p>}
        <ol className="space-y-2 text-sm">{report.questions.map((q, i) => <li key={i} className="rounded-xl px-1">
          <MarkedItem markKey={reportItemKey('question', q)} label={q} checkable={false} {...markProps}>
            <p className="mark-title"><span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>{q}</p>
          </MarkedItem></li>)}</ol>
      </section>}

      {report.scenarios.length > 0 && <section aria-labelledby="report-numbers" className="space-y-3">
        {heading('numbers', 'Números')}
        {report.scenarios.map((s, i) => { const result = opportunityFinancialScenario(s); return <div key={i} className="rounded-2xl border p-5">
          <h4 className="font-medium">{s.name}</h4>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{[['Precio neto mensual', result.monthlyNet], ['Precio neto total', result.totalNet], ['Total con impuestos', result.totalWithTax], ['Capital de trabajo', result.workingCapital], ['Garantía', result.guarantee]].map(([label, value]) =>
            <div key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-base font-semibold tabular-nums">{value === null ? 'Por confirmar' : money(Number(value))}</dd></div>)}</dl>
          {s.assumptions.length > 0 && <ul className="mt-4 space-y-1 text-xs text-muted-foreground">{s.assumptions.map((a, j) => <li key={j}>Supuesto: {a}</li>)}</ul>}
        </div>; })}
      </section>}

      {report.sections.length > 0 && <section aria-labelledby="report-analysis" className="space-y-3">
        {heading('analysis', 'Análisis detallado')}
        <div className="divide-y rounded-2xl border">{report.sections.map(section => <details key={section.id} className="group p-4">
          <summary className="cursor-pointer list-none rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex items-center justify-between gap-3">{section.title}<span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span></span></summary>
          <div className="mt-3 space-y-3">{section.paragraphs.map((p, i) => <p key={i} className="whitespace-pre-wrap text-sm leading-7">{p}</p>)}
            {section.facts.map((f, i) => <div key={i} className="rounded-xl bg-muted/40 p-3"><p className="text-sm leading-6">{f.text}</p>
              {f.citations.map((c, j) => { const source = report.sources.find(s => s.id === c.chunkId); return <details key={j} className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2">Fuente: {source?.name || 'documento'}{source?.locator ? ` · ${source.locator}` : ''}</summary>
                <blockquote className="mt-2 border-l pl-3">{c.quote}</blockquote></details>; })}</div>)}</div>
        </details>)}</div>
      </section>}

      {report.coverage.length > 0 && <section aria-labelledby="report-sources" className="space-y-3">
        {heading('sources', 'Documentos leídos', report.coverage.length)}
        <ul className="divide-y rounded-2xl border text-sm">{report.coverage.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <span className="min-w-0 break-words">{d.name}</span>
          <span className="text-xs text-muted-foreground">{statusLabel(d.status)}{d.pagesTotal ? ` · ${d.pagesRead} de ${d.pagesTotal} páginas` : ''}</span></li>)}</ul>
      </section>}

      <section aria-label="Preguntar a la IA" className="rounded-2xl border bg-muted/30 p-5">
        <h3 className="flex items-center gap-2 font-semibold"><MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />¿Dudas? Pregúntale a la IA</h3>
        <p className="mt-1 text-sm text-muted-foreground">Responde con lo que dicen los documentos de esta oportunidad y te muestra de dónde lo sacó.</p>
        <div className="mt-3 flex flex-wrap gap-2">{(signal ? SUGGESTED_QUESTIONS.signal : SUGGESTED_QUESTIONS.tender).map(q =>
          <Button key={q} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => onAsk(q)}>{q}</Button>)}</div>
      </section>
    </article>

    <nav aria-label="En este informe" className="hidden lg:block">
      <div className="sticky top-20 space-y-1 border-l pl-3 text-sm">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" />En este informe</p>
        {sections.map(([id, title]) => <a key={id} href={`#report-${id}`} className="block rounded py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{title}</a>)}
      </div>
    </nav>
  </div>;
}
