'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, Copy, Download, Loader2, MailCheck, Phone, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { dropHref, type DropCriteria, type DropItem } from '@/lib/lead-drops';
import { cn } from '@/lib/utils';

type Drop = { id: string; date: string; criteria: DropCriteria; items: DropItem[] };
/** Why there are no contacts this time (src/lib/server/lead-drops.ts, emptyReason), with the button to «Perfil» when it helps. */
type Empty = { title: string; text: string; profile: string | null };

/** The steps a search goes through, shown in order while the drop opens: the person sees how the contact was found. */
const STEPS = ['Buscando personas con tus filtros', 'Revisando que tengan correo verificado', 'Quitando a quienes tu equipo ya tiene', 'Escribiendo un primer correo'];
const STEP_MS = 550;
/** While today's drop is made (`nuevo`, a minute or two), the steps advance at the pace of the real work, short of the last. */
const MAKING_STEP_MS = 9000;
const MAKING_WAIT_MS = 6000;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** The search is played back once per contact on this device: coming back to write to them should not wait for it again. */
const PLAYED = 'anton:drop-played:';
const wasPlayed = (id: string) => { try { return window.localStorage.getItem(PLAYED + id) === '1'; } catch { return false; } };
const markPlayed = (id: string) => { try { window.localStorage.setItem(PLAYED + id, '1'); } catch { /* private mode: it plays again, nothing more */ } };
/** «Gerente de Personas +2 · Retail +1 · Chile»: the filters in one line, for the collapsed «Así lo buscamos». */
const brief = (criteria: DropCriteria) => [criteria.titles, criteria.industries, criteria.locations]
  .map(values => (values?.length ? (values.length > 1 ? `${values[0]} +${values.length - 1}` : values[0]) : null)).filter(Boolean).join(' · ');
const dayLabel = (day: string) => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const SOURCE: Record<DropCriteria['source'], string> = { perfil: 'Tu cliente ideal, de «Perfil»', equipo: 'El cliente ideal de tu equipo', contactos: 'Parecidos a los contactos que guarda tu equipo' };

