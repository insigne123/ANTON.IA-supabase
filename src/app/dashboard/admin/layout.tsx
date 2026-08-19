export const dynamic = 'force-dynamic';

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-muted/20 text-foreground dark:bg-background">{children}</div>;
}
