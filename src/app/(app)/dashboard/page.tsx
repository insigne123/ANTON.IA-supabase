
// src/app/(app)/dashboard/page.tsx
'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import NextStepsWidget from '@/components/dashboard/NextStepsWidget';
import PerformanceChart from '@/components/dashboard/PerformanceChart';
import SummaryCards from '@/components/dashboard/SummaryCards';
import { LayoutGrid, Search } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Revisa el avance de esta semana y continúa con lo más importante."
      >
        <Button asChild className="flex-1 sm:flex-none">
          <Link href="/search">
            <Search aria-hidden="true" />
            Buscar leads
          </Link>
        </Button>
        <Button asChild variant="ghost" className="flex-1 text-muted-foreground sm:flex-none">
          <Link href="/crm">
            <LayoutGrid aria-hidden="true" />
            Revisar CRM
          </Link>
        </Button>
      </PageHeader>

      <main className="space-y-4">
        <SummaryCards />

        <section aria-label="Trabajo recomendado y rendimiento" className="grid gap-4 xl:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.35fr)]">
          <NextStepsWidget />
          <PerformanceChart />
        </section>

        <DailyQuotaProgress summary title="Uso diario" />
      </main>
    </div>
  );
}
