import {Suspense} from 'react';
import {UsageDashboard} from '@/components/admin/UsageDashboard';
export default function AdminUsagePage(){return <Suspense fallback={<p role="status">Preparando el informe…</p>}><UsageDashboard/></Suspense>;}
