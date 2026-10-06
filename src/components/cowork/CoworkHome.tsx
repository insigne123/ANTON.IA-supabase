'use client';

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, X } from 'lucide-react';
import { coworkOfferMessage, coworkOverviewFigures, type CoworkOverview } from '@/lib/cowork/overview';
import { coworkSinceWhen, type CoworkSince, type CoworkSinceKind } from '@/lib/cowork/since-visit';
import { coworkShortTime, coworkStatusCopy, type CoworkIconKey, type CoworkThreadSummary } from '@/lib/cowork/presentation';
import { COWORK_STARTERS } from '@/lib/cowork/starters';
import { cn } from '@/lib/utils';
import { CwCollapse, CwCount } from './motion';
import { CoworkGuide } from './CoworkGuide';
import { CoworkIcon, CoworkMark, CwButton, CwStatusPill } from './ui';

function greeting(hour: number) {
  if (hour < 5 || hour >= 20) return 'Buenas noches';
  if (hour < 13) return 'Buenos días';
  return 'Buenas tardes';
}

/** What is written in «Cuéntame qué vendes», kept by the workspace while a send is on its way. */
export type CoworkOfferDraft = { offer: string; website: string };

/** Hidden «Cuéntame qué vendes» for this viewer, until an offer exists or they clear their browser. */
const OFFER_CARD_KEY = 'cowork:offer-card-hidden';
const FIELD = 'w-full rounded-[10px] border border-cw-border bg-cw-elevated px-3 text-[14px] text-cw-text placeholder:text-cw-faint focus-visible:border-cw-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-60';

/** Your account in one quiet line: the figures count up once when they arrive (plan 2, V7). */
function HomeFigures({ overview, loading }: { overview: CoworkOverview | null; loading: boolean }) {
  const figures = coworkOverviewFigures(overview);
  if (loading && !overview) return <div aria-hidden="true" className="mx-auto mt-4 h-5 w-72 max-w-full animate-pulse rounded-full bg-cw-hover motion-reduce:animate-none" />;
  if (!overview || !figures.length) return null;
  if (overview.contacts === 0 && !overview.campaigns) {
    return <p className="cw-rise mt-4 text-center text-[13px] text-cw-muted">Aún no tienes contactos guardados: empieza buscando prospectos nuevos.</p>;
  }
  return <ul aria-label="Tu cuenta" className="cw-rise mt-4 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-[13px] text-cw-muted">
    {figures.map(figure => <li key={figure.id}>
      <span className="font-semibold text-cw-text"><CwCount value={figure.value} />{figure.total !== undefined && ` de ${figure.total}`}</span> {figure.label}
    </li>)}
  </ul>;
}

const SINCE_ICON: Record<CoworkSinceKind, CoworkIconKey> = { replies: 'reply', research: 'research', opportunities: 'target', linkedin: 'linkedin' };
const SINCE_ACTION: Record<CoworkSinceKind, string> = {
  replies: 'Preparar respuestas', research: 'Ver hallazgos', opportunities: 'Revisar', linkedin: 'Escribirles',
};

/** «Desde tu última visita» (Plan 12, 5): what arrived after your last turn; each row asks Cowork to work on it. */
function SinceLastVisit({ since, onAsk }: { since: CoworkSince; onAsk: (prompt: string) => void }) {
  const id = useId();
  return <section aria-labelledby={id} className="cw-rise mt-6 [animation-delay:90ms]">
    <h2 id={id} className="mb-2 px-1 text-[12.5px] font-medium text-cw-muted">Desde tu última visita · {coworkSinceWhen(since.at)}</h2>
    <ul className="divide-y divide-cw-border overflow-hidden rounded-2xl border border-cw-border bg-cw-elevated shadow-[var(--cw-shadow-sm)]">
      {since.items.map(item => <li key={item.kind}>
        <button type="button" onClick={() => onAsk(item.prompt)}
          className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--cw-accent-ring)]">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cw-accent-soft text-cw-accent">
            <CoworkIcon name={SINCE_ICON[item.kind]} className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 text-[14px] leading-5 text-cw-text">{item.text}</span>
          <span className="hidden shrink-0 text-[12.5px] font-medium text-cw-accent sm:inline">{SINCE_ACTION[item.kind]}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-cw-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </li>)}
    </ul>
  </section>;
}

/**
 * «Cuéntame qué vendes»: without an offer Cowork writes generic emails. What you write here goes to
 * Cowork as a message; it proposes saving it in your profile (profile.update), and nothing is
 * saved until you approve that card. With only your website, Cowork reads it and proposes who to
 * aim at before it asks to save anything.
 */
