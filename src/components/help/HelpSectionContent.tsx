'use client';

import Link from 'next/link';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { helpSectionById, helpSectionHref, type HelpSection } from '@/lib/help/manual';

/** One section of the manual: what it is for, how to use it, tips and FAQs. Shared by the «?» panel and /ayuda. */
export function HelpSectionContent({ section, visibleIds, onNavigate, headingLevel = 3 }: {
  section: HelpSection;
  /** Sections this person can see: related links to hidden ones are left out. */
  visibleIds: Set<string>;
  onNavigate?: () => void;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const related = (section.related || []).flatMap((id) => {
    const item = visibleIds.has(id) ? helpSectionById(id) : null;
    return item ? [item] : [];
  });
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <Heading className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Cómo se usa</Heading>
        <ol className="space-y-2">
          {section.steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">
                {index + 1}
              </span>
              <span className="leading-relaxed">{step.replace(/^\d+\.\s*/, '')}</span>
            </li>
          ))}
        </ol>
      </div>

      {section.tips?.length ? (
        <div className="space-y-2">
          <Heading className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Consejos</Heading>
          <ul className="list-disc space-y-1.5 pl-5 leading-relaxed marker:text-muted-foreground">
            {section.tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1">
        <Heading className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Preguntas frecuentes</Heading>
        <Accordion type="multiple" className="w-full">
          {section.faqs.map((faq) => (
            <AccordionItem key={faq.q} value={faq.q}>
              <AccordionTrigger className="py-3 text-left text-sm font-medium">{faq.q}</AccordionTrigger>
              <AccordionContent className="leading-relaxed text-muted-foreground">{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {related.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">Relacionado:</span>
          {related.map((item) => (
            <Link key={item.id} href={helpSectionHref(item.id)} onClick={onNavigate}
              className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {item.title}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}
