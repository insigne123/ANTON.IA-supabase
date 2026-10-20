import { redirect } from 'next/navigation';

/** «Informe semanal» lives in «Hoy» as «Tu semana» (src/app/(app)/dashboard/page.tsx); old links and emails land there. */
export default function WeeklyReportPage() {
  redirect('/dashboard?vista=semana');
}
