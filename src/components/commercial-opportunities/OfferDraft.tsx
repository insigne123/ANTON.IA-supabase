'use client';

// «Tu oferta», inside «Cómo postular»: the AI's draft of what the company hands in (cover letter, technical offer by
// evaluation criterion, technical compliance and the economic sheet, where the team types the prices). One main action at a
// time: prepare the draft, then complete it. Each part can be rewritten by the team, by hand or asking the AI (OPP-24), and
// whoever is in charge marks it reviewed before it is handed in.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Download, FilePen, Loader2, MoreHorizontal, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { OFFER_PLACEHOLDER, offerPlaceholders, offerPrice, offerSheet, type OfferPrices, type SavedOfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import { OFFER_PART_MAX, offerPartEdit, offerPartText, offerReviewHolds, withOfferEdits, type OfferEdit } from '@/lib/commercial-opportunities/offer-edits';
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

/** A rewrite of one part by the AI (an «offer» job with a part), as the page reads it. */
export type PartJob = { id: string; part: string; state: string; error: string | null; created_at: string };

/**
 * One part of the offer the team can rewrite (OPP-24): «Editar» by hand, or «Pedir cambios a la IA» with what to change. The AI's
 * text stays under it, to read again or go back to. The caller places the actions (a section's header) and the text.
 */
