
// src/app/(app)/dashboard/page.tsx
'use client';

import { PageHeader } from '@/components/page-header';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import NextStepsWidget from '@/components/dashboard/NextStepsWidget';
import PerformanceChart from '@/components/dashboard/PerformanceChart';
import FunnelChart from '@/components/dashboard/FunnelChart';
import SummaryCards from '@/components/dashboard/SummaryCards';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Revisa tus métricas, detecta lo que necesita atención y sigue el siguiente paso sin perder tiempo."
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <SummaryCards />
          <div className="grid gap-6 lg:grid-cols-2">
            <NextStepsWidget />
            <PerformanceChart />
          </div>
        </div>
        <DailyQuotaProgress title="Uso diario" />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <FunnelChart />
      </section>

      <ActivityFeed />
    </div>
  );
}
