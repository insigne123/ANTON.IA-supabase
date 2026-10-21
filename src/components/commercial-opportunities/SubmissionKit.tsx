'use client';

// «Cómo postular»: the second screen of a purchase with bases. The report says whether and why; this says what to hand in,
// how, and what leaves the offer out, with the team ticking each document as it gets ready.
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Calculator, Check, Copy, FileSignature, FolderOpen, Landmark, ListOrdered, MessageCircleQuestion, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { parseReportDate, reportItemKey, reportProgress, type ReportMark, type ReportMarks } from '@/lib/commercial-opportunities/report-marks';
import { humanDate, reportKeyDates } from '@/lib/commercial-opportunities/report-view';
import { AFTER_SUBMIT_DEFAULTS, KIT_SOURCE_LABELS, clampSubmissionKit, PORTAL_STEPS, VAT_PERCENT, kitChecklist, offerNumbers, parseAmount, type SubmissionKit as Kit } from '@/lib/commercial-opportunities/submission-kit';
import { MarkedItem, useReportMarks, type MarkChange } from './ReportMarks';

const money = (n: number, currency = 'CLP') => currency === 'CLP' || !currency
  ? `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)}`
  : `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)} ${currency}`;
const CHANNEL: Record<Kit['channel'], string> = { portal: 'Por el portal', email: 'Por correo', physical: 'En papel', mixed: 'Por más de un canal', unknown: 'Canal por confirmar' };

