'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropContactCard, type DropContactActions } from '@/components/lead-drops/DropContactCard';
import { useDropActions } from '@/components/lead-drops/useDropActions';
import { useAuth } from '@/context/AuthContext';
import { dayInZone } from '@/lib/admin/chile-time';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { dropHref, type DropItem } from '@/lib/lead-drops';
import {
  RECOMMENDED_ROWS, recommendedMoreLabel, recommendedNoticeKey, recommendedNoticeOf, recommendedNoticeTitle, recommendedResultsOf, recommendedResultsTitle,
  type RecommendedNotice,
} from '@/lib/search/recommended-notice';
import { cn } from '@/lib/utils';

type Results = { id: string; today: boolean; items: DropItem[]; waiting: string[] };
type Found = { results: Results } | { one: RecommendedNotice } | null;
const linkClass = 'inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The person's recommended contacts in «Buscar prospectos», as results that are already there (src/lib/search/recommended-notice.ts):
 * above the search, the contacts chosen for them that still wait, each a row with who it is, one line of why and «Enriquecer», as
 * in «Hoy» (TodayContacts). Three rows, and the rest on demand, so the search stays in sight. «Ocultar» folds the section into a
 * line for those contacts; the next ones are shown again. A drop of one contact is said in a line that opens it.
 * Shows nothing while it reads, when nothing is left, or when the request fails: the search is the page.
 */
export function SearchRecommended() {
  const { organizationId } = useAuth();
  const [found, setFound] = useState<Found>(null);
  useEffect(() => {
    if (!organizationId) return;
    let shown = true;
    authenticatedApiFetch('/api/lead-drops/latest', { cache: 'no-store', headers: { 'x-organization-id': organizationId } })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (!shown) return;
        const today = dayInZone(new Date());
        const results = recommendedResultsOf(body, today);
        if (results) { setFound({ results: results as unknown as Results }); return; }
        const one = recommendedNoticeOf(body, today);
        setFound(one ? { one } : null);
      })
      .catch(() => null);
    return () => { shown = false; };
  }, [organizationId]);
  if (!found) return null;
  if ('one' in found) return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
    <span className="flex items-center gap-1.5 font-medium"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />{recommendedNoticeTitle(found.one)}.</span>
    <Link href={dropHref(found.one.id)} className={cn(linkClass, 'font-medium text-primary')}>Ver mi contacto<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
  </p>;
  return <Rows key={found.results.id} results={found.results} />;
}

function Rows({ results }: { results: Results }) {
  const { organizationId } = useAuth();
  const [items, setItems] = useState(results.items);
  const call = useCallback((path: string, init?: RequestInit) => authenticatedApiFetch(path, {
    cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-organization-id': organizationId } : {}) },
  }), [organizationId]);
  const { saving, enriching, notice, actions, researching } = useDropActions({ dropId: results.id, call, setItems, single: false, items });
  const [all, setAll] = useState(false);
  const [folded, setFolded] = useState(() => {
    try { return window.localStorage.getItem(recommendedNoticeKey(results.id)) === '1'; } catch { return false; }
  });
  // What happened is said in the row it happened to.
  const [acted, setActed] = useState<string | null>(null);
  // The first time the person does something with these contacts, they count as opened, as when their own page is read
  // (GET /api/lead-drops/<id>): seeing the section on the way to a search does not.
  const opened = useRef(false);
  const touch = () => {
    if (opened.current) return;
    opened.current = true;
    void call(`/api/lead-drops/${encodeURIComponent(results.id)}`).catch(() => null);
  };
  const on = (leadId: string) => { setActed(leadId); touch(); };
  const inRow: DropContactActions = {
    enrich: (item, withPhone) => { on(item.leadId); actions.enrich(item, withPhone); },
    phone: item => { on(item.leadId); return actions.phone(item); },
    script: (item, fresh) => { on(item.leadId); return actions.script(item, fresh); },
    refresh: actions.refresh,
    save: item => { on(item.leadId); actions.save(item); },
    approve: item => { on(item.leadId); return actions.approve(item); },
    edit: (item, emails) => { on(item.leadId); return actions.edit(item, emails); },
    feedback: (item, useful, reason, wish) => { on(item.leadId); return actions.feedback(item, useful, reason, wish); },
  };
  const fold = (value: boolean) => {
    try { if (value) window.localStorage.setItem(recommendedNoticeKey(results.id), '1'); else window.localStorage.removeItem(recommendedNoticeKey(results.id)); } catch { /* for this visit only */ }
    setFolded(value);
  };

  // The rows are the contacts that waited when the page opened: one just enriched stays in its row, with its next step.
  const rows = items.filter(item => results.waiting.includes(item.leadId));
  const left = rows.filter(item => !item.savedLeadId || (item.draft && !item.campaign)).length;
  const title = recommendedResultsTitle({ total: items.length, left, today: results.today });
  const shown = all ? rows : rows.slice(0, RECOMMENDED_ROWS);

  if (folded) return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border/60 bg-card px-4 py-2.5 text-sm">
    <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />{title}.</span>
    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-primary" onClick={() => fold(false)}>Mostrar</Button>
  </p>;

  return <section aria-labelledby="buscar-recomendados-titulo" className="overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-sm">
    <div className="flex flex-col gap-3 bg-primary/5 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Ya buscamos por ti</p>
        <h2 id="buscar-recomendados-titulo" className="font-headline text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
        {/* On the tinted band the muted grey falls under 4.5:1: the grey «Hoy» uses for secondary text on it. */}
        <p className="max-w-2xl text-sm text-foreground/75">Los elegimos con tu cliente ideal y cada uno trae su campaña escrita. Enriquece aquí los que te sirvan.</p>
        {researching ? <p role="status" className="flex items-center gap-2 pt-1 text-sm text-foreground/75">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Investigando las empresas de tus contactos…</p> : null}
      </div>
      <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start text-foreground/75 sm:ml-0" onClick={() => fold(true)}>Ocultar</Button>
    </div>
    <ul id="buscar-recomendados-filas" className="divide-y border-t">
      {/* On a phone a row is as tall as three on a desk: one there, and the rest on demand, so the search is not a long way down. */}
      {shown.map((item, index) => <li key={item.leadId} className={cn(!all && index > 0 && 'hidden sm:block')}>
        {notice && acted === item.leadId ? <p role={notice.ok ? 'status' : 'alert'} className={cn('mx-4 mt-4 rounded-xl px-3 py-2 text-sm sm:mx-5', notice.ok ? 'bg-primary/10' : 'bg-destructive/10')}>{notice.text}</p> : null}
        <DropContactCard item={item} actions={inRow} busy={saving || enriching !== null} enriching={enriching === item.leadId} collapsible dense onExpand={touch} />
      </li>)}
    </ul>
    <div className="flex flex-wrap items-center justify-between gap-x-4 border-t px-4 py-1.5 text-sm sm:px-5">
      {rows.length > 1 ? <Button type="button" variant="ghost" size="sm" className={cn('-ml-2 h-9', rows.length <= RECOMMENDED_ROWS && 'sm:hidden')} aria-expanded={all} aria-controls="buscar-recomendados-filas"
        onClick={() => { setAll(value => !value); touch(); }}>
        <ChevronDown className={cn('mr-1 h-4 w-4 transition-transform motion-reduce:transition-none', all && 'rotate-180')} aria-hidden="true" />{recommendedMoreLabel(rows.length, all)}</Button> : <span />}
      <Link href={dropHref(results.id)} className={cn(linkClass, 'min-h-9 text-muted-foreground hover:text-foreground')}>Abrir en «Tus contactos de hoy»<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    </div>
  </section>;
}
