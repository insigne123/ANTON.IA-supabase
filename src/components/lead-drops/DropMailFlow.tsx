'use client';

import { useEffect, useRef, useState } from 'react';
import { dropCredits } from '@/lib/lead-drop-call';
import { telHref } from '@/lib/contact-calls';
import { dropName, needsLookup, shortDay, type DropItem } from '@/lib/lead-drops';
import { enrichmentCreditReceipt } from '@/lib/leads-workspace/enrichment-provider';
import type { MailDropView } from '@/lib/server/lead-drop-mail';
import { cn } from '@/lib/utils';
import { DropBulkEnrich } from './DropBulkEnrich';
import { DropContactCard, type DropContactActions, type DropContactMail } from './DropContactCard';
import { DropContactsWorkspace } from './DropContactsWorkspace';
import { useCreditPrices } from '@/context/CreditPricesContext';
import { creditsLabel } from '@/lib/credit-prices';

const dayLabel = (day: string) => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
/** A name that closes a sentence: «Rodrigo S.» (a surname the search hid) already brings its full stop. */
const closing = (item: Pick<DropItem, 'name'>) => { const name = dropName(item); return name.endsWith('.') ? name : `${name}.`; };
const listed = (values: string[]) => values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', el ')} y el ${values[values.length - 1]}`;
/** What coming back from Gmail's or Outlook's consent says (provider-oauth-link.ts). */
const MAILBOX_NOTICE: Record<string, { ok: boolean; text: string }> = {
  conectado: { ok: true, text: 'Tu correo quedó conectado. Ya puedes aprobar y programar tus campañas.' },
  cancelado: { ok: false, text: 'No se conectó tu correo: faltó aceptar los permisos. Inténtalo de nuevo cuando quieras.' },
  otro: { ok: false, text: 'Ese no es el correo de tu cuenta, así que no lo conectamos. Elige el correo con el que entras a ANTON.IA; para enviar desde otro, conéctalo entrando a ANTON.IA.' },
  error: { ok: false, text: 'No pudimos conectar tu correo. Inténtalo de nuevo.' },
};
/** A lookup the provider is still answering: asked again every few seconds, for a minute. */
const POLL_MS = 5000;
const POLL_TIMES = 12;

/**
 * «Contacto del día» opened from the person's inbox (13 Nov 2026, docs/contacto-del-dia.md): the page a button of the morning email
 * or of «Campaña lista para aprobar» opens, with nothing to sign in to and none of the app around it. Each contact is its card
 * (DropContactCard): why, its company, its campaign, and one step at a time, «Enriquecer» (1 credit), then «Aprobar y programar»
 * from their own Gmail or Outlook, connected right here the first time. The link in the address is who asks (server/lead-drop-link.ts);
 * every step is a button, so arriving does nothing by itself.
 */
export function DropMailFlow({ token, initial, focus, mailboxNotice, bulk = null, call = false }: { token: string; initial: MailDropView; focus: string | null; mailboxNotice: string | null;
  /** «Enriquecer los N» of the morning email brought the person here with this choice made (DropBulkEnrich): the button confirms it. */ bulk?: 'email' | 'phone' | null;
  /** «Llamar» of the email that brought a mobile (lead-drop-ready-email.ts): mail clients drop `tel:` links, so the call starts here, at the contact. */ call?: boolean }) {
  const cost = dropCredits(useCreditPrices());
  const [view, setView] = useState(initial);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(mailboxNotice ? MAILBOX_NOTICE[mailboxNotice] ?? null : null);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The contact on screen: the one the email's button named, or the first that still has a step to take.
  const [selectedId, setSelectedId] = useState(() => focus ?? (initial.items.find(item => !item.campaign) ?? initial.items[0])?.leadId ?? '');
  // Someone who asks for the phone with every contact (MailDropView.phoneFirst): the choice comes made, unless the email's button made another.
  const [bulkPhone, setBulkPhone] = useState(bulk ? bulk === 'phone' : Boolean(initial.phoneFirst));
  const [bulkRun, setBulkRun] = useState<{ done: number; total: number; mailing: boolean } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // The contact the email linked to comes into view; what the address said is read once and leaves it (the link itself stays).
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, [focus, bulk]);
  // The number is dialled once on arrival; from then on its card has «Llamar», «WhatsApp» and the script.
  useEffect(() => {
    const phone = call && focus ? initial.items.find(item => item.leadId === focus)?.phone : null;
    const tel = phone?.state === 'found' ? telHref(phone.number) : null;
    if (tel) window.location.href = tel;
  }, [call, focus, initial]);

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/lead-drops/link', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(payload?.error || 'No pudimos completar la acción. Inténtalo de nuevo.'), { status: response.status });
    if (payload?.view && alive.current) setView(payload.view);
    return payload;
  };
  const act = async (body: Record<string, unknown>) => {
    setNotice(null);
    try { return await post(body); }
    catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'No pudimos completar la acción. Inténtalo de nuevo.' }); return null; }
  };
  /** The contact as the answer brings it: the lookup returns the surname the search had hidden. */
  const named = (payload: any, item: DropItem): DropItem => (payload?.view?.items as DropItem[] | undefined)?.find(entry => entry.leadId === item.leadId) ?? item;
  /** The provider is still looking: the address lands by itself, so the page asks until it is there. */
  const waitFor = async (item: DropItem) => {
    for (let time = 0; time < POLL_TIMES && alive.current; time++) {
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
      const payload = await post({ action: 'read' }).catch(() => null);
      if (payload?.view?.emails?.[item.leadId]) { setNotice({ ok: true, text: `Listo: encontramos el correo de ${closing(named(payload, item))} Revisa su campaña y apruébala.` }); return; }
    }
  };
  const enrich = async (item: DropItem, withPhone = false) => {
    if (enriching || saving) return;
    setEnriching(item.leadId);
    try {
      const payload = await act({ action: 'enrich', leadId: item.leadId, ...(withPhone ? { phone: true } : {}) });
      const lookup = payload?.lookup as { outcome: 'found' | 'pending' | 'not_found'; consumed: number } | undefined;
      if (!lookup) return;
      const receipt = enrichmentCreditReceipt(lookup.consumed);
      const phoneNote = withPhone ? ' Su teléfono llega en unos minutos, en «Llamada».' : '';
      if (lookup.outcome === 'found') setNotice({ ok: true, text: `Listo: encontramos el correo de ${closing(named(payload, item))} Revisa su campaña y apruébala.${phoneNote} ${receipt}`.trim() });
      else if (lookup.outcome === 'not_found') setNotice({ ok: false, text: `No encontramos un correo para ${closing(item)} ${receipt || 'No se descontó ningún crédito.'}` });
      else { setNotice({ ok: true, text: `Seguimos buscando el correo de ${dropName(item)}: aparecerá aquí en un momento.` }); await waitFor(item); }
    } finally { if (alive.current) setEnriching(null); }
  };
  /**
   * «Enriquecer los N»: each contact without an email is looked up, one after another, and the answer goes to the person's inbox
   * in the conversation of the morning email (server/lead-drop-ready.ts). A refusal that the next one would get too (no credits,
   * today's quota, a link that ended) stops it there; anything else skips that contact and goes on.
   */
  const enrichAll = async () => {
    if (enriching || saving || bulkRun) return;
    const targets = view.items.filter(item => needsLookup(item));
    if (targets.length < 2) return;
    const withPhone = bulkPhone;
    setNotice(null);
    let found = 0, consumed = 0, failed = 0, stopped: string | null = null;
    const missed: DropItem[] = [];
    for (let index = 0; index < targets.length && alive.current; index++) {
      const item = targets[index];
      setBulkRun({ done: index, total: targets.length, mailing: false });
      setEnriching(item.leadId);
      try {
        const lookup = (await post({ action: 'enrich', leadId: item.leadId, quiet: true, ...(withPhone ? { phone: true } : {}) }))?.lookup as { outcome: 'found' | 'pending' | 'not_found'; consumed: number } | undefined;
        consumed += Number(lookup?.consumed) || 0;
        if (lookup?.outcome === 'found') found++;
        else if (lookup?.outcome === 'not_found') missed.push(item);
      } catch (e) {
        if ([404, 409, 410, 429].includes(Number((e as { status?: number })?.status))) { stopped = e instanceof Error ? e.message : null; break; }
        failed++;
      }
    }
    if (!alive.current) return;
    setEnriching(null);
    let mailed = false;
    if (found) {
      setBulkRun({ done: targets.length, total: targets.length, mailing: true });
      mailed = Boolean((await post({ action: 'ready', ...(withPhone ? { phone: true } : {}) }).catch(() => null))?.mailed);
    }
    if (!alive.current) return;
    setBulkRun(null);
    const parts = [
      found ? `Listo: encontramos el correo de ${found === targets.length ? `tus ${found} contactos` : `${found} de ${targets.length}`}.` : stopped ? null : 'No encontramos el correo de ninguno.',
      found ? (mailed ? 'Te lo enviamos a tu correo, en la conversación de esta mañana, con cada campaña lista para aprobar.' : 'Revisa aquí cada campaña y apruébala.') : null,
      found && withPhone ? 'Sus teléfonos llegan en unos minutos, con el guion de cada llamada.' : null,
      missed.length ? `Sin correo: ${missed.slice(0, -1).map(item => `${dropName(item)}, `).join('')}${closing(missed[missed.length - 1])}` : null,
      failed ? `${failed === 1 ? 'Una búsqueda no respondió' : `${failed} búsquedas no respondieron`}: inténtalas de nuevo desde su tarjeta.` : null,
      stopped ? `Nos detuvimos antes de terminar. ${stopped}` : null,
      enrichmentCreditReceipt(consumed) || null,
    ].filter(Boolean);
    setNotice({ ok: found > 0, text: parts.join(' ') });
  };
  const actions: DropContactActions = {
    enrich: (item, withPhone) => void enrich(item, withPhone),
    phone: async item => {
      const done = await act({ action: 'phone', leadId: item.leadId });
      const found = done?.phone as { outcome: 'found' | 'pending' | 'not_found'; consumed: number } | undefined;
      if (!found) return;
      const receipt = enrichmentCreditReceipt(found.consumed);
      setNotice(found.outcome === 'found' ? { ok: true, text: `Listo: ya tienes el teléfono de ${closing(item)} ${receipt}`.trim() }
        : found.outcome === 'pending' ? { ok: true, text: `Buscando el teléfono de ${dropName(item)}: suele tardar unos minutos y aparece solo en «Llamada». Usa ${creditsLabel(cost.phone)}.` }
        : { ok: false, text: `No encontramos un teléfono para ${closing(item)} ${receipt}`.trim() });
    },
    script: async (item, fresh) => { await act({ action: 'script', leadId: item.leadId, ...(fresh ? { fresh: true } : {}) }); },
    refresh: async () => { await post({ action: 'read' }).catch(() => null); },
    save: item => {
      if (saving || enriching) return;
      setSaving(true);
      void act({ action: 'save', leadId: item.leadId }).then(payload => {
        if (payload) setNotice(payload.expired ? { ok: false, text: 'Este contacto venció: pasaron más de 30 días desde que lo encontramos.' } : { ok: true, text: `Guardamos a ${dropName(item)}, con su correo.` });
      }).finally(() => { if (alive.current) setSaving(false); });
    },
    approve: async item => {
      const done = await act({ action: 'approve', leadId: item.leadId });
      if (!done?.provider) return;
      const later = (Array.isArray(done.schedule) ? done.schedule as string[] : []).slice(1).map(shortDay);
      setNotice({ ok: true, text: `Campaña de ${dropName(item)} programada desde tu ${done.provider}: el primer correo sale en unos minutos${later.length
        ? ` y ${later.length === 1 ? 'el seguimiento' : 'los seguimientos'} el ${listed(later)}` : ''}. Se detiene sola si responde.` });
    },
    edit: async (item, emails) => {
      const done = await act({ action: 'edit', leadId: item.leadId, emails });
      if (done) setNotice({ ok: true, text: `Guardamos tus cambios en los correos de ${closing(item)}` });
      return Boolean(done);
    },
    feedback: async (item, useful, reason, wish) => { await act({ action: 'feedback', leadId: item.leadId, feedback: { useful, reason: reason ?? null, ...(wish !== undefined ? { wish } : {}) } }); },
  };
  const connect = (provider: 'google' | 'azure') => `/api/auth/connect/${provider}?enlace=${encodeURIComponent(token)}`;
  const mailOf = (item: DropItem): DropContactMail => ({
    mailbox: view.mailbox, email: view.emails[item.leadId] ?? null, connect: { google: connect('google'), outlook: connect('azure') },
    switchCampaign: async (entry, to) => {
      const done = await act({ action: to, leadId: entry.leadId });
      if (done) setNotice({ ok: true, text: to === 'pause' ? `Detuvimos la campaña de ${dropName(entry)}: no sale ningún correo más.` : `La campaña de ${dropName(entry)} sigue desde donde quedó.` });
    },
  });

  const items = view.items;
  const toLook = items.filter(item => needsLookup(item)).length;
  const running = items.filter(item => item.campaign).length;
  const toApprove = items.filter(item => item.savedLeadId && item.draft && !item.campaign).length;
  const steps = [{ label: 'Por enriquecer', value: toLook }, { label: 'Por aprobar', value: toApprove }, { label: 'En marcha', value: running }];
  const several = items.length > 1;
  const selected = items.find(item => item.leadId === selectedId) ?? items[0];
  const card = (item: DropItem) => <DropContactCard key={item.leadId} item={item} actions={actions} mail={mailOf(item)} heading="h2"
    busy={saving || enriching !== null || bulkRun !== null} enriching={enriching === item.leadId} defaultOpen={item.leadId === focus} callOpen={call && item.leadId === focus} phoneFirst={Boolean(view.phoneFirst)} />;
  return <main className={cn('mx-auto w-full px-4 py-6 sm:py-10', several ? 'max-w-6xl' : 'max-w-3xl')}>
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        {/* The page says only what it is. Since 16 Nov 2026 no button of the emails leads here: they open the app (src/app/contactos/[token]). */}
        <h1 className="font-headline text-2xl font-semibold tracking-tight sm:text-3xl">{several ? 'Tus contactos de hoy' : 'Tu contacto de hoy'}</h1>
        <p className="text-sm text-muted-foreground">{`Elegidos para ti el ${dayLabel(view.date)}.`}</p>
      </div>
      {several ? <dl className="grid grid-cols-3 gap-2 sm:w-[22rem]">
        {steps.map(entry => <div key={entry.label} className="rounded-xl border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{entry.label}</dt>
          <dd className={cn('text-xl font-semibold tabular-nums', !entry.value && 'text-foreground/50')}>{entry.value}</dd>
        </div>)}
      </dl> : null}
    </header>

    <p role="status" aria-live="polite" className={cn('mt-4 rounded-xl px-4 py-3 text-sm', !notice && 'sr-only', notice && (notice.ok ? 'bg-primary/10 text-foreground' : 'bg-destructive/10 text-foreground'))}>{notice?.text ?? ''}</p>

    {toLook >= 2 || bulkRun ? <DropBulkEnrich count={toLook} phone={bulkPhone} onPhone={setBulkPhone} onStart={() => void enrichAll()} running={bulkRun} disabled={saving || (enriching !== null && !bulkRun)} /> : null}

    <div className="mt-6">
      {several ? <DropContactsWorkspace items={items} selectedId={selected.leadId} onSelect={setSelectedId}>{card(selected)}</DropContactsWorkspace>
        : <div id={`contacto-${selected.leadId}`} className="overflow-hidden rounded-2xl border bg-card shadow-sm">{card(selected)}</div>}
    </div>

    <p className="mt-6 max-w-3xl text-xs leading-5 text-muted-foreground">
      Enriquecer busca el correo de trabajo del contacto y usa {creditsLabel(cost.email)}; con su teléfono, {cost.both} por ambos. Al aprobar, los correos salen desde tu propio Gmail u Outlook y las respuestas te llegan ahí.
      Esta página es personal: se abre con el enlace de tu correo, así que no lo reenvíes.
    </p>
  </main>;
}
