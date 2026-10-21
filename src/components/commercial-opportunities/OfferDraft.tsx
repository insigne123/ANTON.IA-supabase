'use client';

// «Tu oferta», inside «Cómo postular»: the AI's draft of what the company hands in (cover letter, technical offer by
// evaluation criterion, technical compliance and the economic sheet, where the team types the prices). One main action at a
// time: prepare the draft, then complete it.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy, Download, FilePen, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { OFFER_PLACEHOLDER, offerPlaceholders, offerPrice, offerSheet, type OfferPrices, type SavedOfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import { annexOpenFields } from '@/lib/commercial-opportunities/offer-annexes';

export type OfferJob = { id: string; state: string; error: string | null; created_at: string };
const ACTIVE = ['queued', 'running', 'waiting'];
const money = (n: number) => `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)}`;
const when = (at: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' }).format(new Date(at));

const ONE_PLACEHOLDER = new RegExp(`^${OFFER_PLACEHOLDER.source}$`);
/** The text with its [placeholders] marked, so the team sees what is left to fill in. */
export function WithPlaceholders({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${OFFER_PLACEHOLDER.source})`, 'g'));
  return <>{parts.map((part, index) => ONE_PLACEHOLDER.test(part)
    ? <mark key={index} className="rounded bg-cw-warning-soft px-1 text-foreground">{part}</mark>
    : <Fragment key={index}>{part}</Fragment>)}</>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the text stays on screen to copy by hand */ }
  };
  return <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => void copy()} aria-label={copied ? `${label} copiado` : `Copiar ${label}`}>
    {copied ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}{copied ? 'Copiado' : 'Copiar'}
  </Button>;
}

function Part({ id, title, count, open, action, children }: { id: string; title: string; count?: number; open?: boolean; action?: ReactNode; children: ReactNode }) {
  return <details id={`offer-${id}`} open={open} className="group rounded-2xl border bg-background">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <span className="text-sm font-semibold">{title}{count ? <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">{count}</span> : null}</span>
      <span className="flex items-center gap-1">{action}<span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span></span>
    </summary>
    <div className="space-y-4 border-t px-4 py-4">{children}</div>
  </details>;
}

export function OfferDraft({ offer, job, onPrepare, preparing, onSavePrices, downloadHref, annexHref, budget }: {
  offer: { available: boolean; latest: SavedOfferDraft | null } | null | undefined;
  /** The latest «offer» job of the opportunity, if any. */
  job: OfferJob | null;
  onPrepare: (instructions: string) => void;
  preparing?: boolean;
  onSavePrices: (draftId: string, revision: number, prices: Record<string, string>) => Promise<{ revision: number; prices: OfferPrices } | null>;
  downloadHref: string;
  /** The Word of one form of the bases (by its place in the draft). */
  annexHref?: (index: number) => string;
  budget: { amount: number | null; includesTax: boolean | null };
}) {
  const latest = offer?.latest ?? null;
  const active = Boolean(job && ACTIVE.includes(job.state));
  // A failed preparation newer than the draft on view says so; an older one is history.
  const failed = job && ['failed', 'blocked'].includes(job.state) && (!latest || Date.parse(job.created_at) > Date.parse(latest.created_at)) ? job : null;
  const [asking, setAsking] = useState(false);
  const [instructions, setInstructions] = useState('');
  const prepare = () => { onPrepare(instructions.trim()); setAsking(false); setInstructions(''); };
  if (!offer?.available) return null;

  const ask = <div className="space-y-2">
    <Label htmlFor="offer-instructions">Indicaciones para la IA · opcional</Label>
    <Textarea id="offer-instructions" rows={3} maxLength={1500} value={instructions} onChange={e => setInstructions(e.target.value)}
      placeholder="Ej.: destaca nuestros 8 años con municipios y que operamos en la Región de Los Lagos; propón un plazo de 15 días." />
  </div>;

  if (!latest) return <section aria-labelledby="offer-title" className="space-y-4 rounded-3xl border bg-background p-5 shadow-sm sm:p-7">
    <div className="space-y-1">
      <h3 id="offer-title" className="flex items-center gap-2 text-lg font-semibold"><FilePen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Tu oferta</h3>
      <p className="text-sm leading-6 text-muted-foreground">La IA arma en un Word para llenar lo que leyó de las bases: la carta de presentación, la oferta técnica según los criterios de evaluación, el cumplimiento de requisitos, las líneas a cotizar y los formularios (anexos) con los datos de tu empresa que ya conocemos. Tú completas los campos amarillos y los precios.</p>
    </div>
    {active ? <p role="status" className="flex items-center gap-2 rounded-2xl bg-muted/50 p-4 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Preparando el borrador. Tarda unos minutos; puedes seguir trabajando y te avisaremos.</p>
      : <>
        {failed ? <p role="alert" className="flex gap-2 rounded-2xl bg-destructive/5 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />{failed.error || 'El borrador no terminó. Intenta de nuevo.'}</p> : null}
        {asking ? ask : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={prepare} disabled={preparing}><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{preparing ? 'Enviando…' : 'Preparar borrador de oferta'}</Button>
          {!asking ? <Button variant="ghost" onClick={() => setAsking(true)}>Agregar indicaciones</Button> : null}
        </div>
      </>}
  </section>;

  const { draft } = latest;
  const placeholders = offerPlaceholders(draft);
  return <section aria-labelledby="offer-title" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h3 id="offer-title" className="flex items-center gap-2 text-lg font-semibold"><FilePen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Tu oferta · borrador</h3>
        <p className="text-xs text-muted-foreground">Preparado el {when(latest.created_at)}. Revísalo y confirma cada dato con las bases antes de enviarlo.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm"><a href={downloadHref}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Descargar Word para llenar</a></Button>
        <Button size="sm" variant="ghost" disabled={active || preparing} onClick={() => setAsking(value => !value)}>
          {active ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}{active ? 'Preparando otra versión…' : 'Preparar otra versión'}
        </Button>
      </div>
    </div>
    {asking && !active ? <div className="space-y-3 rounded-2xl border p-4">{ask}<div className="flex gap-2"><Button size="sm" onClick={prepare} disabled={preparing}>Preparar</Button><Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancelar</Button></div><p className="text-xs text-muted-foreground">La versión actual y sus precios se conservan hasta que llegue la nueva.</p></div> : null}
    {failed ? <p role="alert" className="flex gap-2 rounded-2xl bg-destructive/5 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />La nueva versión no terminó: {failed.error || 'intenta de nuevo.'} Sigues viendo la anterior.</p> : null}

    {!draft.annexes ? <p className="rounded-2xl bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">Este borrador es anterior a los formularios de las bases (anexos). Con «Preparar otra versión» sale con ellos, listos para llenar en el Word.</p> : null}

    {draft.missing.length || placeholders.length ? <div className="rounded-2xl bg-cw-warning-soft p-4 text-sm leading-6">
      <p className="font-medium">Antes de enviar, completa {placeholders.length ? `${placeholders.length} dato${placeholders.length === 1 ? '' : 's'} marcado${placeholders.length === 1 ? '' : 's'}` : 'estos datos'}</p>
      {draft.missing.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{draft.missing.map(item => <li key={item}>{item}</li>)}</ul> : null}
    </div> : null}

    {draft.letter ? <Part id="letter" title="Carta de presentación" action={<CopyButton text={draft.letter} label="la carta" />}>
      <p className="whitespace-pre-line text-sm leading-6"><WithPlaceholders text={draft.letter} /></p>
    </Part> : null}

    <Part id="technical" title="Oferta técnica" count={draft.technical.length} open>
      {draft.summary ? <p className="text-sm leading-6"><WithPlaceholders text={draft.summary} /></p> : null}
      <ol className="space-y-5">
        {draft.technical.map((section, index) => <li key={`${index}:${section.heading}`} className="space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{section.heading}</p>
              {section.criterion ? <p className="text-xs leading-5 text-muted-foreground">Responde a: {section.criterion}{section.weight ? <span className="ml-1 rounded-full bg-muted px-2 py-0.5 tabular-nums">{section.weight}</span> : null}</p> : null}
            </div>
            <CopyButton text={section.body} label={`la sección ${section.heading}`} />
          </div>
          <p className="whitespace-pre-line text-sm leading-6"><WithPlaceholders text={section.body} /></p>
          {section.evidence[0] ? <p className="text-xs leading-5 text-muted-foreground">Bases: «{section.evidence[0].quote.slice(0, 220)}»</p> : null}
        </li>)}
      </ol>
    </Part>

    {draft.compliance.length ? <Part id="compliance" title="Cumplimiento de requisitos técnicos" count={draft.compliance.length}>
      <ul className="divide-y">
        {draft.compliance.map((item, index) => <li key={`${index}:${item.requirement}`} className="space-y-1 py-3 text-sm leading-6 first:pt-0 last:pb-0">
          <p className="text-muted-foreground">{item.requirement}</p>
          <p><WithPlaceholders text={item.answer} /></p>
        </li>)}
      </ul>
    </Part> : null}

    {draft.economic.lines.length ? <EconomicSheet key={latest.id} saved={latest} budget={budget} onSave={onSavePrices} /> : null}

    {draft.annexes?.length ? <Part id="annexes" title="Formularios de las bases" count={draft.annexes.length}>
      <p className="text-sm leading-6 text-muted-foreground">Cada formulario va en el Word, listo para llenar y con los datos de tu empresa que ya conocemos. Descárgalos todos juntos arriba o uno por uno aquí.</p>
      <ul className="divide-y">
        {draft.annexes.map((annex, index) => {
          const open = annexOpenFields(annex);
          return <li key={`${index}:${annex.number}:${annex.title}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium">{[annex.number, annex.title].filter(Boolean).join(' · ')}</p>
              <p className="text-xs leading-5 text-muted-foreground">{annex.faithful ? 'Copiado del formulario de las bases' : 'Armado con lo que piden las bases: compáralo con el oficial'}{open ? ` · ${open} por completar` : ''}</p>
            </div>
            {annexHref ? <Button asChild size="sm" variant="outline"><a href={annexHref(index)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Descargar Word</a></Button> : null}
          </li>;
        })}
      </ul>
    </Part> : null}
  </section>;
}