function Filter({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 flex flex-wrap gap-1.5">{values.map(value => <span key={value} className="rounded-full bg-muted px-2.5 py-1 text-sm">{value}</span>)}</dd>
  </div>;
}

function Steps({ step }: { step: number }) {
  return <ol aria-live="polite" className="mt-5 space-y-2">
    {STEPS.map((label, index) => {
      const done = step > index, current = step === index;
      return <li key={label} className={cn('flex items-center gap-2.5 text-sm transition-opacity motion-reduce:transition-none', !done && !current && 'opacity-40')}>
        <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', done ? 'bg-primary text-primary-foreground' : 'border')}>
          {done ? <Check className="h-3 w-3" aria-hidden="true" /> : current ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        </span>
        <span>{label}{done ? <span className="sr-only"> (listo)</span> : null}</span>
      </li>;
    })}
  </ol>;
}

/**
 * «Contacto del día» in «Buscar prospectos» (src/lib/lead-drops.ts), opened from the morning email or from «Hoy»: the
 * search that found it, played back in a moment (or at once with reduced motion, or with «Ver ahora»), then the contact
 * with why it fits, a brief research and a first email. Saving it puts it in «Por escribir» with its email, without
 * credits; then «Investigar y escribirle» starts its full research there, the way to an email that is reviewed and sent
 * from ANTON.IA (the suggested one stays here, with «Copiar»). With `nuevo` (from «Hoy», for whoever gets no email) today's
 * drop is made first, for real. A drop with more than one contact (DROP_SIZE) shows them as a list.
 */
export function LeadDropFlow({ dropId }: { dropId: string }) {
  const { organizationId } = useAuth();
  const [id, setId] = useState<string | null>(dropId === 'nuevo' ? null : dropId);
  const [making, setMaking] = useState(dropId === 'nuevo');
  const [empty, setEmpty] = useState<Empty | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const started = useRef(false);
  const listId = useId();
  const howId = useId();

  const call = useCallback((path: string, init?: RequestInit) => authenticatedApiFetch(path, {
    cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-organization-id': organizationId } : {}) },
  }), [organizationId]);
  const load = useCallback(async () => {
    if (!organizationId || !id) return;
    setError('');
    try {
      const response = await call(`/api/lead-drops/${encodeURIComponent(id)}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos abrir tu contacto.');
      setDrop(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos abrir tu contacto.'); }
  }, [call, id, organizationId]);
  useEffect(() => { void load(); }, [load]);
  // Today's drop, made now: another request may be writing it («pending»), so ask again until it is ready or says why not.
  const make = useCallback(async () => {
    setError(''); setEmpty(null); setMaking(true); setStep(0);
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await call('/api/lead-drops/now', { method: 'POST' });
        const body = await response.json().catch(() => null);
        // Not a drop day or none left this month: said as such, without a retry that would answer the same.
        if (response.status === 409) { setEmpty({ title: 'Hoy no te toca un contacto nuevo', text: body?.error || 'Tu próximo contacto llega pronto.', profile: null }); return; }
        if (!response.ok) throw new Error(body?.error || 'No pudimos preparar tu contacto.');
        if (body?.status === 'pending') { await new Promise(resolve => setTimeout(resolve, MAKING_WAIT_MS)); continue; }
        if (body?.status === 'empty') { setEmpty(body.reason || { title: 'Esta vez no hubo un contacto nuevo', text: 'Inténtalo de nuevo más tarde.', profile: null }); return; }
        if (!body?.id || !['ready', 'sent'].includes(body.status)) throw new Error('No pudimos preparar tu contacto.');
        window.history.replaceState(null, '', dropHref(body.id));
        setId(body.id);
        return;
      }
      throw new Error('Tu contacto tarda más de lo normal. Vuelve en unos minutos: te esperará en «Hoy».');
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos preparar tu contacto.'); }
    finally { setMaking(false); }
  }, [call]);
  useEffect(() => {
    if (dropId !== 'nuevo' || !organizationId || started.current) return;
    started.current = true;
    void make();
  }, [dropId, organizationId, make]);
  // The playback: one step at a time once the contacts arrived; with reduced motion, straight to them. While the drop is
  // being made, at the pace of the work (a status, not an animation), short of the last step.
  useEffect(() => {
    if (making) {
      if (step >= STEPS.length - 1) return;
      const timer = setTimeout(() => setStep(value => Math.min(value + 1, STEPS.length - 1)), MAKING_STEP_MS);
      return () => clearTimeout(timer);
    }
    if (!drop) return;
    if (step >= STEPS.length) { markPlayed(drop.id); return; }
    if (reducedMotion() || wasPlayed(drop.id)) { setStep(STEPS.length); return; }
    const timer = setTimeout(() => setStep(value => value + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [making, drop, step]);

  const left = drop?.items.filter(item => !item.savedLeadId) ?? [];
  const one = drop?.items.length === 1 ? drop.items[0] : null;
  const save = async (leadIds?: string[]) => {
    if (!id) return;
    setSaving(true); setNotice(null);
    try {
      const response = await call(`/api/lead-drops/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action: 'save', ...(leadIds ? { leadIds } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos guardarlo.');
      setDrop(current => current && { ...current, items: body.items });
      setNotice(body.expired ? { ok: false, text: one ? 'Este contacto venció: pasaron más de 30 días desde que lo encontramos.'
        : `${body.expired === 1 ? 'Un contacto venció' : `${body.expired} contactos vencieron`}: pasaron más de 30 días. Los demás quedaron en «Por escribir».` }
        : { ok: true, text: one ? 'Quedó en «Por escribir», con su correo. Para enviarle desde ANTON.IA, lo investigamos a fondo (toma unos minutos) y luego revisas el correo.'
          : body.saved === 1 ? 'Quedó en «Por escribir», con su correo.' : `Quedaron ${body.saved} en «Por escribir», con su correo.` });
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'No pudimos guardarlo.' }); }
    finally { setSaving(false); }
  };
  const copy = async (item: DropItem) => {
    if (!item.draft) return;
    const textValue = `Asunto: ${item.draft.subject}\n\n${item.draft.body}`;
    try { await navigator.clipboard.writeText(textValue); setCopied(item.leadId); setTimeout(() => setCopied(null), 1800); }
    catch { setNotice({ ok: false, text: 'No pudimos copiar. Selecciona el texto y cópialo.' }); }
  };
  const downloadPdf = async () => {
    if (!id) return;
    try {
      const response = await call(`/api/lead-drops/${encodeURIComponent(id)}/pdf`);
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = `contacto-del-dia-${drop?.date || ''}.pdf`; link.click();
      URL.revokeObjectURL(url);
    } catch { setNotice({ ok: false, text: 'No pudimos descargar el PDF. Inténtalo de nuevo.' }); }
  };
  // What ANTON.IA sends goes out from a full research, reviewed: «Por escribir» opens it and starts it (empezar=1).
  const writeHref = (item: DropItem) => `/saved/leads/enriched?investigar=${encodeURIComponent(item.savedLeadId || '')}&empezar=1`;
  const badges = (item: DropItem) => <div className="flex flex-wrap gap-1.5 pt-1">
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"><MailCheck className="h-3 w-3" aria-hidden="true" />Correo verificado</span>
    {item.hasPhone ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><Phone className="h-3 w-3" aria-hidden="true" />Teléfono</span> : null}
    {item.savedLeadId ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><Check className="h-3 w-3" aria-hidden="true" />En «Por escribir»</span> : null}
  </div>;
  // The brief research and the first email, with «Copiar».
  const details = (item: DropItem, panel?: string) => <div id={panel} className="space-y-4 rounded-xl bg-muted/40 p-4">
    {item.research.length ? <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Breve investigación</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{item.research.map(fact => <li key={fact}>{fact}</li>)}</ul></div> : null}
    {item.draft ? <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primer correo sugerido</p>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => void copy(item)}>
          {copied === item.leadId ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          {copied === item.leadId ? 'Copiado' : 'Copiar'}</Button>
      </div>
      <p className="mt-1.5 text-sm"><span className="text-muted-foreground">Asunto: </span><span className="font-medium">{item.draft.subject}</span></p>
      <p className="mt-2 whitespace-pre-line text-sm leading-6">{item.draft.body}</p>
    </div> : null}
  </div>;

  const playing = Boolean(drop) && step < STEPS.length;
  const searched = one || making ? 'Así lo buscamos' : 'Así los buscamos';
  // While the search plays, «Así lo buscamos» is the story: the filters and the steps. Once it ends it is one collapsed row below
  // the contact, since the contact is what the person came for.
  const howSection = drop ? <section aria-labelledby="drop-filters" className="rounded-2xl border">
    {playing ? <div className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="drop-filters" className="flex items-center gap-2 text-sm font-medium"><Search className="h-4 w-4 text-primary" aria-hidden="true" />{searched}</h2>
        <span className="text-xs text-muted-foreground">{SOURCE[drop.criteria.source] || 'Tu cliente ideal'}</span>
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <Filter label="Cargo" values={drop.criteria.titles || []} />
        <Filter label="Rubro" values={drop.criteria.industries || []} />
        <Filter label="Lugar" values={drop.criteria.locations || []} />
      </dl>
      <Steps step={step} />
      <Button variant="link" size="sm" className="mt-2 h-auto p-0" onClick={() => setStep(STEPS.length)}>Ver ahora</Button>
    </div> : <>
      <h2 id="drop-filters" className="text-sm font-medium">
        <button type="button" aria-expanded={howOpen} aria-controls={howId} onClick={() => setHowOpen(value => !value)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
          <span className="min-w-0">
            <span className="flex items-center gap-2"><Search className="h-4 w-4 text-primary" aria-hidden="true" />{searched}</span>
            <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{brief(drop.criteria) || SOURCE[drop.criteria.source]}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', howOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {howOpen ? <div id={howId} className="space-y-3 border-t p-4 sm:px-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Filter label="Cargo" values={drop.criteria.titles || []} />
          <Filter label="Rubro" values={drop.criteria.industries || []} />
          <Filter label="Lugar" values={drop.criteria.locations || []} />
        </dl>
        <p className="text-xs text-muted-foreground">{SOURCE[drop.criteria.source] || 'Tu cliente ideal'}. Revisamos que tengan correo verificado, quitamos a quienes tu equipo ya tiene y escribimos un primer correo.</p>
      </div> : null}
    </>}
  </section> : null;
  return <div className="mx-auto w-full max-w-3xl">
    <PageHeader title={drop && !one ? 'Tus contactos del día' : 'Tu contacto del día'} back={{ href: '/search', label: 'Búsqueda normal' }}
      description={drop ? (one ? `Encontrado el ${dayLabel(drop.date)} para ti. Ya tiene su correo verificado: guardarlo no gasta créditos.`
        : `Encontrados el ${dayLabel(drop.date)} para ti. Ya tienen su correo verificado: guardarlos no gasta créditos.`)
        : making ? 'Elegimos un contacto nuevo para ti, con una breve investigación y un primer correo.' : 'Tu contacto nuevo, con su correo verificado.'} />

    {error ? <Card className="rounded-2xl"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
      <p role="alert" className="text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={() => void (id ? load() : make())}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reintentar</Button>
    </CardContent></Card> : null}
    {!drop && !error && !making && !empty ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Abriendo tu contacto…</p> : null}

    {making ? <section aria-labelledby="drop-making" className="rounded-2xl border p-4 sm:p-5">
      <h2 id="drop-making" className="flex items-center gap-2 text-sm font-medium"><Search className="h-4 w-4 text-primary" aria-hidden="true" />{searched}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Con tu cliente ideal, como lo haría una búsqueda tuya. Toma uno o dos minutos; si sales, te espera en «Hoy».</p>
      <Steps step={step} />
    </section> : null}

    {empty ? <Card className="rounded-2xl"><CardContent className="space-y-4 p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{empty.title}</h2>
        <p className="text-sm text-muted-foreground">{empty.text}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {empty.profile ? <Button asChild><Link href="/profile#icp-heading">{empty.profile}</Link></Button> : null}
        <Button asChild variant={empty.profile ? 'outline' : 'default'}><Link href="/search">Buscar con mis filtros</Link></Button>
      </div>
    </CardContent></Card> : null}

    {drop ? <div className="space-y-6">
      {playing ? howSection : null}

      {!playing && one ? <section aria-labelledby="drop-results" className="space-y-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 id="drop-results" className="text-xl font-semibold tracking-tight">{one.name}</h2>
            <p className="text-sm text-muted-foreground">{[one.title, one.company].filter(Boolean).join(' · ')}</p>
          </div>
          {one.savedLeadId ? <Button asChild size="lg"><Link href={writeHref(one)}>Investigar y escribirle<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link></Button>
            : <Button size="lg" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Guardar en «Por escribir»</Button>}
        </div>
        {notice ? <p role={notice.ok ? 'status' : 'alert'} className={cn('text-sm', notice.ok ? 'text-muted-foreground' : 'text-destructive')}>{notice.text}</p> : null}
        <div className="space-y-3 rounded-2xl border p-4 sm:p-5">
          <p className="text-sm">{one.why}</p>
          {badges(one)}
          {one.research.length || one.draft ? details(one) : null}
        </div>
        {howSection}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void downloadPdf()}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />Descargar PDF</Button>
          <Link href="/search" className="underline underline-offset-2 hover:text-foreground">¿Quieres más? Busca con tus propios filtros</Link>
        </div>
      </section> : null}

      {!playing && !one ? <section aria-labelledby="drop-results" className="space-y-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="drop-results" className="text-xl font-semibold tracking-tight">{`${drop.items.length} contactos nuevos`}</h2>
            <p className="text-sm text-muted-foreground">{left.length ? 'Cada uno trae por qué te sirve, una breve investigación y un primer correo.' : 'Ya están todos en «Por escribir».'}</p>
          </div>
          {left.length ? <Button size="lg" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {left.length === drop.items.length ? `Guardar los ${left.length} en «Por escribir»` : left.length === 1 ? 'Guardar el que falta' : `Guardar los ${left.length} que faltan`}</Button>
            : <Button asChild size="lg"><Link href="/saved/leads/enriched">Ir a «Por escribir»<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link></Button>}
        </div>
        {notice ? <p role={notice.ok ? 'status' : 'alert'} className={cn('text-sm', notice.ok ? 'text-muted-foreground' : 'text-destructive')}>{notice.text}</p> : null}

        <ul id={listId} className="divide-y rounded-2xl border">
          {drop.items.map(item => {
            const expanded = open === item.leadId;
            const panel = `${listId}-${item.leadId}`;
            return <li key={item.leadId} className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">{[item.title, item.company].filter(Boolean).join(' · ')}</p>
                  <p className="text-sm">{item.why}</p>
                  {badges(item)}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.savedLeadId ? <Button asChild size="sm" variant="outline"><Link href={writeHref(item)}>Investigar y escribirle</Link></Button>
                    : <Button size="sm" variant="outline" disabled={saving} onClick={() => void save([item.leadId])}>Guardar</Button>}
                </div>
              </div>
              {item.research.length || item.draft ? <Button variant="ghost" size="sm" className="-ml-2 mt-2 text-muted-foreground" aria-expanded={expanded} aria-controls={panel}
                onClick={() => setOpen(expanded ? null : item.leadId)}>
                <ChevronDown className={cn('mr-1 h-4 w-4 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
                Investigación y primer correo</Button> : null}
              {expanded ? <div className="mt-2">{details(item, panel)}</div> : null}
            </li>;
          })}
        </ul>

        {howSection}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void downloadPdf()}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />Descargar PDF</Button>
          <Link href="/search" className="underline underline-offset-2 hover:text-foreground">¿Quieres más? Busca con tus propios filtros</Link>
        </div>
      </section> : null}
    </div> : null}
  </div>;
}
