'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { dayInZone } from '@/lib/admin/chile-time';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { dropHref } from '@/lib/lead-drops';
import { recommendedNoticeKey, recommendedNoticeOf, recommendedNoticeText, type RecommendedNotice as Notice } from '@/lib/search/recommended-notice';

/**
 * «Contactos recomendados» at the top of «Buscar prospectos» (src/lib/search/recommended-notice.ts): the contacts chosen for the
 * person that still wait for them, with one way in. Quiet on purpose: the page's own action is the search, so this is a line with
 * an outlined button, it can be closed, and a closed one stays closed until the next contacts arrive. Says nothing while it reads,
 * when there is nothing left, or when the request fails.
 */
export function RecommendedNotice() {
  const { organizationId } = useAuth();
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    let shown = true;
    authenticatedApiFetch('/api/lead-drops/latest', { cache: 'no-store', headers: { 'x-organization-id': organizationId } })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        const found = recommendedNoticeOf(body, dayInZone(new Date()));
        if (!shown || !found) return;
        let closed = false;
        try { closed = window.localStorage.getItem(recommendedNoticeKey(found.id)) === '1'; } catch { /* private mode: shown each visit */ }
        if (!closed) setNotice(found);
      })
      .catch(() => null);
    return () => { shown = false; };
  }, [organizationId]);
  if (!notice) return null;
  const close = () => {
    try { window.localStorage.setItem(recommendedNoticeKey(notice.id), '1'); } catch { /* closed for this visit only */ }
    setNotice(null);
  };
  return <section aria-labelledby="recomendados-aviso" className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:gap-4">
    <div className="min-w-0 flex-1 space-y-1">
      <h2 id="recomendados-aviso" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Contactos recomendados
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Nuevo</span>
      </h2>
      {/* On the tinted band the muted grey falls under 4.5:1: the grey «Hoy» uses for secondary text on it. */}
      <p className="text-sm text-foreground/75">{recommendedNoticeText(notice)}</p>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <Button asChild size="sm" variant="outline" className="flex-1 justify-between gap-2 sm:flex-none">
        <Link href={dropHref(notice.id)}>Ver mis recomendados<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-foreground/70" onClick={close} aria-label="Cerrar el aviso de contactos recomendados">
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  </section>;
}
