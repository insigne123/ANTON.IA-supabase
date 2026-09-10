import { redirect } from 'next/navigation';
import { AdminDashboardAuthError, requireAdminDashboardAccess } from '@/lib/server/admin-dashboard-auth';

export const dynamic = 'force-dynamic';

export default async function OrganizationPage() {
  try {
    await requireAdminDashboardAccess();
  } catch (error) {
    if (error instanceof AdminDashboardAuthError && [401, 403].includes(error.status)) {
      redirect('/profile');
    }
    throw error;
  }
  redirect('/dashboard/admin/users');
}
