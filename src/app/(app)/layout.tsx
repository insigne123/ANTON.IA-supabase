import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import ThemeToggle from '@/components/theme-toggle';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Topbar móvil */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm md:hidden">
          <SidebarTrigger />
          <div className="ml-auto"><ThemeToggle /></div>
        </header>

        {/* Topbar desktop (visible en md+) */}
        <div className="sticky top-0 z-10 hidden h-14 items-center justify-end border-b bg-background/80 px-6 backdrop-blur-sm md:flex">
          <ThemeToggle />
        </div>

        <main className="flex-1 px-4 py-4 md:px-8 md:py-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
