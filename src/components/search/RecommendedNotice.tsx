'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/context/AuthContext';
import { dayInZone } from '@/lib/admin/chile-time';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { dropHref } from '@/lib/lead-drops';
import { recommendedNoticeKey, recommendedNoticeOf, recommendedNoticeText, recommendedNoticeTitle, type RecommendedNotice as Notice } from '@/lib/search/recommended-notice';

/**
 * «Contactos recomendados» on arriving at «Buscar prospectos» (src/lib/search/recommended-notice.ts): a large notice in the middle
 * of the screen with the contacts chosen for the person that still wait for them, and two ways on: go to them, or close it and
 * search. Either answer is remembered for those contacts, so it is said once and again only when the next ones arrive. Says nothing
 * while it reads, when nothing is left, or when the request fails.
 */
export function RecommendedNotice() {
  const { organizationId } = useAuth();
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    let shown = true;
    authenticatedApiFetch('/api/lead-drops/latest', { cache: 'no-store', headers: { 'x-organization-id': organizationId } })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        const found = recommendedNoticeOf(body, dayInZone(new Date()));
        if (!shown || !found) return;
        let answered = false;
        try { answered = window.localStorage.getItem(recommendedNoticeKey(found.id)) === '1'; } catch { /* private mode: said each visit */ }
        if (!answered) setNotice(found);
      })
      .catch(() => null);
    return () => { shown = false; };
  }, [organizationId]);
  if (!notice) return null;
  const answer = () => {
    try { window.localStorage.setItem(recommendedNoticeKey(notice.id), '1'); } catch { /* answered for this visit only */ }
    setNotice(null);
  };
  const go = () => { const href = dropHref(notice.id); answer(); router.push(href); };
  // Escape and «Cerrar» are the same answer. The focus starts on «Cerrar» (the dialog's own rule): going is the person's choice.
  return <AlertDialog open onOpenChange={open => { if (!open) answer(); }}>
    <AlertDialogContent className="w-[calc(100%-2rem)] max-w-xl gap-6 rounded-3xl p-7 text-center sm:rounded-3xl sm:p-10">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10" aria-hidden="true"><Sparkles className="h-7 w-7 text-primary" /></div>
      <AlertDialogHeader className="space-y-3 text-center sm:text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Sección nueva · Contactos recomendados</p>
        <AlertDialogTitle className="text-2xl font-semibold tracking-tight sm:text-3xl">{recommendedNoticeTitle(notice)}</AlertDialogTitle>
        <AlertDialogDescription className="text-base leading-7 text-foreground/75">
          {recommendedNoticeText(notice)} Los encuentras en «Tus contactos de hoy», listos para revisar y enviar.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="gap-2 sm:justify-center sm:space-x-0">
        <AlertDialogCancel className="h-11 px-6 text-base sm:min-w-32">Cerrar</AlertDialogCancel>
        <AlertDialogAction className="h-11 px-6 text-base sm:min-w-56" onClick={go}>Ver mis recomendados</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