function OfferCard({ draft, onDraftChange, onSave, onHide }: {
  draft: CoworkOfferDraft; onDraftChange: (draft: CoworkOfferDraft) => void; onSave: (message: string) => Promise<boolean>; onHide: () => void;
}) {
  const id = useId();
  const { offer, website } = draft;
  const [sending, setSending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((!offer.trim() && !website.trim()) || sending) return;
    setSending(true);
    // Sending opens the conversation and this card leaves; the draft lives in the workspace, so a
    // failed send brings the card back with what was written.
    const sent = await onSave(coworkOfferMessage(offer, website));
    if (!sent) setSending(false);
  };
  return <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-cw-border bg-cw-elevated p-4 shadow-[var(--cw-shadow-sm)] sm:p-5">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cw-accent-soft text-cw-accent">
        <CoworkIcon name="sparkles" className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={`${id}-title`} className="text-[14.5px] font-semibold text-cw-text">Cuéntame qué vendes</h2>
        <p className="mt-0.5 text-[13px] leading-5 text-cw-muted">Pega tu web y la leo, o cuéntamelo con tus palabras. Con eso escribo tus correos y elijo a quién escribirle; lo guardo en tu perfil cuando lo apruebes.</p>
      </div>
      <CwButton size="icon-sm" variant="ghost" onClick={onHide} aria-label="Ocultar por ahora" title="Ocultar por ahora"><X aria-hidden="true" /></CwButton>
    </div>
    <form onSubmit={event => void submit(event)} className="mt-3 space-y-3 sm:pl-11">
      <div>
        <label htmlFor={`${id}-web`} className="mb-1 block text-[12px] font-medium text-cw-muted">Tu sitio web</label>
        <input id={`${id}-web`} type="text" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} value={website} onChange={event => onDraftChange({ ...draft, website: event.target.value })}
          maxLength={200} disabled={sending} placeholder="tuempresa.cl" className={cn(FIELD, 'h-10')} />
      </div>
      <div>
        <label htmlFor={`${id}-offer`} className="mb-1 block text-[12px] font-medium text-cw-muted">O cuéntame qué vendes y a quién</label>
        <textarea id={`${id}-offer`} value={offer} onChange={event => onDraftChange({ ...draft, offer: event.target.value })} maxLength={600} rows={3} disabled={sending}
          placeholder="Ej.: revisión de antecedentes laborales en minutos, para equipos de RR. HH. en Chile"
          className={cn(FIELD, 'resize-y py-2 leading-6')} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <CwButton type="submit" size="sm" variant="secondary" disabled={(!offer.trim() && !website.trim()) || sending}>{sending ? 'Enviando…' : offer.trim() ? 'Guardar en mi perfil' : 'Leer mi web'}</CwButton>
      </div>
    </form>
  </section>;
}

