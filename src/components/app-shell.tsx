'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { AppSidebar } from '@/components/app-sidebar';
import { PageHelpButton } from '@/components/help/PageHelp';
import Logo from '@/components/logo';
import { ProductTourProvider } from '@/components/onboarding/ProductTour';
import QuotaSync from '@/components/quota/quota-sync';
import ThemeToggle from '@/components/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth } from '@/context/AuthContext';
import { NavAccessProvider, useNavAccess } from '@/hooks/use-nav-access';
import { navLabelFor } from '@/lib/navigation';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, organizationId, organizationRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const navAccess = useNavAccess({ userId: user?.id, email: user?.email, organizationId });
  const access = useMemo(() => ({ cowork: navAccess.cowork, opportunities: navAccess.opportunities }), [navAccess.cowork, navAccess.opportunities]);
  // The help shows the same parts of the app as the menu.
  const helpVisibility = { opportunities: access.opportunities, admin: organizationRole === 'owner' || organizationRole === 'admin' };
  const screenLabel = navLabelFor(pathname);
  const [workspaceAnnouncement, setWorkspaceAnnouncement] = useState('');
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const workspaceName = window.sessionStorage.getItem('antonia-workspace-focus');
    if (!workspaceName) return;
    window.sessionStorage.removeItem('antonia-workspace-focus');
    setWorkspaceAnnouncement(`Workspace activo: ${workspaceName}.`);
    const frame = window.requestAnimationFrame(() => contentRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <SidebarProvider defaultOpen>
      <a
        href="#contenido"
        onClick={(event) => { event.preventDefault(); contentRef.current?.focus(); }}
        className="sr-only rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[60] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Saltar al contenido
      </a>
      <ProductTourProvider userId={user?.id} onNavigate={(href) => router.push(href)}>
        <QuotaSync />
        <AppSidebar access={access} />
        <SidebarInset>
          <p className="sr-only" role="status" aria-live="polite">{workspaceAnnouncement}</p>
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/85 px-2 backdrop-blur-sm md:hidden">
            <SidebarTrigger data-tour="menu" />
            <Logo size="sm" showWordmark={false} />
            {screenLabel && <span className="min-w-0 truncate text-sm font-semibold text-foreground">{screenLabel}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-1"><PageHelpButton visibility={helpVisibility} /><ThemeToggle /></div>
          </header>

          <div className="sticky top-0 z-10 hidden h-12 items-center justify-between border-b bg-background/85 px-6 backdrop-blur-sm md:flex">
            <SidebarTrigger />
            <div className="flex items-center gap-1"><PageHelpButton visibility={helpVisibility} /><ThemeToggle /></div>
          </div>

          <main
            ref={contentRef}
            id="contenido"
            tabIndex={-1}
            className="min-h-0 min-w-0 flex-1 overflow-x-clip px-4 py-4 outline-none md:px-6 md:py-5"
          >
            <NavAccessProvider value={access}>{children}</NavAccessProvider>
          </main>
        </SidebarInset>
      </ProductTourProvider>
    </SidebarProvider>
  );
}
