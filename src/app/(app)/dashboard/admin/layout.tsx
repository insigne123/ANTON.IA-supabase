import { AdminDashboardNav } from '@/components/admin/admin-dashboard-nav';

export const dynamic = 'force-dynamic';

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <AdminDashboardNav />
      {children}
    </div>
  );
}