export function SubmissionKit({ report, opportunity, marks: initialMarks, onMark, people, onDraft, onGenerate, generating, offer, hideNumbers }: {
  report: OpportunityReport | null;
  opportunity: { title: string; kind: string; amount?: number | null; currency?: string | null; deadline?: string | null };
  marks?: { available: boolean; items: ReportMarks } | null;
  onMark?: (change: MarkChange) => Promise<ReportMark | null>;
  people?: Array<{ user_id: string; name: string }>;
  /** Asks the AI for a draft of a form of the bases, in the chat. */
  onDraft?: (title: string) => void;
  onGenerate?: () => void;
  generating?: boolean;
  /** «Tu oferta» (OfferDraft): the draft of what to hand in, right after the summary of the guide. */
  offer?: ReactNode;
  /** The draft's economic sheet already adds net, VAT and total: the quick calculator would repeat it. */
  hideNumbers?: boolean;
}) {
  const kit = report?.submission ? clampSubmissionKit(report.submission) : null;
  const { interactive, marks, pending, change } = useReportMarks(initialMarks, onMark);
  const markProps = { marks: interactive ? marks : null, pending, onChange: (input: MarkChange) => void change(input),
    authorOf: (id?: string | null) => people?.find(p => p.user_id === id)?.name ?? null, whenOf: (at?: string | null) => humanDate(at, true) };
  // Without a guide (a report from before it existed), the report's requirements are the list: the same ticks as in the report.
  const checklist = useMemo(() => kit ? kitChecklist(kit) : (report?.requirements || []).map(r => ({ key: reportItemKey('requirement', r.title), label: r.title, folder: '', critical: r.status === 'blocked' })), [kit, report]);
  const progress = reportProgress(checklist, marks);
  const dates = report ? reportKeyDates(report, opportunity.deadline) : { questions: null, closes: humanDate(opportunity.deadline, true) };
  const after = kit?.afterSubmit.length ? kit.afterSubmit : AFTER_SUBMIT_DEFAULTS;
  const sectionTitle = (id: string, icon: ReactNode, title: string, count?: number) => (
    <h3 id={`kit-${id}`} className="flex items-center gap-2 text-lg font-semibold">
      <span aria-hidden="true" className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>{title}
      {count ? <span className="text-sm font-normal tabular-nums text-muted-foreground">{count}</span> : null}
    </h3>
  );

  return (
    <article aria-labelledby="kit-title" className="mx-auto w-full min-w-0 max-w-3xl space-y-10">
      <header className="space-y-4 rounded-3xl border bg-background p-5 shadow-sm sm:p-7">
        <div className="space-y-1">
          <h2 id="kit-title" className="text-xl font-semibold tracking-tight">Cómo postular</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {kit ? <>{CHANNEL[kit.channel]}{kit.channelDetail ? `: ${kit.channelDetail}` : '.'}</> : 'Lo que hay que entregar y cómo, leído de las bases.'}
            {dates.closes ? <> Cierra el <span className="font-medium text-foreground">{dates.closes}</span>.</> : null}
          </p>
        </div>
        {checklist.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{progress.done} de {progress.total} {kit ? 'documentos listos' : 'requisitos listos'}</span>
              {checklist.some(item => item.critical && !marks[item.key]?.done) && <span className="text-xs text-muted-foreground">{checklist.filter(item => item.critical && !marks[item.key]?.done).length} te dejan fuera si faltan</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Avance de la postulación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
              <div className="h-full rounded-full bg-cw-success transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
        {!kit && onGenerate ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 p-4 text-sm">
            <p className="max-w-md leading-6">{report ? 'Este informe es anterior a la guía de postulación. Actualízalo y la IA ordenará los documentos por carpeta, con lo que deja la oferta fuera.' : 'Genera el informe y la IA armará esta guía desde las bases: documentos por carpeta, mínimos y garantías.'}</p>
            <Button size="sm" onClick={onGenerate} disabled={generating}><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{generating ? 'Preparando…' : report ? 'Actualizar informe' : 'Generar informe'}</Button>
          </div>
        ) : null}
      </header>

      {offer}

      {kit && kit.folders.length > 0 && (
        <section aria-labelledby="kit-documents" className="space-y-6">
          {sectionTitle('documents', <FolderOpen />, 'Qué entregar', checklist.length)}
          {kit.folders.map(folder => (
            <div key={folder.name} className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{folder.name}</h4>
              <ul className="space-y-4">
                {folder.documents.map(doc => {
                  const key = reportItemKey('document', doc.title);
                  return (
                    <li key={key}>
                      <MarkedItem markKey={key} label={doc.title} {...markProps}>
                        <p className="mark-title text-sm font-medium leading-6">{doc.title}</p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {[KIT_SOURCE_LABELS[doc.source], doc.signed ? 'Con firma' : null, doc.validity || null].filter(Boolean).join(' · ')}
                        </p>
                        {doc.howTo ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{doc.howTo}</p> : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {doc.excludesIfMissing ? <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Si falta, quedas fuera</span> : null}
                          {onDraft && (doc.source === 'annex' || doc.source === 'company') ? (
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onDraft(doc.title)}>
                              <FileSignature className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Preparar borrador
                            </Button>
                          ) : null}
                        </div>
                      </MarkedItem>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {!kit && report && report.requirements.length > 0 && (
        <section aria-labelledby="kit-documents" className="space-y-4">
          {sectionTitle('documents', <FolderOpen />, 'Requisitos del informe', report.requirements.length)}
          <ul className="space-y-4">
            {report.requirements.map(r => (
              <li key={r.title}>
                <MarkedItem markKey={reportItemKey('requirement', r.title)} label={r.title} {...markProps}>
                  <p className="mark-title text-sm font-medium leading-6">{r.title}</p>
                  {r.action ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{r.action}</p> : null}
                </MarkedItem>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kit && kit.rules.length > 0 && (
        <section aria-labelledby="kit-rules" className="space-y-4">
          {sectionTitle('rules', <AlertTriangle />, 'Lo que te deja fuera')}
          <ul className="divide-y rounded-2xl border">
            {kit.rules.map(rule => {
              const quote = rule.evidence.find(e => !/["{}]/.test(e.quote))?.quote;
              return (
                <li key={rule.text} className="flex gap-3 px-4 py-3 text-sm leading-6">
                  <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  <div className="min-w-0">
                    <p>{rule.text}</p>
                    {quote ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Bases: «{quote.slice(0, 220)}»</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hideNumbers ? null : <OfferNumbers kit={kit} amount={opportunity.amount ?? null} currency={opportunity.currency || 'CLP'} />}

      {kit && kit.guarantees.length > 0 && (
        <section aria-labelledby="kit-guarantees" className="space-y-4">
          {sectionTitle('guarantees', <ShieldCheck />, 'Garantías')}
          <div className="grid gap-3 sm:grid-cols-2">
            {kit.guarantees.map(g => (
              <div key={g.kind} className="rounded-2xl border p-4">
                <p className="text-sm font-semibold">{g.kind}</p>
                <dl className="mt-2 space-y-1.5 text-sm">
                  {[['Monto', g.amount], ['Vigencia', g.validity], ['Cuándo', g.when], ['A nombre de', g.payableTo]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Pídela con tiempo: el banco o la aseguradora pueden tardar días. Sirven boleta, vale vista, póliza o certificado de fianza, en papel o electrónicos, si las bases lo permiten.</p>
        </section>
      )}

      {kit && kit.inconsistencies.length > 0 && <ForumQuestions items={kit.inconsistencies} until={dates.questions} />}

      <section aria-labelledby="kit-portal" className="space-y-4">
        {sectionTitle('portal', <ListOrdered />, kit?.channel === 'email' ? 'Cómo se envía (en general)' : 'Cómo se envía en Mercado Público')}
        <ol className="space-y-4">
          {PORTAL_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">{index + 1}</span>
              <div className="min-w-0"><p className="text-sm font-medium leading-6">{step.title}</p><p className="text-sm leading-6 text-muted-foreground">{step.detail}</p></div>
            </li>
          ))}
        </ol>
        {kit?.channel === 'email' ? <p className="rounded-2xl bg-cw-warning-soft px-4 py-3 text-sm leading-6">Ojo: estas bases piden enviar por correo. {kit.channelDetail}</p> : null}
      </section>

      <section aria-labelledby="kit-after" className="space-y-3">
        {sectionTitle('after', <Landmark />, 'Después de enviar')}
        <ul className="space-y-2 text-sm leading-6">
          {after.map(line => <li key={line} className="flex gap-2"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{line}</span></li>)}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">Guía general basada en la Ley 19.886 y su reglamento. En cada licitación mandan sus bases y las respuestas del foro.</p>
      </section>
    </article>
  );
}

/** The two numbers that must agree: what goes in the portal and what the annex says once VAT is added, against the budget. */
function OfferNumbers({ kit, amount, currency }: { kit: Kit | null; amount: number | null; currency: string }) {
  const [text, setText] = useState('');
  const [side, setSide] = useState<'net' | 'total'>('net');
  const budget = kit?.numbers.budget ?? amount;
  const unit = kit?.numbers.currency || currency;
  const value = parseAmount(text);
  const result = value ? offerNumbers({ [side]: value, budget, budgetIncludesTax: kit?.numbers.budgetIncludesTax ?? null }) : null;
  const portal = kit?.numbers.portalValue ?? 'unknown';
  return (
    <section aria-labelledby="kit-numbers" className="space-y-4">
      <h3 id="kit-numbers" className="flex items-center gap-2 text-lg font-semibold"><Calculator className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Los números</h3>
      <div className="space-y-4 rounded-2xl border p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="kit-amount">{side === 'net' ? 'Valor neto de tu oferta' : 'Valor total con IVA'}</Label>
            <Input id="kit-amount" inputMode="decimal" autoComplete="off" placeholder={unit === 'CLP' ? 'Ej.: 178.000.000' : 'Ej.: 380'} value={text} onChange={e => setText(e.target.value)} />
          </div>
          <div role="group" aria-label="Qué valor escribes" className="flex rounded-full bg-muted p-1 text-xs">
            {(['net', 'total'] as const).map(id => (
              <button key={id} type="button" aria-pressed={side === id} onClick={() => setSide(id)}
                className={cn('rounded-full px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', side === id ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                {id === 'net' ? 'Neto' : 'Con IVA'}
              </button>
            ))}
          </div>
        </div>
        {result ? (
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[['Neto', result.net], [`IVA ${VAT_PERCENT} %`, result.tax], ['Total', result.total]].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{money(v as number, unit)}</dd></div>
            ))}
          </dl>
        ) : <p className="text-sm text-muted-foreground">Escribe un monto y verás el neto, el IVA y el total que deben coincidir en el portal y en el anexo económico.</p>}
        {result && result.budget !== null ? (
          <p role="status" className={cn('rounded-xl px-3 py-2 text-sm', result.overBudget ? 'bg-destructive/10 text-destructive' : 'bg-cw-success/10 text-foreground')}>
            {result.overBudget
              ? `Supera el presupuesto de ${money(result.budget, unit)} por ${money(Math.abs(result.margin!), unit)}. Muchas bases declaran inadmisible una oferta sobre el presupuesto.`
              : `Cabe en el presupuesto de ${money(result.budget, unit)}, con ${money(result.margin!, unit)} de margen.`}
          </p>
        ) : null}
        <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
          {kit?.numbers.budget ? <li>Presupuesto según las bases: {money(kit.numbers.budget, unit)}{kit.numbers.budgetIncludesTax === true ? ', impuestos incluidos' : kit.numbers.budgetIncludesTax === false ? ', sin impuestos' : ''}.</li>
            : budget ? <li>Monto de la ficha: {money(budget, unit)}. Confírmalo en las bases.</li> : null}
          {portal !== 'unknown' ? <li>En el portal va el valor <span className="font-medium text-foreground">{portal === 'net' ? 'neto' : 'total con impuestos'}</span>; el anexo económico debe coincidir al aplicar el IVA.</li> : <li>Revisa en las bases si el portal pide el valor neto o el total: deben coincidir con el anexo económico.</li>}
          {kit?.numbers.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      </div>
    </section>
  );
}

/** Contradictions in the bases, turned into the questions to ask in the forum before it closes. */
function ForumQuestions({ items, until }: { items: Kit['inconsistencies']; until: string | null }) {
  const [copied, setCopied] = useState(false);
  const deadline = until ? parseReportDate(until) : null;
  const closed = Boolean(deadline && deadline.at.getTime() < Date.now());
  const copy = async () => {
    const text = items.map((item, index) => `${index + 1}. ${item.question}`).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the questions stay on screen to copy by hand */ }
  };
  return (
    <section aria-labelledby="kit-forum" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="kit-forum" className="flex items-center gap-2 text-lg font-semibold"><MessageCircleQuestion className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Para preguntar en el foro</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>{copied ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />}{copied ? 'Copiadas' : 'Copiar preguntas'}</Button>
      </div>
      <p className="text-sm text-muted-foreground">Las bases se contradicen en estos puntos.{closed ? ` El plazo de consultas cerró el ${until}: revisa si el foro ya las respondió.` : until ? ` Pregunta antes del ${until}.` : ' Pregunta antes del cierre de consultas.'}</p>
      <ol className="space-y-3">
        {items.map(item => (
          <li key={item.question} className="rounded-2xl border p-4 text-sm leading-6">
            <p className="text-muted-foreground">{item.text}</p>
            <p className="mt-1 font-medium">{item.question}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
