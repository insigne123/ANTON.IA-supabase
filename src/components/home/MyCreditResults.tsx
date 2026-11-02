'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { WAITING_AFTER_DAYS, type CreditOutcomes } from '@/lib/credit-results';
import { usePersonalHome } from './usePersonalHome';

type Response = CreditOutcomes & { month: string };
const plural = (count: number, one: string, many: string) => `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;

/**
 * «Tus créditos de noviembre» in «Hoy» (src/lib/credit-results.ts): what the person's own credits got this month, and
 * the paid people still waiting for a first contact. Nothing used this month is no card.
 */
export function MyCreditResults() {
  const { data } = usePersonalHome<Response>('/api/home/credit-results');
  return <MyCreditResultsView data={data} />;
}

export function MyCreditResultsView({ data }: { data: Response | null }) {
  if (!data || (!data.credits && !data.paid)) return null;
  const line = [
    plural(data.credits, 'crédito', 'créditos'),
    plural(data.paid, 'persona con datos', 'personas con datos'),
    plural(data.contacted, 'contactada', 'contactadas'),
    plural(data.conversations, 'conversación', 'conversaciones'),
    plural(data.meetings, 'reunión', 'reuniones'),
  ].join(' · ');
  return (
    <Card role="region" className="rounded-2xl" aria-labelledby="my-credit-results-title">
      <CardContent className="space-y-2 p-4">
        <h2 id="my-credit-results-title" className="text-sm font-semibold">Tus créditos de {data.month}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{line}</p>
        {data.waiting ? (
          <p className="text-sm">
            <Link href="/saved/leads/enriched" className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {plural(data.waiting, 'persona pagada espera', 'personas pagadas esperan')} tu primer contacto
            </Link>{' '}
            <span className="text-muted-foreground">(más de {WAITING_AFTER_DAYS} días).</span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