export function OfferPart({ id, label, part, edit, author, job, compact = false, onSave, onRewrite, children }: {
  /** The part: «letter», «summary», «technical:2», «compliance:5». */
  id: string;
  /** What the part is, for the buttons read aloud: «la sección «Plan de trabajo»». */
  label: string;
  /** The part as the draft keeps it: its AI text and the team's text on top, if any. */
  part: { ai: string; text: string };
  edit: OfferEdit | null;
  /** Who wrote the edit, by name. */
  author: string | null;
  /** The newest rewrite of this part by the AI, if any. */
  job: PartJob | null;
  /** The answers of compliance are short and many: their actions go in the menu only. */
  compact?: boolean;
  onSave?: (text: string | null, base: string | null) => Promise<boolean>;
  onRewrite?: (instructions: string, base: string | null) => Promise<boolean>;
  children: (view: { actions: ReactNode; body: ReactNode }) => ReactNode;
}) {
  const [mode, setMode] = useState<'read' | 'edit' | 'ask'>('read');
  const [value, setValue] = useState(part.text);
  const [ask, setAsk] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [copied, setCopied] = useState(false);
  const base = edit?.at ?? null;
  const domId = id.replace(':', '-');
  const rewriting = Boolean(job && ACTIVE.includes(job.state));
  // A rewrite that did not finish is said under the part for an hour, unless the part changed since.
  const failed = job && ['failed', 'blocked'].includes(job.state) && Date.now() - Date.parse(job.created_at) < 3_600_000
    && (!edit || Date.parse(job.created_at) > Date.parse(edit.at)) ? job : null;
  const busy = saving || rewriting;
  const startEdit = () => { setValue(part.text); setMode('edit'); };
  const save = async (text: string | null) => {
    if (!onSave) return;
    setSaving(true); const ok = await onSave(text, base); setSaving(false);
    if (ok) { setMode('read'); setShowAi(false); }
  };
  const rewrite = async () => {
    if (!onRewrite) return;
    setSaving(true); const ok = await onRewrite(ask.trim(), base); setSaving(false);
    if (ok) { setMode('read'); setAsk(''); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(part.text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the text stays on screen to copy by hand */ }
  };
  const actions = <span className="flex shrink-0 items-center gap-0.5">
    {copied ? <span role="status" className="flex items-center gap-1 px-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />Copiado</span> : null}
    {onSave && !compact ? <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={busy || mode !== 'read'} onClick={startEdit} aria-label={`Editar ${label}`}>Editar</Button> : null}
    <DropdownMenu><DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" disabled={busy} aria-label={`Más acciones de ${label}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
    </DropdownMenuTrigger><DropdownMenuContent align="end">
      {onSave && compact ? <DropdownMenuItem onSelect={startEdit}>Editar</DropdownMenuItem> : null}
      {onRewrite ? <DropdownMenuItem onSelect={() => setMode('ask')}>Pedir cambios a la IA</DropdownMenuItem> : null}
      <DropdownMenuItem onSelect={() => void copy()}>Copiar</DropdownMenuItem>
      {edit ? <>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setShowAi(open => !open)}>{showAi ? 'Ocultar el texto de la IA' : 'Ver el texto de la IA'}</DropdownMenuItem>
        {onSave ? <DropdownMenuItem onSelect={() => void save(null)}>Volver al texto de la IA</DropdownMenuItem> : null}
      </> : null}
    </DropdownMenuContent></DropdownMenu>
  </span>;
  const body = mode === 'edit' ? <div className="space-y-2">
    <Label htmlFor={`offer-edit-${domId}`} className="sr-only">Editar {label}</Label>
    <Textarea id={`offer-edit-${domId}`} autoFocus rows={Math.min(16, Math.max(4, Math.ceil(value.length / 80)))} maxLength={OFFER_PART_MAX} value={value} onChange={e => setValue(e.target.value)} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={saving || !value.trim()} onClick={() => void save(value)}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setMode('read')}>Cancelar</Button>
    </div>
  </div> : <div className="space-y-1.5">
    <p className="whitespace-pre-line text-sm leading-6"><WithPlaceholders text={part.text} /></p>
    {edit ? <p className="text-xs text-muted-foreground">{edit.ai ? `Reescrita por la IA a pedido de ${author ?? 'alguien del equipo'}` : `Editada por ${author ?? 'alguien del equipo'}`} · {when(edit.at)}</p> : null}
    {showAi && edit ? <div className="rounded-xl bg-muted/50 p-3"><p className="text-xs font-medium text-muted-foreground">Texto de la IA</p><p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{part.ai}</p></div> : null}
    {rewriting ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />La IA está reescribiendo {label}…</p> : null}
    {failed ? <p role="alert" className="text-xs text-destructive">No se pudo reescribir {label}: {failed.error || 'inténtalo de nuevo.'}</p> : null}
    {mode === 'ask' ? <div className="space-y-2 rounded-xl border p-3">
      <Label htmlFor={`offer-ask-${domId}`}>¿Qué cambiar en {label}?</Label>
      <Textarea id={`offer-ask-${domId}`} autoFocus rows={2} maxLength={800} value={ask} onChange={e => setAsk(e.target.value)} placeholder="Ej.: más énfasis en nuestra experiencia con municipios; más breve." />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={saving || ask.trim().length < 3} onClick={() => void rewrite()}>{saving ? 'Reescribiendo…' : 'Reescribir'}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setMode('read')}>Cancelar</Button>
      </div>
    </div> : null}
  </div>;
  return <>{children({ actions, body })}</>;
}

