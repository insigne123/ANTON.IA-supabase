import {Suspense} from 'react';
import {UsageDashboard} from '@/components/admin/UsageDashboard';

/** Administration starts with usage and commercial evidence, rather than event-by-event history. */
export default function AdminDashboardPage(){
  return <Suspense fallback={<p role="status">Preparando el informe…</p>}><UsageDashboard/></Suspense>;
}
