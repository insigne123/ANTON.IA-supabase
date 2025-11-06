
// src/app/(app)/dashboard/page.tsx
'use client';

import { PageHeader } from '@/components/page-header';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import NextStepsWidget from '@/components/dashboard/NextStepsWidget';
import PerformanceChart from '@/components/dashboard/PerformanceChart';
import SummaryCards from '@/components/dashboard/SummaryCards';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Bienvenido a tu centro de control. Aquí tienes un resumen de tu actividad y próximos pasos."
      />

      {/* Sección Superior: Cuotas y Métricas Principales */}
      <div className="grid gap-6 md:grid-cols-12">
        <div className="md:col-span-8">
          <SummaryCards />
        </div>
        <div className="md:col-span-4">
          <DailyQuotaProgress title="Consumo Diario" />
        </div>
      </div>

      {/* Sección Media: Próximos Pasos y Gráfico de Rendimiento */}
      <div className="grid gap-6 lg:grid-cols-2">
        <NextStepsWidget />
        <PerformanceChart />
      </div>

      {/* Sección Inferior: Actividad Reciente */}
      <ActivityFeed />

    </div>
  );
}
