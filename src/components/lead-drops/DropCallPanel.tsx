'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Loader2, MessageCircle, Phone, RefreshCw } from 'lucide-react';
import { ContactActions } from '@/components/contact/ContactActions';
import { Button } from '@/components/ui/button';
import { telHref, whatsappHref } from '@/lib/contact-calls';
import { DROP_EMAIL_AND_PHONE_CREDITS, DROP_PHONE_CREDITS, dropCallText } from '@/lib/lead-drop-call';
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
export function DropCallPanel({ item, actions, busy, mail = false, collapsible = true, defaultOpen = false }: {
  item: DropItem; actions: DropCallActions;
  /** Another step is running in the page: the buttons wait. */
  busy: boolean; mail?: boolean; collapsible?: boolean;
  /** Open on arrival: «Llamar» of the email that brought its mobile leads here. */
  defaultOpen?: boolean;
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

  const body = <div id={`${uid}-call`} className={cn('space-y-4', collapsible && 'mt-2')}>
    <div className="space-y-2">
      {phone?.state === 'found' ? (mail
        ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
          <span className="select-all tabular-nums">{phone.number}{phone.more ? <span className="ml-1 text-muted-foreground">+{phone.more}</span> : null}</span>
          {tel ? <Button asChild size="sm" variant="outline" className="h-8"><a href={tel} aria-label={`Llamar a ${name} al ${phone.number}`}>
            <Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Llamar</a></Button> : null}
          {whatsapp ? <Button asChild size="sm" variant="outline" className="h-8">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`Escribir a ${name} por WhatsApp`}>
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></a></Button> : null}
        </div>
        : <ContactActions phone={phone.number} morePhones={phone.more} whatsappText={script?.whatsapp} className="text-sm"
          contact={{ leadId: item.savedLeadId ?? null, providerPersonId: item.leadId, name, company: item.company }} />)
        : phone?.state === 'pending' ? <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />Buscando su teléfono: suele tardar unos minutos y aparece aquí solo.</p>
          <Button variant="ghost" size="sm" className="h-8" disabled={stopped} onClick={() => void run('refresh', () => actions.refresh())}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', working === 'refresh' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Actualizar</Button>
        </div>
        : item.savedLeadId ? <div className="space-y-1">
          <Button variant="outline" size="sm" disabled={stopped} onClick={() => void run('phone', () => actions.phone(item))}>
            {working === 'phone' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Phone className="mr-2 h-4 w-4" aria-hidden="true" />}
            {working === 'phone' ? 'Buscando su teléfono…' : `Buscar su teléfono · ${DROP_PHONE_CREDITS} créditos`}</Button>
          <p className="text-xs text-muted-foreground">{phone?.state === 'none' && phone.missed ? 'La última búsqueda no encontró un teléfono para este contacto.' : 'Su móvil, para llamarlo o escribirle por WhatsApp.'}</p>
        </div>
        : <p className="text-sm text-muted-foreground">{needsLookup(item) ? `Su teléfono se busca al enriquecerlo: junto con el correo (${DROP_EMAIL_AND_PHONE_CREDITS} créditos por ambos) o después (${DROP_PHONE_CREDITS} más).` : 'Guárdalo primero: su teléfono se busca después.'}</p>}
    </div>

    {script ? <div className="space-y-3 rounded-xl border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Guion de llamada</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7" onClick={() => void copy()}>
            {copied ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}{copied ? 'Copiado' : 'Copiar'}</Button>
          <Button variant="ghost" size="sm" className="h-7" disabled={stopped} onClick={() => void run('script', () => actions.script(item, true))}>
            {working === 'script' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Otra versión</Button>
        </div>
      </div>
      <div className="space-y-1"><p className={labelClass}>Puntos de interés</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{script.points.map(point => <li key={point}>{point}</li>)}</ul></div>
      <div className="space-y-1"><p className={labelClass}>Al contestar</p><p className="text-sm leading-6">{script.opening}</p></div>
      <div className="space-y-1"><p className={labelClass}>Preguntas</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{script.questions.map(question => <li key={question}>{question}</li>)}</ul></div>
      {script.objections.length ? <div className="space-y-1"><p className={labelClass}>Si te dice…</p>
        <dl className="space-y-2 text-sm">{script.objections.map(entry => <div key={entry.objection}>
          <dt className="font-medium">«{entry.objection}»</dt><dd className="text-muted-foreground">{entry.answer}</dd></div>)}</dl></div> : null}
      <div className="space-y-1"><p className={labelClass}>Si no contesta</p><p className="text-sm leading-6">{script.voicemail}</p></div>
      <div className="space-y-1"><p className={labelClass}>Primer WhatsApp</p><p className="text-sm leading-6">{script.whatsapp}</p></div>
    </div>
    : <div className="space-y-1">
      <Button variant="outline" size="sm" disabled={stopped} onClick={() => void run('script', () => actions.script(item))}>
        {working === 'script' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {working === 'script' ? 'Preparando el guion…' : 'Preparar guion de llamada'}</Button>
      <p className="text-xs text-muted-foreground">Sus puntos de interés, qué decir al contestar, qué preguntar y qué responder. No usa créditos.</p>
    </div>}
  </div>;

  if (!collapsible) return <div className="space-y-2"><p className={labelClass}>Para llamar</p>{body}</div>;
  return <div>
    <Button variant="ghost" size="sm" className="-ml-2 h-auto min-h-9 justify-start whitespace-normal py-1.5 text-left text-muted-foreground" aria-expanded={open} aria-controls={`${uid}-call`} onClick={() => setOpen(value => !value)}>
      <ChevronDown className={cn('mr-1 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
      <span>Para llamar<span className="font-normal"> · {hint}</span></span></Button>
    {open ? body : null}
  </div>;
}