/** Start screen: one clear action (the composer), your account at a glance, a few concrete starting points. */
export function CoworkHome({ composer, threads, ready, loading, listFailed = false, onSuggestion, onOpenThread, overview = null, overviewLoading = false,
  onSaveOffer = null, offerDraft = { offer: '', website: '' }, onOfferDraftChange = () => {} }: {
  composer: ReactNode;
  threads: CoworkThreadSummary[];
  ready: boolean;
  loading: boolean;
  /** The list could not be read: the workspace's notice explains it, so «not available yet» would mislead. */
  listFailed?: boolean;
  onSuggestion: (prompt: string) => void;
  onOpenThread: (id: string) => void;
  /** Real figures of your account and whether Cowork knows what you sell (GET /api/cowork/overview). */
  overview?: CoworkOverview | null;
  overviewLoading?: boolean;
  /** Sends the «Cuéntame qué vendes» message; resolves false when it could not be sent. */
  onSaveOffer?: ((message: string) => Promise<boolean>) | null;
  offerDraft?: CoworkOfferDraft;
  onOfferDraftChange?: (draft: CoworkOfferDraft) => void;
}) {
  const [hello, setHello] = useState('Hola');
  useEffect(() => { setHello(greeting(new Date().getHours())); }, []);
  const [offerHidden, setOfferHidden] = useState(true);
  // «¿Qué puedes hacer?»: the whole guide, opened on demand so the home stays short.
  const [guideOpen, setGuideOpen] = useState(false);
  const guideId = useId();
  useEffect(() => {
    try { setOfferHidden(window.localStorage.getItem(OFFER_CARD_KEY) === '1'); } catch { setOfferHidden(false); }
  }, []);
  const hideOffer = () => {
    setOfferHidden(true);
    try { window.localStorage.setItem(OFFER_CARD_KEY, '1'); } catch { /* Storage unavailable: hidden for this visit only. */ }
  };
  const pending = threads.filter(thread => ['waiting_approval', 'running', 'queued', 'waiting_workers'].includes(thread.status)).slice(0, 3);
  const recent = threads.filter(thread => !pending.includes(thread)).slice(0, 4);
  const name = overview?.firstName;
  const askOffer = Boolean(onSaveOffer) && overview?.hasOffer === false && !offerHidden;

  return <div className="cw-scroll flex h-full min-h-0 flex-col overflow-y-auto">
    <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col justify-center px-4 py-10 sm:px-6 md:py-16">
      <div className="cw-rise mb-7 flex flex-col items-center text-center">
        <CoworkMark size={44} className="mb-4" />
        <h1 className="font-cw-heading text-2xl font-semibold leading-tight tracking-[-0.025em] text-cw-text sm:text-[2rem]">{hello}{name ? `, ${name}` : ''}. ¿En qué avanzamos hoy?</h1>
        <p className="mt-2 max-w-[34rem] text-[14.5px] leading-6 text-cw-muted">Escribo correos y mensajes de LinkedIn para tus contactos, busco prospectos nuevos y te cuento cómo vas. Antes de enviar o cambiar algo te pido aprobación.</p>
      </div>
      <div className="cw-rise [animation-delay:60ms]">{composer}</div>
      {!ready && !loading && !listFailed && <p className="mt-3 text-center text-[13px] text-cw-muted">El procesamiento todavía no está disponible. Puedes consultar los trabajos guardados.</p>}
      <HomeFigures overview={overview} loading={overviewLoading} />
      {overview?.since?.items.length ? <SinceLastVisit since={overview.since} onAsk={onSuggestion} /> : null}
      <CwCollapse show={askOffer}>
        {onSaveOffer && <div className="pt-6"><OfferCard draft={offerDraft} onDraftChange={onOfferDraftChange} onSave={onSaveOffer} onHide={hideOffer} /></div>}
      </CwCollapse>
      {/* The starting points come in one after another, a beat apart; with less motion they are simply there. */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {COWORK_STARTERS.map((item, index) => <button key={item.id} type="button" onClick={() => onSuggestion(item.prompt)}
          style={{ animationDelay: `${120 + index * 45}ms` }}
          className="cw-rise inline-flex items-center gap-2 rounded-full border border-cw-border bg-cw-elevated px-3.5 py-2 text-[13.5px] text-cw-text shadow-[var(--cw-shadow-sm)] transition-colors hover:border-cw-border-strong hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
          <CoworkIcon name={item.icon} className="h-4 w-4 text-cw-accent" />{item.title}
        </button>)}
      </div>
      <div className="mt-3 flex justify-center">
        <button type="button" aria-expanded={guideOpen} aria-controls={guideId} onClick={() => setGuideOpen(open => !open)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-cw-accent transition-colors hover:bg-cw-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
          ¿Qué puedes hacer?
          <ChevronDown className={cn('h-4 w-4 transition-transform', guideOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      <div id={guideId}>
        <CwCollapse show={guideOpen}>
          <div className="pt-4"><CoworkGuide onTry={message => { onSuggestion(message); setGuideOpen(false); }} /></div>
        </CwCollapse>
      </div>
      {(pending.length > 0 || recent.length > 0) && <div className="cw-rise mt-10 [animation-delay:180ms]">
        <h2 className="mb-2 px-1 text-[12.5px] font-medium text-cw-muted">{pending.length ? 'Continúa donde quedaste' : 'Recientes'}</h2>
        <ul className="divide-y divide-cw-border overflow-hidden rounded-2xl border border-cw-border bg-cw-elevated">
          {[...pending, ...recent].slice(0, 5).map(thread => {
            const status = coworkStatusCopy(thread.status);
            return <li key={thread.rootId}>
              <button type="button" onClick={() => onOpenThread(thread.id)}
                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--cw-accent-ring)]">
                <span className="min-w-0 flex-1 truncate text-[14px] text-cw-text">{thread.title}</span>
                <CwStatusPill tone={status.tone}>{status.label}</CwStatusPill>
                <span className="hidden w-12 shrink-0 text-right text-[12px] text-foreground/70 sm:inline">{coworkShortTime(thread.updatedAt)}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-cw-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            </li>;
          })}
        </ul>
      </div>}
    </div>
  </div>;
}
