'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, Copy, Download, Loader2, MailCheck, Phone, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import type { DropCriteria, DropItem } from '@/lib/lead-drops';
import { cn } from '@/lib/utils';

type Drop = { id: string; date: string; criteria: DropCriteria; items: DropItem[] };

/** The steps a search goes through, shown in order while the drop opens: the person sees how these contacts were found. */
const STEPS = ['Buscando personas con tus filtros', 'Revisando que tengan correo verificado', 'Quitando a quienes tu equipo ya tiene', 'Escribiendo un primer correo para cada uno'];
const STEP_MS = 550;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const dayLabel = (day: string) => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const SOURCE: Record<DropCriteria['source'], string> = { perfil: 'Tu cliente ideal, de «Perfil»', equipo: 'El cliente ideal de tu equipo', contactos: 'Parecidos a los contactos que guarda tu equipo' };

function Filter({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 flex flex-wrap gap-1.5">{values.map(value => <span key={value} className="rounded-full bg-muted px-2.5 py-1 text-sm">{value}</span>)}</dd>
  </div>;
}

/**
 * «Contactos de la semana» in «Buscar prospectos» (src/lib/lead-drops.ts), opened from the morning email: the search
 * that found them, played back in a moment (or at once with reduced motion, or with «Ver ahora»), then the contacts with
 * why they fit, a brief research and a first email. Saving them puts them in «Por escribir» with their email, without credits.
 */
export function LeadDropFlow({ dropId }: { dropId: string }) {
  const { organizationId } = useAuth();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const listId = useId();

  const call = useCallback((path: string, init?: RequestInit) => authenticatedApiFetch(path, {
    cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-organization-id': organizationId } : {}) },
  }), [organizationId]);
  const load = useCallback(async () => {
    if (!organizationId) return;
    setError('');
    try {
      const response = await call(`/api/lead-drops/${encodeURIComponent(dropId)}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos abrir tus contactos.');
      setDrop(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos abrir tus contactos.'); }
  }, [call, dropId, organizationId]);
  useEffect(() => { void load(); }, [load]);
  // The playback: one step at a time once the contacts arrived; with reduced motion, straight to them.
  useEffect(() => {
    if (!drop) return;
    if (reducedMotion()) { setStep(STEPS.length); return; }
    if (step >= STEPS.length) return;
    const timer = setTimeout(() => setStep(value => value + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [drop, step]);

  const left = drop?.items.filter(item => !item.savedLeadId) ?? [];
  const save = async (leadIds?: string[]) => {
    setSaving(true); setNotice(null);
    try {
      const response = await call(`/api/lead-drops/${encodeURIComponent(dropId)}`, { method: 'POST', body: JSON.stringify({ action: 'save', ...(leadIds ? { leadIds } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos guardarlos.');
      setDrop(current => current && { ...current, items: body.items });
      setNotice(body.expired ? { ok: false, text: `${body.expired === 1 ? 'Un contacto venció' : `${body.expired} contactos vencieron`}: pasaron más de 30 días. Los demás quedaron en «Por escribir».` }
        : { ok: true, text: body.saved === 1 ? 'Quedó en «Por escribir», con su correo.' : `Quedaron ${body.saved} en «Por escribir», con su correo.` });
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'No pudimos guardarlos.' }); }
    finally { setSaving(false); }
  };
  const copy = async (item: DropItem) => {
    if (!item.draft) return;
    const textValue = `Asunto: ${item.draft.subject}\n\n${item.draft.body}`;
    try { await navigator.clipboard.writeText(textValue); setCopied(item.leadId); setTimeout(() => setCopied(null), 1800); }
    catch { setNotice({ ok: false, text: 'No pudimos copiar. Selecciona el texto y cópialo.' }); }
  };
  const downloadPdf = async () => {
    try {
      const response = await call(`/api/lead-drops/${encodeURIComponent(dropId)}/pdf`);
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = `contactos-de-la-semana-${drop?.date || ''}.pdf`; link.click();
      URL.revokeObjectURL(url);
    } catch { setNotice({ ok: false, text: 'No pudimos descargar el PDF. Inténtalo de nuevo.' }); }
  };
  const composeHref = (item: DropItem) => `/contact/compose?id=${encodeURIComponent(item.savedLeadId || '')}${item.draft
    ? `&subject=${encodeURIComponent(item.draft.subject)}&body=${encodeURIComponent(item.draft.body)}` : ''}`;

  const playing = Boolean(drop) && step < STEPS.length;
  return <div className="mx-auto w-full max-w-3xl">
    <PageHeader title="Buscar prospectos" eyebrow="Contactos de la semana" back={{ href: '/search', label: 'Búsqueda normal' }}
      description={drop ? `Encontrados el ${dayLabel(drop.date)} para ti. Ya tienen su correo verificado: guardarlos no gasta créditos.` : 'Tus contactos nuevos de esta semana.'} />

    {error ? <Card className="rounded-2xl"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
      <p role="alert" className="text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reintentar</Button>
    </CardContent></Card> : null}
    {!drop && !error ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Abriendo tus contactos…</p> : null}

    {drop ? <div className="space-y-6">
      <section aria-labelledby="drop-filters" className="rounded-2xl border p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="drop-filters" className="flex items-center gap-2 text-sm font-medium"><Search className="h-4 w-4 text-primary" aria-hidden="true" />Así los buscamos</h2>
          <span className="text-xs text-muted-foreground">{SOURCE[drop.criteria.source] || 'Tu cliente ideal'}</span>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Filter label="Cargo" values={drop.criteria.titles || []} />
          <Filter label="Rubro" values={drop.criteria.industries || []} />
          <Filter label="Lugar" values={drop.criteria.locations || []} />
        </dl>
        <ol aria-live="polite" className="mt-5 space-y-2">
          {STEPS.map((label, index) => {
            const done = step > index, current = step === index;
            return <li key={label} className={cn('flex items-center gap-2.5 text-sm transition-opacity motion-reduce:transition-none', !done && !current && 'opacity-40')}>
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', done ? 'bg-primary text-primary-foreground' : 'border')}>
                {done ? <Check className="h-3 w-3" aria-hidden="true" /> : current ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              </span>
              <span>{label}{done ? <span className="sr-only"> (listo)</span> : null}</span>
            </li>;
          })}
        </ol>
        {playing ? <Button variant="link" size="sm" className="mt-2 h-auto p-0" onClick={() => setStep(STEPS.length)}>Ver ahora</Button> : null}
      </section>

      {!playing ? <section aria-labelledby="drop-results" className="space-y-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="drop-results" className="text-xl font-semibold tracking-tight">{drop.items.length === 1 ? 'Un contacto nuevo' : `${drop.items.length} contactos nuevos`}</h2>
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
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"><MailCheck className="h-3 w-3" aria-hidden="true" />Correo verificado</span>
                    {item.hasPhone ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><Phone className="h-3 w-3" aria-hidden="true" />Teléfono</span> : null}
                    {item.savedLeadId ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><Check className="h-3 w-3" aria-hidden="true" />En «Por escribir»</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.savedLeadId ? <Button asChild size="sm" variant="outline"><Link href={composeHref(item)}>Escribirle</Link></Button>
                    : <Button size="sm" variant="outline" disabled={saving} onClick={() => void save([item.leadId])}>Guardar</Button>}
                </div>
              </div>
              {item.research.length || item.draft ? <Button variant="ghost" size="sm" className="-ml-2 mt-2 text-muted-foreground" aria-expanded={expanded} aria-controls={panel}
                onClick={() => setOpen(expanded ? null : item.leadId)}>
                <ChevronDown className={cn('mr-1 h-4 w-4 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
                Investigación y primer correo</Button> : null}
              {expanded ? <div id={panel} className="mt-2 space-y-4 rounded-xl bg-muted/40 p-4">
                {item.research.length ? <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Breve investigación</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{item.research.map(fact => <li key={fact}>{fact}</li>)}</ul></div> : null}
                {item.draft ? <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primer correo sugerido</p>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => void copy(item)}>
                      {copied === item.leadId ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                      {copied === item.leadId ? 'Copiado' : 'Copiar'}</Button>
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{item.draft.subject}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6">{item.draft.body}</p>
                </div> : null}
              </div> : null}
            </li>;
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void downloadPdf()}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />Descargar PDF</Button>
          <Link href="/search" className="underline underline-offset-2 hover:text-foreground">¿Quieres más? Busca con tus propios filtros</Link>
        </div>
      </section> : null}
    </div> : null}
  </div>;
}
