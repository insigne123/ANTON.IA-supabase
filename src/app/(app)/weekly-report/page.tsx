'use client';

import { DocumentTitle } from '@/components/document-title';
import { WeeklyReport } from '@/components/weekly-report/WeeklyReport';

/** «Informe semanal» (src/components/weekly-report/WeeklyReport.tsx). */
export default function WeeklyReportPage() {
  return <>
    <DocumentTitle title="Informe semanal" />
    <WeeklyReport />
  </>;
}
