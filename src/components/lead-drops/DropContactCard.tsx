'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, Check, ChevronDown, Copy, ExternalLink, Loader2, Mail, MailCheck, Pencil, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { dropEmailPreview, dropName, dropSchedule, needsLookup, placeLabel, shortDay, type DropFit, type DropItem } from '@/lib/lead-drops';
import { cn } from '@/lib/utils';

/** What the card asks its page to do with the contact: each answers when done, and the page shows what happened. */
export type DropContactActions = {
  enrich: (item: DropItem) => void;
  save: (item: DropItem) => void;
  approve: (item: DropItem) => Promise<void>;
  edit: (item: DropItem, emails: { draft: Email; followUps: Email[] }) => Promise<boolean>;
  feedback: (item: DropItem, useful: boolean, reason?: string) => Promise<void>;
};
type Email = { subject: string; body: string };
/**
 * The card opened from the person's inbox, outside the app (DropMailFlow, 13 Nov 2026): nothing links into the app, and what the
 * app does elsewhere is done here. The mailbox is connected from the card the first time, and an approved campaign is stopped from it.
 */
export type DropContactMail = {
  /** «Gmail» or «Outlook», the mailbox the campaign leaves from; null while none is connected. */
  mailbox: string | null;
  /** The contact's address, once looked up. */
  email: string | null;
  /** Where each mailbox is connected, once, and back to this page. */
  connect: { google: string; outlook: string };
  switchCampaign: (item: DropItem, to: 'pause' | 'resume') => Promise<void>;
};

const FIT: Record<DropFit['match'], string> = { yes: 'Calza', partial: 'Calza en parte', no: 'No calza', unknown: 'Sin dato' };
/** Why a contact does not help, in the person's words: the finder reads them (server/lead-drop-finder.ts, dropLessons). */
const NOT_USEFUL = ['El cargo no decide', 'La empresa no calza', 'Ya lo conozco', 'Otro motivo'];
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const linkClass = 'inline-flex items-center gap-1 rounded-sm underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';

/**
 * One contact of a «Contacto del día», to review and act on in one place (12 Nov 2026, docs/contacto-del-dia.md): why we recommend
 * it, said in two or three plain lines; what its company does and what is happening there now, with the source; how to open; and its
 * campaign, the first email and the follow-ups with the day each would go, which the person can change. One step at a time:
 * «Enriquecer» finds its email (1 credit), then «Aprobar y programar» starts the campaign from their Gmail or Outlook. «Me sirve» and
 * «No me sirve» teach the finder.
 */
