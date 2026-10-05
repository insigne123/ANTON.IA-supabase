'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, PlayCircle, Search, X } from 'lucide-react';

import { AskHelp } from '@/components/help/AskHelp';
import { HelpIcon } from '@/components/help/help-icons';
import { TutorialVideoCard } from '@/components/help/TutorialVideo';
import { useProductTour } from '@/components/onboarding/ProductTour';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { useSharedNavAccess } from '@/hooks/use-nav-access';
import {
  FIRST_EMAIL_PATH, HELP_GROUPS, helpSectionHref, helpSectionIdFrom, popularHelpQuestions, searchHelp, visibleHelpSections,
} from '@/lib/help/manual';
import { visibleTutorialVideos } from '@/lib/help/tutorial-videos';

const CARD_LINK = 'flex h-full gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * «Centro de ayuda» (Plan 5, PR-11): a big search, «Tu camino al primer correo», the popular questions and every topic as
 * a card that opens its own page (/ayuda/[seccion]). «Pregúntale a la IA» stays at hand on the side on desktop.
 */
export default function HelpCenterPage() {
  const { organizationRole } = useAuth();
  const { start } = useProductTour();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const admin = organizationRole === 'owner' || organizationRole === 'admin';
  // The same parts of the app as the menu: «Oportunidades» only for the accounts the server lets in.
  const { opportunities } = useSharedNavAccess();
  const sections = useMemo(() => visibleHelpSections({ opportunities, admin }), [opportunities, admin]);
  const visibleIds = useMemo(() => new Set(sections.map((section) => section.id)), [sections]);
  const groups = useMemo(() => HELP_GROUPS
    .map((group) => ({ group, items: sections.filter((section) => section.group === group) }))
    .filter((entry) => entry.items.length > 0), [sections]);
  const results = useMemo(() => (query.trim().length >= 2 ? searchHelp(query, sections, 8) : null), [query, sections]);
  const popular = useMemo(() => popularHelpQuestions(sections), [sections]);
  const path = FIRST_EMAIL_PATH.filter((step) => visibleIds.has(step.section));
  const videos = useMemo(() => visibleTutorialVideos({ opportunities }), [opportunities]);

  // Older links point at a section of this page (/ayuda#perfil): each section now has its own page.
  useEffect(() => {
    const id = helpSectionIdFrom(window.location.hash.slice(1));
    if (id && visibleIds.has(id)) router.replace(helpSectionHref(id));
  }, [router, visibleIds]);

  return (
    <div className="mx-auto min-w-0 max-w-[1200px] space-y-8 pb-16">
      <PageHeader title="Centro de ayuda" description="Cómo usar ANTON.IA: cada pantalla paso a paso y las respuestas a las dudas más comunes.">
        <Button className="w-full rounded-full sm:w-auto" onClick={start}>
          <PlayCircle aria-hidden />
          Ver recorrido por la app
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="help-search-title" className="rounded-3xl border bg-card p-5 sm:p-6">
            <h2 id="help-search-title" className="text-lg font-semibold tracking-tight">¿En qué te ayudamos?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Escribe una palabra o una duda: «correo», «créditos», «campaña».</p>
            <div className="relative mt-4">
              <Label htmlFor="help-search" className="sr-only">Buscar en el manual</Label>
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="help-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="¿Qué necesitas saber?" className="h-12 rounded-2xl pl-12 pr-11 text-base" autoComplete="off" />
              {query && (
                <Button variant="ghost" size="icon" className="absolute right-1.5 top-1/2 size-9 -translate-y-1/2 text-muted-foreground"
                  aria-label="Borrar búsqueda" onClick={() => setQuery('')}>
                  <X className="size-4" aria-hidden />
                </Button>
              )}
            </div>
            {results && (
              <div role="region" aria-live="polite" aria-label="Resultados de la búsqueda" className="mt-3 space-y-2">
                {results.length === 0 ? (
                  <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                    No encontramos «{query.trim()}». Prueba con otra palabra o pregúntale a la IA.
                  </p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {results.map((match) => (
                      <li key={`${match.section.id}:${match.faq?.q || 'section'}`}>
                        <Link href={helpSectionHref(match.section.id)}
                          className="block rounded-xl px-3 py-2.5 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="block font-medium">{match.faq?.q || match.section.title}</span>
                          <span className="line-clamp-2 text-muted-foreground">{match.faq?.a || match.section.summary}</span>
                          <span className="mt-0.5 block text-xs text-primary">{match.section.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {path.length > 0 && (
            <section aria-labelledby="help-path-title" className="space-y-3">
              <div>
                <h2 id="help-path-title" className="text-base font-semibold tracking-tight">Tu camino al primer correo</h2>
                <p className="text-sm text-muted-foreground">Los pasos en el orden en que se hacen. Toca uno para ver cómo.</p>
              </div>
              <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {path.map((step, index) => (
                  <li key={step.section}>
                    <Link href={helpSectionHref(step.section)} className={CARD_LINK}>
                      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <HelpIcon section={step.section} className="size-5" />
                        <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                          {index + 1}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{step.title}</span>
                        <span className="block text-sm text-muted-foreground">{step.text}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {videos.length > 0 && (
            <section aria-labelledby="help-videos-title" className="space-y-3">
              <div>
                <h2 id="help-videos-title" className="text-base font-semibold tracking-tight">Videos por módulo</h2>
                <p className="text-sm text-muted-foreground">Cada módulo en uno o dos minutos, paso a paso y con datos de ejemplo.</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {videos.map((video) => <li key={video.id}><TutorialVideoCard video={video} /></li>)}
              </ul>
            </section>
          )}

          {popular.length > 0 && (
            <section aria-labelledby="help-popular-title" className="space-y-3">
              <h2 id="help-popular-title" className="text-base font-semibold tracking-tight">Preguntas populares</h2>
              <div className="divide-y rounded-2xl border bg-card">
                {popular.map(({ section, faq }) => (
                  <details key={faq.q} className="group px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      {faq.q}
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
                    <Link href={helpSectionHref(section.id)} className="mt-1 inline-block rounded text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Más en {section.title}
                    </Link>
                  </details>
                ))}
              </div>
            </section>
          )}

          <nav aria-label="Índice del manual" className="space-y-5">
            <h2 className="text-base font-semibold tracking-tight">Todos los temas</h2>
            {groups.map(({ group, items }) => (
              <div key={group} className="space-y-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{group}</h3>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((section) => (
                    <li key={section.id}>
                      <Link href={helpSectionHref(section.id)} className={CARD_LINK}>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/80">
                          <HelpIcon section={section.id} className="size-[18px]" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{section.title}</span>
                          <span className="line-clamp-2 text-sm text-muted-foreground">{section.summary}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <aside className="lg:sticky lg:top-16">
          <Card className="rounded-2xl">
            <CardContent className="p-5">
              <AskHelp />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
