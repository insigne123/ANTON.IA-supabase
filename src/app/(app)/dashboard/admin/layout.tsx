import { notFound, redirect } from 'next/navigation';

import { AdminDashboardNav } from '@/components/admin/admin-dashboard-nav';
import { AdminDashboardAuthError, requireAdminDashboardAccess } from '@/lib/server/admin-dashboard-auth';

export const dynamic = 'force-dynamic';

/**
 * The panel is checked on the server before any of it renders: someone who is not an owner or admin of the active
 * organization gets the 404 instead of the panel's frame with 403s inside. Each API checks the role again.
 */
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdminDashboardAccess();
  } catch (error) {
    if (error instanceof AdminDashboardAuthError && error.status === 401) redirect('/login?next=/dashboard/admin');
    if (error instanceof AdminDashboardAuthError && error.status === 403) notFound();
    throw error;
  }
  return (
    <div className="min-h-full">
      <AdminDashboardNav />
      {children}
    </div>
  );
}
