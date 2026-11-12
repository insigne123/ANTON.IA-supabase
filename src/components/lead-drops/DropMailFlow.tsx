'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { dropName, needsLookup, shortDay, type DropItem } from '@/lib/lead-drops';
import { enrichmentCreditReceipt } from '@/lib/leads-workspace/enrichment-provider';
import type { MailDropView } from '@/lib/server/lead-drop-mail';
import { cn } from '@/lib/utils';
import { DropContactCard, type DropContactActions, type DropContactMail } from './DropContactCard';

const dayLabel = (day: string) => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
/** A name that closes a sentence: «Rodrigo S.» (a surname the search hid) already brings its full stop. */
const closing = (item: Pick<DropItem, 'name'>) => { const name = dropName(item); return name.endsWith('.') ? name : `${name}.`; };
const listed = (values: string[]) => values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', el ')} y el ${values[values.length - 1]}`;
/** What coming back from Gmail's or Outlook's consent says (provider-oauth-link.ts). */
const MAILBOX_NOTICE: Record<string, { ok: boolean; text: string }> = {
  conectado: { ok: true, text: 'Tu correo quedó conectado. Ya puedes aprobar y programar tus campañas.' },
  cancelado: { ok: false, text: 'No se conectó tu correo: faltó aceptar los permisos. Inténtalo de nuevo cuando quieras.' },
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
export function DropMailFlow({ token, initial, focus, mailboxNotice }: { token: string; initial: MailDropView; focus: string | null; mailboxNotice: string | null }) {
  const [view, setView] = useState(initial);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(mailboxNotice ? MAILBOX_NOTICE[mailboxNotice] ?? null : null);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // The contact the email linked to comes into view; what the address said is read once and leaves it (the link itself stays).
  useEffect(() => {
    if (focus) document.getElementById(`contacto-${focus}`)?.scrollIntoView?.({ block: 'start' });
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, [focus]);

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/lead-drops/link', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'No pudimos completar la acción. Inténtalo de nuevo.');
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
  const enrich = async (item: DropItem) => {
    if (enriching || saving) return;
    setEnriching(item.leadId);
    try {
      const payload = await act({ action: 'enrich', leadId: item.leadId });
      const lookup = payload?.lookup as { outcome: 'found' | 'pending' | 'not_found'; consumed: number } | undefined;
      if (!lookup) return;
      const receipt = enrichmentCreditReceipt(lookup.consumed);
      if (lookup.outcome === 'found') setNotice({ ok: true, text: `Listo: encontramos el correo de ${closing(named(payload, item))} Revisa su campaña y apruébala. ${receipt}`.trim() });
      else if (lookup.outcome === 'not_found') setNotice({ ok: false, text: `No encontramos un correo para ${closing(item)} ${receipt || 'No se descontó ningún crédito.'}` });
      else { setNotice({ ok: true, text: `Seguimos buscando el correo de ${dropName(item)}: aparecerá aquí en un momento.` }); await waitFor(item); }
    } finally { if (alive.current) setEnriching(null); }
  };
  const actions: DropContactActions = {
    enrich: item => void enrich(item),
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
    feedback: async (item, useful, reason) => { await act({ action: 'feedback', leadId: item.leadId, feedback: { useful, reason: reason ?? null } }); },
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
  const status = [
    toLook ? `${toLook} por enriquecer` : null,
    toApprove ? `${toApprove} ${toApprove === 1 ? 'campaña lista' : 'campañas listas'} para aprobar` : null,
    running ? `${running} ${running === 1 ? 'campaña aprobada' : 'campañas aprobadas'}` : null,
  ].filter(Boolean).join(' · ');
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
    <header className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ANTON.IA</p>
      <h1 className="font-headline text-2xl font-semibold tracking-tight">{items.length === 1 ? 'Tu contacto de hoy' : 'Tus contactos de hoy'}</h1>
      <p className="text-sm text-muted-foreground">{`Elegidos para ti el ${dayLabel(view.date)}.`}{status ? ` ${status}.` : ''}</p>
    </header>

    <p role="status" aria-live="polite" className={cn('mt-4 rounded-xl px-4 py-3 text-sm', !notice && 'sr-only', notice && (notice.ok ? 'bg-primary/10 text-foreground' : 'bg-destructive/10 text-foreground'))}>{notice?.text ?? ''}</p>

    <Card className="mt-6 rounded-2xl">
      <CardContent className="divide-y p-0">
        {items.map(item => <div key={item.leadId} id={`contacto-${item.leadId}`} className="scroll-mt-4">
          <DropContactCard item={item} actions={actions} mail={mailOf(item)} heading="h2"
            busy={saving || enriching !== null} enriching={enriching === item.leadId} defaultOpen={item.leadId === focus || items.length === 1} />
        </div>)}
      </CardContent>
    </Card>

    <p className="mt-6 text-xs leading-5 text-muted-foreground">
      Enriquecer busca el correo de trabajo del contacto y usa 1 crédito. Al aprobar, los correos salen desde tu propio Gmail u Outlook y las respuestas te llegan ahí.
      Esta página es personal: se abre con el enlace de tu correo, así que no lo reenvíes.
    </p>
  </main>;
}
