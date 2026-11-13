'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { DropContactCard } from '@/components/lead-drops/DropContactCard';
import { useDropActions } from '@/components/lead-drops/useDropActions';
import { dayInZone } from '@/lib/admin/chile-time';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { dropHref, dropIdInLink, type DropItem } from '@/lib/lead-drops';
import { cn } from '@/lib/utils';

export type DropBoard = { id: string; date: string; items: DropItem[] };

const dayLabel = (day: string) => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** The contacts' own page, outside the app, told not to send the person back here (src/app/contactos/[token]). */
const ownPage = (token: string, leadId: string | null) => `/contactos/${encodeURIComponent(token)}?aqui=1${leadId ? `&c=${encodeURIComponent(leadId)}` : ''}`;
/**
 * What an email's link asks of «Hoy» (`?contactos=<link>&c=<contact>`): the contact to bring into view when its contacts are the ones
 * on screen, or `away`, their own page, when they are not (an earlier email, another team, nothing to show). Null without a link.
 */
export function linkedArrival(search: string, boardId: string | null): { focus: string | null; away: string | null } | null {
  const params = new URLSearchParams(search);
  const token = params.get('contactos');
  if (!token) return null;
  const leadId = params.get('c');
  return boardId && dropIdInLink(token) === boardId ? { focus: leadId, away: null } : { focus: null, away: ownPage(token, leadId) };
}

/**
 * «Tus contactos de hoy» in «Hoy» (13 Nov 2026, the owner: «que sea una sección especial dentro del sistema, en Hoy; le deberíamos
 * dar más importancia»): the contacts of a drop of several (src/lib/server/lead-drops.ts, homeDrop) as the first thing of the page,
 * beside the week's goal. Each is a row with who it is, one line of why and its next step, «Enriquecer» (1 credit) then «Aprobar y
 * programar»; the rest of its card (why, its company, its campaign to read and change) opens in place. A drop of one contact keeps
 * its line under the next step (LeadDropBanner).
 *
 * A button of the morning email opens here when the person is signed in (`?contactos=<the email's link>&c=<contact>`): that contact
 * comes into view, open. When the link is of other contacts than the ones on screen (an earlier email, another team), their own
 * page opens them, as the email meant.
 */
export function TodayContacts({ board, ready }: { board: DropBoard | null | undefined; /** «Hoy» already knows whether there are contacts. */ ready: boolean }) {
  // The address is read once, as the page opened: it is cleared below, and the contact it named stays open.
  const [search] = useState(() => typeof window === 'undefined' ? '' : window.location.search);
  const arrival = ready ? linkedArrival(search, board?.id ?? null) : null;
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrival || arrived.current) return;
    arrived.current = true;
    if (arrival.away) { window.location.replace(arrival.away); return; }
    window.history.replaceState(null, '', '/dashboard');
    const target = (arrival.focus && document.getElementById(`contacto-${arrival.focus}`)) || document.getElementById('contactos-de-hoy');
    target?.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [arrival]);
  if (!board) return null;
  return <Board key={board.id} board={board} focus={arrival?.focus ?? null} />;
}

function Board({ board, focus }: { board: DropBoard; focus: string | null }) {
  const { organizationId } = useAuth();
  const [items, setItems] = useState(board.items);
  const call = useCallback((path: string, init?: RequestInit) => authenticatedApiFetch(path, {
    cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-organization-id': organizationId } : {}) },
  }), [organizationId]);
  const { saving, enriching, notice, actions } = useDropActions({ dropId: board.id, call, setItems, single: false });

  // Where each contact stands: its email to look up, its campaign to approve, or its campaign going out.
  const toEnrich = items.filter(item => !item.savedLeadId).length;
  const toApprove = items.filter(item => item.savedLeadId && item.draft && !item.campaign).length;
  const running = items.filter(item => item.campaign).length;
  const today = board.date === dayInZone(new Date());
  const done = !toEnrich && !toApprove;
  const title = done && running ? (running === 1 ? 'Tu campaña ya está en marcha' : `Tus ${running} campañas ya están en marcha`)
    : today ? `${items.length} contactos nuevos para ti` : `Te ${toEnrich + toApprove === 1 ? 'queda 1 contacto' : `quedan ${toEnrich + toApprove} contactos`} por revisar`;
  const lead = toEnrich ? 'Elegidos con tu cliente ideal, cada uno con su campaña escrita. Enriquece los que te interesen y aprueba su campaña: sale desde tu Gmail u Outlook.'
    : toApprove ? 'Revisa cada campaña y apruébala: sale desde tu Gmail u Outlook, y se detiene sola si responden.'
    : 'No queda nada por hacer aquí: cada campaña se detiene sola si responden.';
  const steps = [{ label: 'Por enriquecer', value: toEnrich }, { label: 'Por aprobar', value: toApprove }, { label: 'En marcha', value: running }];

  return <section id="contactos-de-hoy" aria-labelledby="contactos-de-hoy-titulo" data-tour="lead-drop" className="scroll-mt-6 overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-sm">
    <div className="space-y-4 bg-primary/5 p-5 sm:p-6">
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{today ? 'Tus contactos de hoy' : `Tus contactos del ${dayLabel(board.date)}`}</p>
        <h2 id="contactos-de-hoy-titulo" className="font-headline text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
        {/* On the tinted band the muted grey falls under 4.5:1: the same grey «Hoy» uses for secondary text on it (LeadDropBanner). */}
        <p className="max-w-2xl text-sm text-foreground/75">{lead}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2 sm:max-w-md">
        {steps.map(step => <div key={step.label} className="rounded-xl bg-background/70 px-3 py-2">
          <dt className="text-xs text-foreground/75">{step.label}</dt>
          <dd className={cn('text-lg font-semibold tabular-nums', !step.value && 'text-foreground/60')}>{step.value}</dd>
        </div>)}
      </dl>
    </div>
    {notice ? <p role={notice.ok ? 'status' : 'alert'} className={cn('border-t px-5 py-3 text-sm sm:px-6', notice.ok ? 'text-muted-foreground' : 'text-destructive')}>{notice.text}</p> : null}
    <ul className="divide-y border-t">
      {items.map(item => <li key={item.leadId} id={`contacto-${item.leadId}`} className="scroll-mt-6">
        <DropContactCard item={item} actions={actions} busy={saving || enriching !== null} enriching={enriching === item.leadId} defaultOpen={focus === item.leadId} collapsible />
      </li>)}
    </ul>
    <p className="border-t px-5 py-3 text-sm sm:px-6">
      <Link href={dropHref(board.id)} className="inline-flex items-center gap-1 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Ver cómo los buscamos y descargar el PDF<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    </p>
  </section>;
}
