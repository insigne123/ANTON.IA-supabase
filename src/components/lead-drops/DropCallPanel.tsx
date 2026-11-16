'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, CircleHelp, Copy, Loader2, MessageCircle, Phone, Quote, RefreshCw, Target, Voicemail } from 'lucide-react';
import { ContactActions } from '@/components/contact/ContactActions';
import { Button } from '@/components/ui/button';
import { telHref, whatsappHref } from '@/lib/contact-calls';
import { DROP_EMAIL_AND_PHONE_CREDITS, DROP_PHONE_CREDITS, dropCallText, splitTopic } from '@/lib/lead-drop-call';
import { dropName, needsLookup, type DropItem } from '@/lib/lead-drops';
import { cn } from '@/lib/utils';

/** What the panel asks its page to do: each answers when done, and the page says what happened. */
export type DropCallActions = {
  phone: (item: DropItem) => Promise<void>;
  script: (item: DropItem, fresh?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
/** A mobile on its way lands by itself in minutes: read again this often, this many times, without a tap. */
const WAIT_MS = 20_000;
const WAIT_TIMES = 12;

/**
 * «Para llamar» in a contact of «Contacto del día» (15 Nov 2026, src/lib/lead-drop-call.ts; the owner: «necesito que puedan también
 * enriquecer con teléfono y que les hagamos un guion personalizado, con un listado de puntos de interés para el lead»). Its mobile:
 * the number with «Llamar» and «WhatsApp», a lookup on its way, or the button that looks it up once the contact is in «Por escribir».
 * And the script of the call, prepared when asked and kept: what matters to that person, how to open, what to ask, what to answer,
 * the voicemail and a first WhatsApp line, which is the text WhatsApp opens with.
 *
 * `mail`: opened from the person's inbox, where nobody is signed in: the number's two ways are plain links, without the app's record
 * of the call. `collapsible`: folded under its heading, as the other parts of a card; a page of one contact shows it open.
 */
export function DropCallPanel({ item, actions, busy, mail = false, collapsible = true, defaultOpen = false, bare = false }: {
  item: DropItem; actions: DropCallActions;
  /** Another step is running in the page: the buttons wait. */
  busy: boolean; mail?: boolean; collapsible?: boolean;
  /** Open on arrival: «Llamar» of the email that brought its mobile leads here. */
  defaultOpen?: boolean;
  /** Inside a tab of its own (DropContactCard): the tab is its heading, so it brings none. */
  bare?: boolean;
}) {
  const uid = useId();
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  const [working, setWorking] = useState<'phone' | 'script' | 'refresh' | null>(null);
  const [copied, setCopied] = useState(false);
  const phone = item.phone;
  const script = item.call?.script ?? null;
  const name = dropName(item);
  const run = async (kind: NonNullable<typeof working>, work: () => Promise<unknown>) => { setWorking(kind); try { await work(); } finally { setWorking(null); } };
  const copy = async () => {
    if (!script) return;
    try { await navigator.clipboard.writeText(dropCallText(script, name)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* the text can still be selected */ }
  };
  const refresh = useRef(actions.refresh);
  refresh.current = actions.refresh;
  const waiting = phone?.state === 'pending';
  useEffect(() => {
    if (!waiting) return;
    let times = 0;
    const timer = setInterval(() => { if (++times > WAIT_TIMES) { clearInterval(timer); return; } void refresh.current().catch(() => undefined); }, WAIT_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  const hint = phone?.state === 'found' ? phone.number : phone?.state === 'pending' ? 'buscando su teléfono' : script ? 'guion listo' : 'teléfono y guion';
  const stopped = busy || working !== null;
  const tel = phone?.state === 'found' ? telHref(phone.number) : null;
  const whatsapp = phone?.state === 'found' ? whatsappHref(phone.number, script?.whatsapp) : null;

  const block = 'rounded-xl border bg-background p-4';
  const phoneLine = phone?.state === 'found' ? <span className="select-all text-lg font-semibold tabular-nums tracking-tight">{phone.number}{phone.more ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">+{phone.more}</span> : null}</span>
    : phone?.state === 'pending' ? <span role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />Buscando su teléfono: suele tardar unos minutos y aparece aquí solo.</span>
    : item.savedLeadId ? <span className="text-sm text-muted-foreground">{phone?.state === 'none' && phone.missed ? 'La última búsqueda no encontró un teléfono para este contacto.' : 'Su móvil, para llamarlo o escribirle por WhatsApp.'}</span>
    : <span className="text-sm text-muted-foreground">{needsLookup(item) ? `Su teléfono se busca al enriquecerlo: junto con el correo (${DROP_EMAIL_AND_PHONE_CREDITS} créditos por ambos) o después (${DROP_PHONE_CREDITS} más).` : 'Guárdalo primero: su teléfono se busca después.'}</span>;
  // From the inbox the number's two ways are plain links. The card's own step stays its one filled button: «Llamar» is outlined.
  const phoneActions = phone?.state === 'found' ? (mail
    ? <div className="flex flex-wrap gap-2">
      {tel ? <Button asChild size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"><a href={tel} aria-label={`Llamar a ${name} al ${phone.number}`}><Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />Llamar</a></Button> : null}
      {whatsapp ? <Button asChild size="sm" variant="outline">
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`Escribir a ${name} por WhatsApp`}>
          <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></a></Button> : null}
    </div>
    : <ContactActions phone={phone.number} morePhones={phone.more} whatsappText={script?.whatsapp} className="text-base font-medium"
      contact={{ leadId: item.savedLeadId ?? null, providerPersonId: item.leadId, name, company: item.company }} />)
    : phone?.state === 'pending' ? <Button variant="ghost" size="sm" disabled={stopped} onClick={() => void run('refresh', () => actions.refresh())}>
      <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', working === 'refresh' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Actualizar</Button>
    : item.savedLeadId ? <Button variant="outline" size="sm" disabled={stopped} onClick={() => void run('phone', () => actions.phone(item))}>
      {working === 'phone' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Phone className="mr-2 h-4 w-4" aria-hidden="true" />}
      {working === 'phone' ? 'Buscando su teléfono…' : `Buscar su teléfono · ${DROP_PHONE_CREDITS} créditos`}</Button>
    : null;
  // In the app the number's own row («Llamar», «WhatsApp», what happened) already shows the number: it is not said twice.
  const inApp = phone?.state === 'found' && !mail;

  const body = <div id={`${uid}-call`} className={cn('space-y-4', collapsible && 'mt-2')}>
    <div className={cn(block, 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')}>
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', phone?.state === 'found' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
          <Phone className="h-4 w-4" /></span>
        <div className="min-w-0 space-y-0.5"><p className={labelClass}>Su teléfono</p>{inApp ? phoneActions : phoneLine}</div>
      </div>
      {phoneActions && !inApp ? <div className="shrink-0">{phoneActions}</div> : null}
    </div>

    {script ? <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Guion de llamada</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-8" onClick={() => void copy()}>
            {copied ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}{copied ? 'Copiado' : 'Copiar'}</Button>
          <Button variant="ghost" size="sm" className="h-8" disabled={stopped} onClick={() => void run('script', () => actions.script(item, true))}>
            {working === 'script' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Otra versión</Button>
        </div>
      </div>
      {/* What is said first, first and largest: the rest is there to glance at during the call. */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <p className={cn(labelClass, 'flex items-center gap-1.5 text-primary')}><Quote className="h-3.5 w-3.5" aria-hidden="true" />Al contestar</p>
        <p className="mt-1.5 text-[15px] leading-7">{script.opening}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={block}><p className={cn(labelClass, 'flex items-center gap-1.5')}><Target className="h-3.5 w-3.5" aria-hidden="true" />Puntos de interés</p>
          <ul className="mt-2 space-y-2.5">{script.points.map(point => { const { topic, rest } = splitTopic(point);
            return <li key={point} className="flex gap-2.5 text-sm leading-6"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
              <span>{topic ? <><span className="font-semibold">{topic}:</span> {rest}</> : rest}</span></li>; })}</ul></div>
        <div className={block}><p className={cn(labelClass, 'flex items-center gap-1.5')}><CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />Preguntas</p>
          <ol className="mt-2 space-y-2.5">{script.questions.map((question, index) => <li key={question} className="flex gap-2.5 text-sm leading-6">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">{index + 1}</span><span>{question}</span></li>)}</ol></div>
      </div>
      {script.objections.length ? <div className={block}><p className={labelClass}>Si te dice…</p>
        <dl className="mt-1 divide-y">{script.objections.map(entry => <div key={entry.objection} className="grid gap-1 py-2.5 text-sm leading-6 last:pb-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
          <dt className="font-medium">«{entry.objection.replace(/[.\s]+$/, '')}»</dt><dd className="text-foreground/80">{entry.answer}</dd></div>)}</dl></div> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={block}><p className={cn(labelClass, 'flex items-center gap-1.5')}><Voicemail className="h-3.5 w-3.5" aria-hidden="true" />Si no contesta</p><p className="mt-1.5 text-sm leading-6">{script.voicemail}</p></div>
        <div className={block}><p className={cn(labelClass, 'flex items-center gap-1.5')}><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />Primer WhatsApp</p><p className="mt-1.5 text-sm leading-6">{script.whatsapp}</p></div>
      </div>
    </div>
    : <div className={cn(block, 'flex flex-col gap-3 border-dashed sm:flex-row sm:items-center sm:justify-between')}>
      <div className="space-y-0.5"><p className="text-sm font-medium">Guion de llamada</p>
        <p className="text-sm text-muted-foreground">Sus puntos de interés, qué decir al contestar, qué preguntar y qué responder. No usa créditos.</p></div>
      <Button variant="outline" size="sm" className="shrink-0" disabled={stopped} onClick={() => void run('script', () => actions.script(item))}>
        {working === 'script' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {working === 'script' ? 'Preparando el guion…' : 'Preparar guion de llamada'}</Button>
    </div>}
  </div>;

  if (bare) return body;
  if (!collapsible) return <div className="space-y-2"><p className={labelClass}>Llamada</p>{body}</div>;
  return <div>
    <Button variant="ghost" size="sm" className="-ml-2 h-auto min-h-9 justify-start whitespace-normal py-1.5 text-left text-muted-foreground" aria-expanded={open} aria-controls={`${uid}-call`} onClick={() => setOpen(value => !value)}>
      <ChevronDown className={cn('mr-1 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
      <span>Llamada<span className="font-normal"> · {hint}</span></span></Button>
    {open ? body : null}
  </div>;
}