/** The lines to quote with the prices the team types, the totals with VAT and how they stand against the budget. */
export function EconomicSheet({ saved, budget, onSave }: {
  saved: SavedOfferDraft; budget: { amount: number | null; includesTax: boolean | null };
  onSave: (draftId: string, revision: number, prices: Record<string, string>) => Promise<{ revision: number; prices: OfferPrices } | null>;
}) {
  const { draft } = saved;
  const initial = useMemo(() => Object.fromEntries(Object.entries(saved.prices).map(([key, value]) => [key, String(value)])), [saved.prices]);
  const [typed, setTyped] = useState<Record<string, string>>(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // The prices this sheet just saved come back as they were typed; prices a teammate saved replace what is on screen.
  const own = useRef<string | null>(null);
  useEffect(() => {
    if (JSON.stringify(saved.prices) !== own.current) setTyped(initial);
    own.current = null;
  }, [initial, saved.prices]);
  const prices = useMemo(() => {
    const out: OfferPrices = {};
    for (const [key, value] of Object.entries(typed)) { const price = offerPrice(value); if (price !== null && value.trim()) out[key] = price; }
    return out;
  }, [typed]);
  const sheet = offerSheet(draft, prices, budget);
  const changed = JSON.stringify(prices) !== JSON.stringify(Object.fromEntries(Object.entries(saved.prices).map(([k, v]) => [k, Number(v)])));
  const save = async () => {
    setState('saving');
    const result = await onSave(saved.id, saved.revision, typed);
    if (result) own.current = JSON.stringify(result.prices);
    setState(result ? 'saved' : 'error');
  };
  const basis = sheet.withTax ? 'con IVA' : 'neto';
  return <Part id="economic" title="Oferta económica" count={draft.economic.lines.length} open>
    <p className="text-sm leading-6 text-muted-foreground">Escribe el precio unitario {basis} de cada línea{draft.economic.priceBasis === 'unknown' ? ' (las bases no dicen si el portal pide neto o total: confírmalo)' : ''}. Los totales se calculan solos.</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground">
          <th scope="col" className="py-2 pr-3 font-medium">Línea</th><th scope="col" className="py-2 pr-3 font-medium">Cantidad</th>
          <th scope="col" className="py-2 pr-3 font-medium">Precio unitario {basis}</th><th scope="col" className="py-2 text-right font-medium">Subtotal</th>
        </tr></thead>
        <tbody>
          {sheet.rows.map(row => <tr key={row.index} className="border-b align-top last:border-0">
            <td className="py-2.5 pr-3"><p className="leading-6">{row.description}</p>{row.notes ? <p className="text-xs leading-5 text-muted-foreground">{row.notes}</p> : null}</td>
            <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">{row.quantity ?? '—'}{row.unit ? <span className="ml-1 text-xs text-muted-foreground">{row.unit}</span> : null}</td>
            <td className="py-2.5 pr-3">
              <Label htmlFor={`offer-price-${row.index}`} className="sr-only">Precio unitario de {row.description}</Label>
              <Input id={`offer-price-${row.index}`} inputMode="decimal" className="h-9 w-36 tabular-nums" placeholder="$0" value={typed[String(row.index)] ?? ''}
                onChange={e => { setState('idle'); setTyped(current => ({ ...current, [String(row.index)]: e.target.value })); }} />
            </td>
            <td className="whitespace-nowrap py-2.5 text-right tabular-nums">{row.subtotal === null ? '—' : money(row.subtotal)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {sheet.numbers ? <dl className="grid gap-3 rounded-2xl bg-muted/40 p-4 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-muted-foreground">Neto</dt><dd className="font-semibold tabular-nums">{money(sheet.numbers.net)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">IVA (19 %)</dt><dd className="font-semibold tabular-nums">{money(sheet.numbers.tax)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Total</dt><dd className="font-semibold tabular-nums">{money(sheet.numbers.total)}</dd></div>
    </dl> : null}
    <div aria-live="polite" className="space-y-1 text-sm">
      {sheet.numbers && sheet.numbers.budget !== null ? <p className={cn('font-medium', sheet.numbers.overBudget ? 'text-destructive' : 'text-cw-success')}>
        {sheet.numbers.overBudget ? `Supera el presupuesto de ${money(sheet.numbers.budget)}: las bases pueden dejar la oferta fuera.` : `Dentro del presupuesto de ${money(sheet.numbers.budget)} (margen ${money(sheet.numbers.margin ?? 0)}).`}
      </p> : null}
      {!sheet.complete && sheet.priced ? <p className="text-muted-foreground">Faltan precios en {sheet.rows.length - sheet.priced} línea{sheet.rows.length - sheet.priced === 1 ? '' : 's'}.</p> : null}
      {state === 'error' ? <p role="alert" className="text-destructive">No se guardaron los precios. Si otra persona los cambió, ya ves los suyos: revísalos y guarda de nuevo.</p> : null}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={() => void save()} disabled={!changed || state === 'saving'}>{state === 'saving' ? 'Guardando…' : 'Guardar precios'}</Button>
      {state === 'saved' && !changed ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />Guardados para el equipo</span> : null}
    </div>
    {[draft.economic.validity ? `Vigencia de la oferta: ${draft.economic.validity}` : '', draft.economic.paymentTerms ? `Forma de pago: ${draft.economic.paymentTerms}` : '', ...draft.economic.notes].filter(Boolean).length
      ? <ul className="space-y-1 text-xs leading-5 text-muted-foreground">{[draft.economic.validity ? `Vigencia de la oferta: ${draft.economic.validity}` : '', draft.economic.paymentTerms ? `Forma de pago: ${draft.economic.paymentTerms}` : '', ...draft.economic.notes].filter(Boolean).map(line => <li key={line}>{line}</li>)}</ul> : null}
  </Part>;
}
