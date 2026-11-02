import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { costSentence } from '@/lib/credit-results';
import { monthCreditsSentence, monthRecommendation, opportunitiesSentence, type MonthSection } from '@/lib/month-summary';

/**
 * «Resumen de octubre» in «Equipo», during the first week of a month (src/lib/month-summary.ts): what the month's credits got,
 * the opportunities presented, won and lost, and one thing to do next. Nothing to tell is no block.
 */
export function MonthSummary({ month }: { month: MonthSection }) {
  const credits = monthCreditsSentence(month);
  const cost = credits && month.credits ? costSentence(month.credits) : null;
  const opportunities = opportunitiesSentence(month.opportunities);
  const next = monthRecommendation(month);
  if (!credits && !opportunities && !next) return null;
  return <section aria-labelledby="month-summary-title" className="space-y-3 rounded-2xl border p-4">
    <h2 id="month-summary-title" className="text-sm font-medium">Resumen de {month.label}</h2>
    {credits ? <p className="text-sm leading-6">{credits}</p> : null}
    {cost ? <p className="text-sm text-muted-foreground">{`${cost.charAt(0).toUpperCase()}${cost.slice(1)}.`}</p> : null}
    {opportunities ? <p className="text-sm leading-6">{opportunities}</p> : null}
    {next ? <Link href={next.href} className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span>{next.text}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link> : null}
  </section>;
}
