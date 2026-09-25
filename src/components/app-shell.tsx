'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { AppSidebar } from '@/components/app-sidebar';
import { ProductTourProvider } from '@/components/onboarding/ProductTour';
import QuotaSync from '@/components/quota/quota-sync';
import ThemeToggle from '@/components/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
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
      <ProductTourProvider userId={user?.id} onNavigate={(href) => router.push(href)}>
        <QuotaSync />
        <AppSidebar />
        <SidebarInset>
          <p className="sr-only" role="status" aria-live="polite">{workspaceAnnouncement}</p>
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-sm md:hidden">
            <SidebarTrigger data-tour="menu" />
            <div className="ml-auto"><ThemeToggle /></div>
          </header>

          <div className="sticky top-0 z-10 hidden h-12 items-center justify-between border-b bg-background/85 px-6 backdrop-blur-sm md:flex">
            <SidebarTrigger />
            <ThemeToggle />
          </div>

          <main ref={contentRef} tabIndex={-1} className={cn(
            'flex-1 min-h-0 min-w-0 overflow-x-hidden px-4 py-4 md:px-6 md:py-5'
          )}>
            {children}
          </main>
        </SidebarInset>
      </ProductTourProvider>
    </SidebarProvider>
  );
}
