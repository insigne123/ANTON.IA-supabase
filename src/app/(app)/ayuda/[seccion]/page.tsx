'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, Lightbulb, PlayCircle } from 'lucide-react';

import { AskHelp } from '@/components/help/AskHelp';
import { HelpIcon } from '@/components/help/help-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/context/AuthContext';
import { helpSectionById, helpSectionHref, helpSectionIdFrom, visibleHelpSections } from '@/lib/help/manual';
import { pageGuideFor } from '@/lib/onboarding/product-tour';
import { isOpportunitiesEnabled } from '@/lib/opportunities/access';

const HEADING = 'text-base font-semibold tracking-tight';

/**
 * One section of the manual on its own page (Plan 5, PR-11): what the screen is for, «Ir a la pantalla» and «Ver guía en
 * pantalla», the steps as numbered cards, tips, frequent questions and what to read next. The content is manual.ts.
 */
export default function HelpSectionPage() {
  const params = useParams<{ seccion?: string }>();
  const id = helpSectionIdFrom(params?.seccion);
  const { organizationRole } = useAuth();
  const admin = organizationRole === 'owner' || organizationRole === 'admin';
  const sections = useMemo(() => visibleHelpSections({ opportunities: isOpportunitiesEnabled(), admin }), [admin]);
  const section = sections.find((item) => item.id === id) || null;

  if (!section) {
    return (
      <div className="mx-auto max-w-[1200px] py-10">
        <EmptyState icon={BookOpen} title="Esta sección no está en el manual"
          description="Puede que el enlace sea antiguo o que la sección no esté disponible para tu cuenta."
          action={<Button asChild className="rounded-full"><Link href="/ayuda">Ir al Centro de ayuda</Link></Button>} />
      </div>
    );
  }

  const visibleIds = new Set(sections.map((item) => item.id));
  const related = (section.related || []).flatMap((relatedId) => {
    const item = visibleIds.has(relatedId) ? helpSectionById(relatedId) : null;
    return item ? [item] : [];
  });
  const guide = section.href ? pageGuideFor(section.href.split('?')[0]) : null;
  const guideHref = section.href ? `${section.href}${section.href.includes('?') ? '&' : '?'}guia=1` : null;

  return (
    <div className="mx-auto min-w-0 max-w-[1200px] space-y-6 pb-16">
      <Link href="/ayuda" className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-4" aria-hidden /> Centro de ayuda
      </Link>

      <header className="flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:flex-row sm:items-start sm:p-6">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <HelpIcon section={section.id} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{section.group}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{section.title}</h1>
          <p className="mt-1 leading-relaxed text-muted-foreground">{section.summary}</p>
          {(section.href || guide) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {section.href && (
                <Button asChild className="rounded-full">
                  <Link href={section.href}>Ir a {section.title}<ArrowRight aria-hidden /></Link>
                </Button>
              )}
              {guide && guideHref && (
                <Button asChild variant="outline" className="rounded-full">
                  <Link href={guideHref}><PlayCircle aria-hidden />Ver guía en pantalla</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="help-steps-title" className="space-y-3">
            <h2 id="help-steps-title" className={HEADING}>Paso a paso</h2>
            <ol className="grid gap-3 sm:grid-cols-2">
              {section.steps.map((step, index) => (
                <li key={step} className="flex gap-3 rounded-2xl border bg-card p-4">
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          </section>

          {section.tips && section.tips.length > 0 && (
            <section aria-labelledby="help-tips-title" className="space-y-3">
              <h2 id="help-tips-title" className={HEADING}>Consejos</h2>
              <ul className="space-y-2 rounded-2xl border bg-muted/30 p-4">
                {section.tips.map((tip) => (
                  <li key={tip} className="flex gap-2.5 text-sm leading-relaxed">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {section.faqs.length > 0 && (
            <section aria-labelledby="help-faqs-title" className="space-y-3">
              <h2 id="help-faqs-title" className={HEADING}>Preguntas frecuentes</h2>
              <div className="divide-y rounded-2xl border bg-card">
                {section.faqs.map((faq) => (
                  <details key={faq.q} className="group px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      {faq.q}
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {related.length > 0 && (
            <section aria-labelledby="help-related-title" className="space-y-3">
              <h2 id="help-related-title" className={HEADING}>Sigue con</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {related.map((item) => (
                  <li key={item.id}>
                    <Link href={helpSectionHref(item.id)}
                      className="flex h-full gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/80">
                        <HelpIcon section={item.id} className="size-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{item.title}</span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">{item.summary}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-16">
          <Card className="rounded-2xl">
            <CardContent className="p-5">
              <AskHelp sectionId={section.id} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