function Part({ id, title, count, open, children }: { id: string; title: string; count?: number; open?: boolean; children: ReactNode }) {
  return <details id={`offer-${id}`} open={open} className="group rounded-2xl border bg-background">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <span className="text-sm font-semibold">{title}{count ? <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">{count}</span> : null}</span>
      <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span>
    </summary>
    <div className="space-y-4 border-t px-4 py-4">{children}</div>
  </details>;
}

export function OfferDraft({ offer, job, onPrepare, preparing, onSavePrices, downloadHref, annexHref, budget, canPrice = true, people = [], partJobs = [],
  onSavePart, onRewritePart, onReview, versionHref }: {
  offer: { available: boolean; latest: SavedOfferDraft | null; versions?: Array<{ id: string; created_at: string }> } | null | undefined;
  /** The latest «offer» job of the opportunity, if any. */
  job: OfferJob | null;
  onPrepare: (instructions: string) => void;
  preparing?: boolean;
  onSavePrices: (draftId: string, revision: number, prices: Record<string, string>) => Promise<{ revision: number; prices: OfferPrices } | null>;
  downloadHref: string;
  /** The Word of one form of the bases (by its place in the draft). */
  annexHref?: (index: number) => string;
  budget: { amount: number | null; includesTax: boolean | null };
  /** Whether this person sets the prices (an administrator or whoever is in charge); the rest of the team reads them. They also mark it reviewed. */
  canPrice?: boolean;
  /** The team's names, for «Editada por» and «Revisado por». */
  people?: Array<{ user_id: string; name: string }>;
  /** The parts the AI is rewriting or tried to, newest first. */
  partJobs?: PartJob[];
  /** A part in the team's words, or back to the AI's (null), from the edit the person saw (base). */
  onSavePart?: (draftId: string, part: string, text: string | null, base: string | null) => Promise<boolean>;
  onRewritePart?: (draftId: string, part: string, instructions: string, base: string | null) => Promise<boolean>;
  onReview?: (draftId: string, reviewed: boolean) => Promise<boolean>;
  /** The Word of an older version of the draft. */
  versionHref?: (id: string) => string;
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
  // What the page shows, copies and counts is the draft as the team left it.
  const shown = withOfferEdits(draft);
  const placeholders = offerPlaceholders(shown);
  const nameOf = (id?: string | null) => people.find(person => person.user_id === id)?.name ?? null;
  const editor = (part: string, label: string, render: (view: { actions: ReactNode; body: ReactNode }) => ReactNode, compact = false) => {
    const ai = offerPartText(draft, part) ?? ''; const edit = offerPartEdit(draft, part);
    return <OfferPart key={`${latest.id}:${part}`} id={part} label={label} part={{ ai, text: offerPartText(shown, part) ?? ai }} edit={edit} author={nameOf(edit?.by)}
      job={partJobs.find(item => item.part === part) ?? null} compact={compact}
      onSave={onSavePart ? (text, base) => onSavePart(latest.id, part, text, base) : undefined}
      onRewrite={onRewritePart ? (instructions, base) => onRewritePart(latest.id, part, instructions, base) : undefined}>{render}</OfferPart>;
  };
  const reviewed = offerReviewHolds(draft);
  const versions = offer.versions ?? [];
  return <section aria-labelledby="offer-title" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h3 id="offer-title" className="flex items-center gap-2 text-lg font-semibold"><FilePen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Tu oferta · borrador</h3>
        <p className="text-xs text-muted-foreground">Preparado el {when(latest.created_at)}. Revísalo y confirma cada dato con las bases antes de enviarlo.</p>
        {/* «Revisado por»: who read it last before it is handed in; a change after that asks for another look. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-sm">
          {draft.review ? <p className={cn('flex items-center gap-1.5', reviewed ? 'text-cw-success' : 'text-muted-foreground')}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Revisado por {nameOf(draft.review.by) ?? 'alguien del equipo'} el {when(draft.review.at)}{reviewed ? '' : '; cambió después'}</p>
            : <p className="text-muted-foreground">{canPrice ? 'Antes de presentarla, revísala completa y márcala como revisada.' : 'Aún no la revisa quien está a cargo.'}</p>}
          {canPrice && onReview && !reviewed ? <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void onReview(latest.id, true)}>Marcar como revisada</Button> : null}
        </div>
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

    {draft.letter ? <Part id="letter" title="Carta de presentación">
      {editor('letter', 'la carta de presentación', ({ actions, body }) => <><div className="-mt-2 flex justify-end">{actions}</div>{body}</>)}
    </Part> : null}

    <Part id="technical" title="Oferta técnica" count={draft.technical.length} open>
      {draft.summary ? editor('summary', 'el resumen de la oferta técnica', ({ actions, body }) =>
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1">{body}</div>{actions}</div>, true) : null}
      <ol className="space-y-5">
        {draft.technical.map((section, index) => <li key={`${index}:${section.heading}`} className="space-y-1.5">
          {editor(`technical:${index}`, `la sección «${section.heading}»`, ({ actions, body }) => <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{section.heading}</p>
                {section.criterion ? <p className="text-xs leading-5 text-muted-foreground">Responde a: {section.criterion}{section.weight ? <span className="ml-1 rounded-full bg-muted px-2 py-0.5 tabular-nums">{section.weight}</span> : null}</p> : null}
              </div>
              {actions}
            </div>
            {body}
          </>)}
          {section.evidence[0] ? <p className="text-xs leading-5 text-muted-foreground">Bases: «{section.evidence[0].quote.slice(0, 220)}»</p> : null}
        </li>)}
      </ol>
    </Part>

    {draft.compliance.length ? <Part id="compliance" title="Cumplimiento de requisitos técnicos" count={draft.compliance.length}>
      <ul className="divide-y">
        {draft.compliance.map((item, index) => <li key={`${index}:${item.requirement}`} className="space-y-1 py-3 text-sm leading-6 first:pt-0 last:pb-0">
          {editor(`compliance:${index}`, `la respuesta a «${item.requirement.slice(0, 60)}${item.requirement.length > 60 ? '…' : ''}»`, ({ actions, body }) => <>
            <div className="flex items-start justify-between gap-2"><p className="min-w-0 text-muted-foreground">{item.requirement}</p>{actions}</div>
            {body}
          </>, true)}
        </li>)}
      </ul>
    </Part> : null}

    {draft.economic.lines.length ? <EconomicSheet key={latest.id} saved={latest} budget={budget} onSave={onSavePrices} canPrice={canPrice} /> : null}

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

    {/* The versions before this one keep their Word, to compare (OPP-24). */}
    {versions.length && versionHref ? <p className="text-xs leading-5 text-muted-foreground">Versiones anteriores: {versions.map((version, index) => <Fragment key={version.id}>{index ? ' · ' : ''}
      <a className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={versionHref(version.id)}>{when(version.created_at)}<span className="sr-only"> (Word)</span></a></Fragment>)}</p> : null}
  </section>;
}

/** The lines to quote with the prices the team types, the totals with VAT and how they stand against the budget. */
export function EconomicSheet({ saved, budget, onSave, canPrice = true }: {
  saved: SavedOfferDraft; budget: { amount: number | null; includesTax: boolean | null }; canPrice?: boolean;
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
    <p className="text-sm leading-6 text-muted-foreground">{canPrice ? <>Escribe el precio unitario {basis} de cada línea{draft.economic.priceBasis === 'unknown' ? ' (las bases no dicen si el portal pide neto o total: confírmalo)' : ''}. Los totales se calculan solos.</>
      : <>Los precios los fija quien está a cargo de la oportunidad o un administrador. Tú los ves con sus totales; si crees que hay que cambiarlos, plantéalo como una decisión.</>}</p>
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
              <Input id={`offer-price-${row.index}`} inputMode="decimal" className="h-9 w-36 tabular-nums" placeholder="$0" value={typed[String(row.index)] ?? ''} readOnly={!canPrice} aria-readonly={!canPrice}
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
    {canPrice ? <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={() => void save()} disabled={!changed || state === 'saving'}>{state === 'saving' ? 'Guardando…' : 'Guardar precios'}</Button>
      {state === 'saved' && !changed ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />Guardados para el equipo</span> : null}
    </div> : null}
    {[draft.economic.validity ? `Vigencia de la oferta: ${draft.economic.validity}` : '', draft.economic.paymentTerms ? `Forma de pago: ${draft.economic.paymentTerms}` : '', ...draft.economic.notes].filter(Boolean).length
      ? <ul className="space-y-1 text-xs leading-5 text-muted-foreground">{[draft.economic.validity ? `Vigencia de la oferta: ${draft.economic.validity}` : '', draft.economic.paymentTerms ? `Forma de pago: ${draft.economic.paymentTerms}` : '', ...draft.economic.notes].filter(Boolean).map(line => <li key={line}>{line}</li>)}</ul> : null}
  </Part>;
}
