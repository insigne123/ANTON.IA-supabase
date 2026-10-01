'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, PlayCircle, Search, X } from 'lucide-react';

import { AskHelp } from '@/components/help/AskHelp';
import { HelpSectionContent } from '@/components/help/HelpSectionContent';
import { useProductTour } from '@/components/onboarding/ProductTour';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { HELP_GROUPS, helpSectionHref, searchHelp, visibleHelpSections } from '@/lib/help/manual';
import { isOpportunitiesEnabled } from '@/lib/opportunities/access';

/** «Centro de ayuda»: the whole manual, with search, a table of contents, FAQs and «Pregúntale a la IA». */
export default function HelpCenterPage() {
  const { organizationRole } = useAuth();
  const { start } = useProductTour();
  const [query, setQuery] = useState('');
  const admin = organizationRole === 'owner' || organizationRole === 'admin';
  const sections = useMemo(() => visibleHelpSections({ opportunities: isOpportunitiesEnabled(), admin }), [admin]);
  const visibleIds = useMemo(() => new Set(sections.map((section) => section.id)), [sections]);
  const groups = useMemo(() => HELP_GROUPS
    .map((group) => ({ group, items: sections.filter((section) => section.group === group) }))
    .filter((entry) => entry.items.length > 0), [sections]);
  const results = useMemo(() => (query.trim().length >= 2 ? searchHelp(query, sections, 8) : null), [query, sections]);

  // Opened from a «?» link (/ayuda#perfil): the content renders on the client, so bring the section into view here.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mx-auto min-w-0 max-w-[1200px] space-y-6 pb-16">
      <PageHeader title="Centro de ayuda" description="Cómo usar ANTON.IA: cada pantalla paso a paso y las respuestas a las dudas más comunes.">
        <Button className="w-full rounded-full sm:w-auto" onClick={start}>
          <PlayCircle aria-hidden />
          Ver recorrido por la app
        </Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Busca en el manual</CardTitle>
            <CardDescription>Escribe una palabra o una duda: «correo», «créditos», «campaña».</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Label htmlFor="help-search" className="sr-only">Buscar en el manual</Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="help-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="¿Qué necesitas saber?" className="pl-9 pr-9" autoComplete="off" />
              {query && (
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground"
                  aria-label="Borrar búsqueda" onClick={() => setQuery('')}>
                  <X className="size-4" aria-hidden />
                </Button>
              )}
            </div>
            {results && (
              <div role="region" aria-live="polite" aria-label="Resultados de la búsqueda" className="space-y-2">
                {results.length === 0 ? (
                  <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                    No encontramos «{query.trim()}». Prueba con otra palabra o pregúntale a la IA.
                  </p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {results.map((match) => (
                      <li key={`${match.section.id}:${match.faq?.q || 'section'}`}>
                        <a href={helpSectionHref(match.section.id)}
                          onClick={() => document.getElementById(match.section.id)?.scrollIntoView({ block: 'start' })}
                          className="block rounded-xl px-3 py-2.5 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="block font-medium">{match.faq?.q || match.section.title}</span>
                          <span className="line-clamp-2 text-muted-foreground">{match.faq?.a || match.section.summary}</span>
                          <span className="mt-0.5 block text-xs text-primary">{match.section.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <AskHelp />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Índice del manual" className="lg:sticky lg:top-16 lg:self-start">
          <div className="grid grid-cols-2 gap-4 rounded-2xl border bg-card/60 p-4 sm:grid-cols-3 lg:grid-cols-1">
            {groups.map(({ group, items }) => (
              <div key={group} className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{group}</p>
                <ul className="space-y-0.5">
                  {items.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`}
                        className="block rounded-lg px-2 py-1 text-sm text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          {sections.map((section) => (
            <Card key={section.id} id={section.id} className="scroll-mt-16 rounded-2xl" aria-labelledby={`${section.id}-title`}>
              <CardHeader className="gap-1 pb-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{section.group}</p>
                <CardTitle id={`${section.id}-title`} className="text-lg tracking-tight">{section.title}</CardTitle>
                <CardDescription className="leading-relaxed">{section.summary}</CardDescription>
                {section.href && (
                  <div className="pt-2">
                    <Button asChild variant="outline" size="sm" className="rounded-full">
                      <Link href={section.href}>
                        Ir a {section.title}
                        <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <HelpSectionContent section={section} visibleIds={visibleIds} />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
