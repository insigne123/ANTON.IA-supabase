// src/app/(app)/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import PerformanceChart from '@/components/dashboard/PerformanceChart';
import UserCreditsCard from '@/components/dashboard/UserCreditsCard';
import { HomeSummary } from '@/components/home/HomeSummary';
import { TodayPanel } from '@/components/home/TodayPanel';
import { RecommendedLeads } from '@/components/home/RecommendedLeads';

const TODAY = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * «Hoy» (docs/inicio-hoy.md). The work first: the next step and what is waiting, in the main column. How the week goes,
 * the campaigns in progress and the credits sit beside it, so they never push the work down. On phones the order is
 * step → pending → summary → recommended.
 */
export default function DashboardPage() {
  // The date is read in the browser: the page is prerendered, and the server's day may not be the person's.
  const [today, setToday] = useState('');
  useEffect(() => {
    const label = TODAY.format(new Date());
    setToday(label.charAt(0).toLocaleUpperCase('es-CL') + label.slice(1));
  }, []);

  return (
    <div>
      <PageHeader
        title="Hoy"
        eyebrow={today || undefined}
        description="Lo que toca ahora, lo que falta para enviar y cómo va tu semana."
      >
        <Button asChild variant="ghost" className="flex-1 text-muted-foreground sm:flex-none">
          <Link href="/search">
            <Search aria-hidden="true" />
            Buscar prospectos
          </Link>
        </Button>
      </PageHeader>

      {/* items-start at every width: a stretched grid item would turn a card's h-full into the whole column. */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 xl:col-start-1">
          <TodayPanel />
        </div>

        <aside aria-label="Tu semana" className="min-w-0 space-y-4 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <HomeSummary />
          <PerformanceChart />
          <UserCreditsCard />
          <DailyQuotaProgress summary title="Uso diario" kinds={['contact']} />
        </aside>

        <div className="min-w-0 xl:col-start-1">
          <RecommendedLeads />
        </div>
      </div>
    </div>
  );
}