export function DropContactCard({ item, actions, busy, enriching, defaultOpen = false, heading = 'h3', mail, collapsible = false }: {
  item: DropItem; actions: DropContactActions;
  /** Another contact is being saved or enriched: this one waits. */
  busy: boolean; enriching: boolean; defaultOpen?: boolean; heading?: 'h2' | 'h3'; mail?: DropContactMail;
  /** In «Hoy» (TodayContacts): who it is, one line of why and its next step; the rest opens on demand, so six contacts stay a list. */
  collapsible?: boolean;
}) {
  const uid = useId();
  const [expanded, setExpanded] = useState(!collapsible || defaultOpen);
  const [open, setOpen] = useState<'campaign' | 'fit' | null>(defaultOpen ? 'campaign' : null);
  const [editing, setEditing] = useState<{ draft: Email; followUps: Email[] } | null>(null);
  const [working, setWorking] = useState<'approve' | 'edit' | 'feedback' | 'switch' | null>(null);
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const Heading = heading;

  // To read and to copy, each email as the contact would get it (their name in place of «{{nombre}}»); to change, the text with its variables.
  const emails: Email[] = (item.draft ? [item.draft, ...(item.followUps || [])] : []).map(email => ({ subject: dropEmailPreview(email.subject, item), body: dropEmailPreview(email.body, item) }));
  // The day each email goes: from the day the campaign started, or from today while it is only a proposal.
  const days = dropSchedule(item, item.campaign ? new Date(item.campaign.approvedAt) : new Date());
  const brief = item.brief;
  // Two or three plain reasons: what the research says first, then what the offer and the role say.
  const reasons = [brief?.fit, brief?.role, ...(item.reasons || [])].filter((line): line is string => Boolean(line)).slice(0, 3);
  const opener = brief?.opener || item.approach || null;
  const about = brief?.company || item.summary || null;
  const person = [item.seniority, item.department, placeLabel(item)].filter(Boolean).join(' · ');
  const run = async (kind: NonNullable<typeof working>, work: () => Promise<unknown>) => { setWorking(kind); try { await work(); } finally { setWorking(null); } };
  const copy = async (index: number) => {
    try { await navigator.clipboard.writeText(`Asunto: ${emails[index].subject}\n\n${emails[index].body}`); setCopied(index); setTimeout(() => setCopied(null), 1800); } catch { /* the text can still be selected */ }
  };
  const saveEdit = () => editing && run('edit', async () => { if (await actions.edit(item, editing)) setEditing(null); });
  const section = (key: 'campaign' | 'fit', label: string, hint?: string) => <Button variant="ghost" size="sm" className="-ml-2 h-auto min-h-9 justify-start whitespace-normal py-1.5 text-left text-muted-foreground"
    aria-expanded={open === key} aria-controls={`${uid}-${key}`} onClick={() => setOpen(open === key ? null : key)}>
    <ChevronDown className={cn('mr-1 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none', open === key && 'rotate-180')} aria-hidden="true" />
    <span>{label}{hint ? <span className="font-normal"> · {hint}</span> : null}</span></Button>;

  const paused = Boolean(item.campaign?.pausedAt);
  const action = item.campaign
    ? mail ? <Button size="sm" variant="outline" disabled={busy || working !== null} onClick={() => void run('switch', () => mail.switchCampaign(item, paused ? 'resume' : 'pause'))}>
        {working === 'switch' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{paused ? 'Reanudar la campaña' : 'Detener la campaña'}</Button>
      : <Button asChild size="sm" variant="outline"><Link href={`/campaigns?campaign=${encodeURIComponent(item.campaign.id)}`}>Ver la campaña<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link></Button>
    : item.savedLeadId && emails.length
      // From the inbox with no mailbox yet: connecting one is the step, here and once.
      ? mail && !mail.mailbox ? <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button asChild size="sm"><a href={mail.connect.google}>Conectar Gmail</a></Button>
          <Button asChild size="sm" variant="outline"><a href={mail.connect.outlook}>Conectar Outlook</a></Button>
        </div>
      : <Button size="sm" disabled={busy || working !== null || Boolean(editing)} onClick={() => void run('approve', () => actions.approve(item))}>
        {working === 'approve' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
        {working === 'approve' ? 'Programando…' : 'Aprobar y programar'}</Button>
      : item.savedLeadId
        ? mail ? null : <Button asChild size="sm" variant="outline"><Link href={`/saved/leads/enriched?investigar=${encodeURIComponent(item.savedLeadId)}&empezar=1`}>Investigar y escribirle</Link></Button>
        : needsLookup(item)
          ? <Button size="sm" disabled={busy} onClick={() => actions.enrich(item)}>
            {enriching ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Mail className="mr-2 h-4 w-4" aria-hidden="true" />}
            {enriching ? 'Buscando su correo…' : 'Enriquecer · 1 crédito'}</Button>
          : <Button size="sm" disabled={busy} onClick={() => actions.save(item)}>{mail ? 'Guardar este contacto' : 'Guardar en «Por escribir»'}</Button>;
  // Under the button, what it does or where things stand: from the inbox it names the person's own mailbox and never a part of the app.
  const actionNote = !mail ? (!item.campaign && item.savedLeadId && emails.length ? 'Sale desde tu Gmail u Outlook. Se detiene si responde.' : null)
    : item.campaign ? (paused ? 'Detenida: no sale ningún correo más.' : `Sale desde tu ${item.campaign.provider === 'google' ? 'Gmail' : 'Outlook'}. Se detiene sola si responde.`)
    : item.savedLeadId && emails.length ? (mail.mailbox ? `Sale desde tu ${mail.mailbox}. Se detiene si responde.` : 'Es una sola vez: los correos salen desde tu propia casilla.')
    : item.savedLeadId ? null
    : needsLookup(item) ? (item.lookup?.missed ? 'La última búsqueda no encontró su correo.' : 'Busca su correo de trabajo para poder escribirle.') : null;

  return <article aria-labelledby={`${uid}-name`} className={cn('p-4 sm:p-5', expanded ? 'space-y-4' : 'space-y-2')}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Heading id={`${uid}-name`} className="text-base font-semibold">{dropName(item)}</Heading>
        <p className="text-sm text-muted-foreground">{[item.title, item.company].filter(Boolean).join(' · ')}</p>
        {person ? <p className="text-xs text-muted-foreground">{person}</p> : null}
        {mail?.email ? <p className="break-all text-sm">{mail.email}</p> : null}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"><MailCheck className="h-3 w-3" aria-hidden="true" />{item.savedLeadId ? 'Con su correo' : item.provider === 'apollo' ? 'Tiene correo' : 'Correo verificado'}</span>
          {item.track === 'explore' ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs" title="Un cargo vecino a los que buscas, para probar si también te sirve">Para explorar</span> : null}
          {item.campaign ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><CalendarClock className="h-3 w-3" aria-hidden="true" />{paused ? 'Campaña detenida' : 'Campaña en curso'}</span>
            : item.savedLeadId && !mail ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><Check className="h-3 w-3" aria-hidden="true" />En «Por escribir»</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
        {action}
        {actionNote ? <p className="text-xs text-muted-foreground sm:text-right">{actionNote}</p> : null}
      </div>
    </div>

    {collapsible ? <div className="space-y-1">
      {expanded ? null : <p className="line-clamp-2 text-sm text-muted-foreground">{reasons[0] || item.why}</p>}
      <Button variant="ghost" size="sm" className="-ml-2 h-auto min-h-9 justify-start whitespace-normal py-1.5 text-left text-muted-foreground" aria-expanded={expanded} aria-controls={`${uid}-detail`}
        onClick={() => setExpanded(value => !value)}>
        <ChevronDown className={cn('mr-1 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
        <span>{expanded ? 'Ocultar el detalle' : emails.length ? 'Ver por qué y su campaña' : 'Ver por qué te lo recomendamos'}<span className="sr-only">: {dropName(item)}</span></span></Button>
    </div> : null}

    {expanded ? <div id={`${uid}-detail`} className="space-y-4">
    <div className="space-y-1.5">
      <p className={labelClass}>Por qué te lo recomendamos</p>
      {reasons.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
      <p className={cn('text-sm', reasons.length && 'text-muted-foreground')}>{item.why}</p>
    </div>

    {about || brief?.news || item.website ? <div className="space-y-1.5">
      <p className={labelClass}>{item.company ? `Sobre ${item.company}` : 'Sobre la empresa'}</p>
      {about ? <p className="text-sm">{about}</p> : null}
      {brief?.news ? <p className="text-sm"><span className="font-medium">Ahora: </span>{brief.news.text}{' '}
        <a href={brief.news.url} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'text-muted-foreground')}>
          {[brief.news.source || hostOf(brief.news.url), brief.news.date].filter(Boolean).join(', ')}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (se abre en otra pestaña)</span></a></p> : null}
      {item.website ? <p className="text-sm"><a href={item.website} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {hostOf(item.website)}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (se abre en otra pestaña)</span></a></p> : null}
    </div> : null}

    {opener ? <div className="space-y-1.5"><p className={labelClass}>Cómo abrir</p><p className="text-sm">{opener}</p></div> : null}

    {emails.length ? <div>
      {section('campaign', item.campaign ? 'Su campaña' : 'Campaña lista', emails.length === 1 ? 'un correo' : `${emails.length} correos, del ${shortDay(days[0])} al ${shortDay(days[days.length - 1])}`)}
      {open === 'campaign' ? <div id={`${uid}-campaign`} className="mt-2 space-y-3">
        {editing ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); void saveEdit(); }}>
          {[editing.draft, ...editing.followUps].map((email, index) => {
            const change = (patch: Partial<Email>) => setEditing(current => current && (index === 0 ? { ...current, draft: { ...current.draft, ...patch } }
              : { ...current, followUps: current.followUps.map((step, at) => at === index - 1 ? { ...step, ...patch } : step) }));
            return <fieldset key={index} className="space-y-2 rounded-xl border bg-background p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">{index === 0 ? 'Primer correo' : `Seguimiento ${index}`} · {shortDay(days[index])}</legend>
              <div className="space-y-1"><Label htmlFor={`${uid}-subject-${index}`}>Asunto</Label>
                <Input id={`${uid}-subject-${index}`} value={email.subject} maxLength={200} required onChange={event => change({ subject: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor={`${uid}-body-${index}`}>Correo</Label>
                <Textarea id={`${uid}-body-${index}`} value={email.body} maxLength={4000} required rows={Math.min(14, Math.max(6, email.body.split('\n').length + 2))} onChange={event => change({ body: event.target.value })} /></div>
            </fieldset>;
          })}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={working !== null}>{working === 'edit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Guardar cambios</Button>
            <Button type="button" size="sm" variant="ghost" disabled={working !== null} onClick={() => setEditing(null)}>Cancelar</Button>
          </div>
          <p className="text-xs text-muted-foreground">{'{{nombre}}'} y {'{{empresa}}'} se reemplazan por sus datos al enviar.</p>
        </form> : <>
          <ol className="space-y-3">
            {emails.map((email, index) => <li key={index} className="rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{index === 0 ? 'Primer correo' : `Seguimiento ${index}`} · {shortDay(days[index])}{index ? ' · si no responde' : ''}</p>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => void copy(index)}>
                  {copied === index ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}{copied === index ? 'Copiado' : 'Copiar'}</Button>
              </div>
              <p className="mt-1 text-sm"><span className="text-muted-foreground">Asunto: </span><span className="font-medium">{email.subject}</span></p>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-6">{email.body}</p>
            </li>)}
          </ol>
          {item.campaign ? <p className="text-xs text-muted-foreground">{mail ? 'La campaña ya fue aprobada: sus correos ya no se cambian desde aquí.'
            : 'La campaña ya está en curso: para cambiar sus correos o pausarla, ábrela en «Campañas».'}</p>
            : <Button variant="outline" size="sm" onClick={() => item.draft && setEditing({ draft: { ...item.draft }, followUps: (item.followUps || []).map(step => ({ subject: step.subject, body: step.body })) })}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Editar los correos</Button>}
        </>}
      </div> : null}
    </div> : null}

    {item.fit?.length ? <div>
      {section('fit', 'Cómo calza con tu cliente ideal')}
      {open === 'fit' ? <dl id={`${uid}-fit`} className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {item.fit.map(entry => <div key={entry.criterion} className="min-w-0">
          <dt className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{entry.criterion}
            <span className={cn('rounded-full px-1.5 py-px', entry.match === 'yes' ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground/80')}>{FIT[entry.match]}</span></dt>
          <dd className="mt-0.5 text-sm">{entry.theirs}<span className="block text-xs text-muted-foreground">Buscas: {entry.wanted}</span></dd>
        </div>)}
      </dl> : null}
    </div> : null}

    <div className="flex flex-wrap items-center gap-2 border-t pt-3" role="group" aria-label={`¿Te sirve ${dropName(item)}?`}>
      <p className="text-xs text-muted-foreground">{item.feedback ? (item.feedback.useful ? 'Dijiste que te sirve: buscaremos más como este.'
        : `Dijiste que no te sirve${item.feedback.reason ? ` (${item.feedback.reason.toLowerCase()})` : ''}: lo tendremos en cuenta.`) : '¿Te sirve este contacto?'}</p>
      {asking ? NOT_USEFUL.map(reason => <Button key={reason} variant="outline" size="sm" className="h-8" disabled={working !== null}
        onClick={() => void run('feedback', async () => { await actions.feedback(item, false, reason); setAsking(false); })}>{reason}</Button>)
        : <>
          <Button variant={item.feedback?.useful === true ? 'secondary' : 'ghost'} size="sm" className="h-8" aria-pressed={item.feedback?.useful === true} disabled={working !== null}
            onClick={() => void run('feedback', () => actions.feedback(item, true))}><ThumbsUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Me sirve</Button>
          <Button variant={item.feedback?.useful === false ? 'secondary' : 'ghost'} size="sm" className="h-8" aria-pressed={item.feedback?.useful === false} disabled={working !== null}
            onClick={() => setAsking(true)}><ThumbsDown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />No me sirve</Button>
        </>}
    </div>
    </div> : null}
  </article>;
}
