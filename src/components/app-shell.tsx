'use client';

import type { ReactNode } from 'react';

import { AppSidebar } from '@/components/app-sidebar';
import QuotaSync from '@/components/quota/quota-sync';
import ThemeToggle from '@/components/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <QuotaSync />
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-sm md:hidden">
          <SidebarTrigger />
          <div className="ml-auto"><ThemeToggle /></div>
        </header>

        <div className="sticky top-0 z-10 hidden h-12 items-center justify-between border-b bg-background/85 px-6 backdrop-blur-sm md:flex">
          <SidebarTrigger />
          <ThemeToggle />
        </div>

        <div className={cn(
          'flex-1 min-h-0 min-w-0 overflow-x-hidden px-4 py-4 md:px-6 md:py-5'
        )}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
