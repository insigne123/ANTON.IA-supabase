// src/app/(app)/dashboard/page.tsx
'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import PerformanceChart from '@/components/dashboard/PerformanceChart';
import SummaryCards from '@/components/dashboard/SummaryCards';
import UserCreditsCard from '@/components/dashboard/UserCreditsCard';
import { TodayPanel } from '@/components/home/TodayPanel';
import { RecommendedLeads } from '@/components/home/RecommendedLeads';
import { Search } from 'lucide-react';

/** «Hoy» (docs/inicio-hoy.md): what to do now first, who to write to, then how the week is going, then credits. */
export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Hoy"
        description="Lo que toca ahora, lo que falta para enviar y cómo va tu semana."
      >
        <Button asChild variant="ghost" className="flex-1 text-muted-foreground sm:flex-none">
          <Link href="/search">
            <Search aria-hidden="true" />
            Buscar prospectos
          </Link>
        </Button>
      </PageHeader>

      <main className="space-y-8">
        <TodayPanel />

        <RecommendedLeads />

        <section aria-labelledby="week-title" className="space-y-4">
          <h2 id="week-title" className="text-base font-semibold tracking-tight">Tu semana</h2>
          <SummaryCards />
          <PerformanceChart />
        </section>

        <section aria-labelledby="credits-title" className="space-y-4">
          <h2 id="credits-title" className="text-base font-semibold tracking-tight">Créditos y uso diario</h2>
          <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.65fr)_minmax(0,1.5fr)]">
            <UserCreditsCard />
            <DailyQuotaProgress summary title="Uso diario" kinds={['contact']} className="h-full [&>div]:h-full" />
          </div>
        </section>
      </main>
    </div>
  );
}
