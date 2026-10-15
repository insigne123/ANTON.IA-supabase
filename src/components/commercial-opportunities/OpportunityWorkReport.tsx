'use client';
// The report as one document: the decision and what to do now on top, then requirements, plan, risks, questions and the
// detailed analysis, with a short index. A LinkedIn signal reads as a commercial plan, not as a tender.
import { useState } from 'react';
import { Check, Copy, ListChecks, MessageCircleQuestion, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { opportunityFinancialScenario } from '@/lib/commercial-opportunities/workspace';
import { IMPACT_LABELS, consultationEmail, humanDate, isSignalReport, opportunityReportWarnings, reportDecision, reportKeyDates, reportNextSteps, statusLabel } from '@/lib/commercial-opportunities/report-view';

const TONES = { go: 'bg-cw-success-soft text-cw-success', evaluate: 'bg-cw-warning-soft text-cw-warning', no: 'bg-muted text-muted-foreground', pending: 'bg-muted text-muted-foreground' };
const IMPACT_TONES: Record<string, string> = { high: 'bg-destructive/10 text-destructive', medium: 'bg-cw-warning-soft text-cw-warning', low: 'bg-muted text-muted-foreground' };
const REQUIREMENT_TONES: Record<string, string> = { blocked: 'text-destructive', pending: 'text-cw-warning', unknown: 'text-muted-foreground', supported: 'text-muted-foreground' };
export const SUGGESTED_QUESTIONS = {
  tender: ['¿Qué documentos tengo que preparar para postular?', '¿Cuál es la fecha de cierre y hasta cuándo puedo hacer consultas?', '¿Cómo se evalúan las ofertas?', '¿Qué garantías y multas hay?'],
  signal: ['¿A quién debería contactar primero?', '¿Qué le digo en el primer mensaje?', '¿Qué sabemos de esta empresa?'],
};

type Opportunity = { title: string; buyer?: string | null; deadline?: string | null; amount?: number | null; currency?: string | null };
export function OpportunityWorkReport({ report, opportunity, onTask, onAsk, onContacts }: {
  report: OpportunityReport; opportunity: Opportunity; onTask: (title: string, evidence: string) => void;
  onAsk: (question: string) => void; onContacts?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const signal = isSignalReport(report);
  const decision = reportDecision(report);
  const dates = reportKeyDates(report, opportunity.deadline);
  const steps = reportNextSteps(report);
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
  const heading = (id: string, title: string, count?: number) =>
    <h3 id={`report-${id}`} className="scroll-mt-24 text-lg font-semibold">{title}{count ? <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{count}</span> : null}</h3>;

  return <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
    <article className="min-w-0 space-y-8">
      <section aria-labelledby="report-next" className="rounded-2xl border bg-background p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-3 py-1 text-sm font-medium', TONES[decision.tone])}>{decision.label}</span>
          <span className="text-xs text-muted-foreground">Preparado el {humanDate(report.generatedAt) ?? 'hoy'}</span>
        </div>
        <p className="mt-4 max-w-3xl text-base leading-7">{report.executive}</p>
        {facts.length > 0 && <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {facts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm font-medium">{value}</dd></div>)}
        </dl>}
        <h3 id="report-next" className="mt-6 text-sm font-semibold">Qué hacer ahora</h3>
        <ol className="mt-2 space-y-2">
          {steps.map((step, i) => <li key={i} className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
            <span className="flex min-w-0 gap-2 text-sm"><span className="font-semibold tabular-nums text-muted-foreground">{i + 1}.</span><span>{step}</span></span>
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onTask(step, '')}>Crear tarea</Button>
          </li>)}
        </ol>
        {report.reasons.length > 0 && <ul className="mt-5 space-y-1.5 text-sm text-muted-foreground">{report.reasons.map((r, i) => <li key={i} className="flex gap-2"><span aria-hidden="true">·</span><span>{r}</span></li>)}</ul>}
        {signal && onContacts && <Button variant="outline" className="mt-5" onClick={onContacts}><Users className="mr-2 h-4 w-4" aria-hidden="true" />Buscar a quién contactar</Button>}
      </section>

      {warnings.length > 0 && <section aria-label="Antes de decidir" className="rounded-2xl bg-cw-warning-soft p-5">
        <h3 className="text-sm font-semibold">Antes de decidir</h3>
        <ul className="mt-2 space-y-1.5 text-sm">{warnings.map((w, i) => <li key={i} className="flex gap-2"><span aria-hidden="true">·</span><span>{w}</span></li>)}</ul>
      </section>}

      {report.milestones.length > 0 && <section aria-labelledby="report-dates" className="space-y-3">
        {heading('dates', 'Fechas clave')}
        <ol className="space-y-3 border-l-2 border-primary/30 pl-4">{report.milestones.map((m, i) => <li key={i}>
          <p className="text-sm font-medium">{m.label}</p><p className="text-sm text-muted-foreground">{m.date}</p></li>)}</ol>
      </section>}

      {report.requirements.length > 0 && <section aria-labelledby="report-requirements" className="space-y-3">
        {heading('requirements', signal ? 'Qué validar con la empresa' : 'Requisitos para postular', report.requirements.length)}
        <ul className="divide-y rounded-2xl border">{report.requirements.map((r, i) => <li key={i} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 font-medium">{r.title}</p>
            <span className={cn('shrink-0 text-xs font-medium', REQUIREMENT_TONES[r.status])}>{statusLabel(r.status)}</span></div>
          {r.action && <p className="mt-1.5 text-sm">{r.action}</p>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{[r.role, r.due].filter(Boolean).join(' · ')}</p>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onTask(r.action || r.title, r.evidence.map(e => e.quote).join('\n'))}>Crear tarea</Button>
          </div>
        </li>)}</ul>
      </section>}

      {report.tasks.length > 0 && <section aria-labelledby="report-plan" className="space-y-3">
        {heading('plan', signal ? 'Pasos comerciales' : 'Plan de trabajo', report.tasks.length)}
        <ol className="divide-y rounded-2xl border">{report.tasks.map((t, i) => <li key={i} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 font-medium">{t.title}</p>
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onTask(t.title, t.evidence)}>Crear tarea</Button></div>
          <p className="mt-1 text-xs text-muted-foreground">{[t.role, t.due].filter(Boolean).join(' · ')}</p>
          {(t.dependency || t.evidence) && <p className="mt-2 text-sm text-muted-foreground">{[t.dependency && `Antes: ${t.dependency}`, t.evidence && `Resultado: ${t.evidence}`].filter(Boolean).join(' · ')}</p>}
        </li>)}</ol>
      </section>}

      {report.risks.length > 0 && <section aria-labelledby="report-risks" className="space-y-3">
        {heading('risks', 'Riesgos y cómo cubrirlos', report.risks.length)}
        <ul className="divide-y rounded-2xl border">{report.risks.map((r, i) => <li key={i} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 font-medium">{r.title}</p>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', IMPACT_TONES[r.impact])}>{IMPACT_LABELS[r.impact] ?? r.impact}</span></div>
          <p className="mt-1.5 text-sm">{r.mitigation}</p>
        </li>)}</ul>
      </section>}

      {report.questions.length > 0 && <section aria-labelledby="report-questions" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {heading('questions', signal ? 'Preguntas para la primera conversación' : 'Preguntas para el comprador', report.questions.length)}
          {!signal && <Button variant="outline" size="sm" onClick={() => void copyEmail()}>
            {copied ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />}{copied ? 'Correo copiado' : 'Copiar como correo de consultas'}</Button>}
        </div>
        {!signal && dates.questions && <p className="text-sm text-muted-foreground">Envíalas antes del cierre de consultas: {dates.questions}.</p>}
        <ol className="list-decimal space-y-2 pl-5 text-sm">{report.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
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
