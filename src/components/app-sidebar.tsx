
"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LinkPending } from '@/components/link-pending';
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { BookOpen, ChevronRight, LogOut, PlayCircle } from 'lucide-react';
import Logo from './logo';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { WorkspaceSwitcher } from '@/components/organization/WorkspaceSwitcher';
import { useProductTour } from '@/components/onboarding/ProductTour';
import type { NavAccess } from '@/hooks/use-nav-access';
import type { NavPendingCounts } from '@/hooks/use-nav-pending';
import { NAV_SECTIONS, isNavItemActive } from '@/lib/navigation';

const itemClass = 'h-8 rounded-xl px-3 text-[0.95rem] font-medium text-sidebar-foreground/80 transition-colors duration-200 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground';
const activeItemClass = 'bg-sidebar-accent/95 text-sidebar-accent-foreground shadow-[0_18px_38px_-28px_rgba(15,23,42,0.55)]';

/** `access` comes from the shell, which also uses it for the help: one request for both. */
export function AppSidebar({ access,adminUsage=false,pending=null }: { access: NavAccess;adminUsage?:boolean;pending?:NavPendingCounts|null }) {
  const pathname = usePathname();
  const { signOut, organizationId, organizationRole } = useAuth();
  const productTour = useProductTour();
  const { isMobile, setOpenMobile, state } = useSidebar();
  // Folded to a rail of icons (768–1099 px by default, or by the person): every entry shows, each one with its name on hover.
  const rail = state === 'collapsed' && !isMobile;
  // Every organization's owners and admins see its panel; the server checks the role again (admin-dashboard-auth.ts).
  const canAccessAdminDashboard = adminUsage || Boolean(organizationId) && (organizationRole === 'owner' || organizationRole === 'admin');

  // On phones the menu is a sheet over the page: it closes once a screen is chosen, also when it is the one on view.
  React.useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  const closeOnPhone = () => { if (isMobile) setOpenMobile(false); };

  const helpActive = pathname === '/ayuda' || pathname.startsWith('/ayuda/');
  const [unfolded, setUnfolded] = React.useState<Record<string, boolean>>({});
  // The open screen stays in view inside the menu, also when it sits below the fold of a laptop screen.
  const sectionCount = NAV_SECTIONS.length;
  React.useEffect(() => {
    // After the entries that depend on access appear, which moves the rest down.
    const frame = window.requestAnimationFrame(() =>
      document.querySelector('[data-sidebar="content"] [aria-current="page"]')?.scrollIntoView?.({ block: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, access.opportunities, access.cowork, canAccessAdminDashboard, sectionCount]);
  const visibleSections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => item.feature !== 'opportunities' || access.opportunities)
        .filter((item) => item.feature !== 'admin-dashboard' || canAccessAdminDashboard)
        .filter((item) => item.feature !== 'cowork' || access.cowork),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/70 bg-[linear-gradient(180deg,hsl(var(--sidebar-background))_0%,hsl(var(--sidebar-background))_68%,hsl(var(--background))_100%)]">
      <SidebarHeader className={cn('gap-3 border-b border-sidebar-border/70 py-3', rail ? 'items-center px-2' : 'px-3')}>
        <Logo size={rail ? 'sm' : 'lg'} showWordmark={!rail} />
        {rail ? null : <WorkspaceSwitcher />}
      </SidebarHeader>

      {/* The menu scrolls on short screens: its lower edge fades, so an item under it reads as «more below», not as cut off. */}
      <SidebarContent className="gap-2 px-2 pb-4 pt-2 [mask-image:linear-gradient(to_bottom,#000_calc(100%-2rem),transparent)]">
        <nav aria-label="Navegación principal" className="contents">
          {visibleSections.map((section) => {
            const activeInside = section.items.some((item) => isNavItemActive(item, pathname));
            const open = rail || !section.collapsible || activeInside || Boolean(unfolded[section.label]);
            // A section with a single entry of the same name («Administración») needs no title above it.
            const titled = !(section.items.length === 1 && section.items[0].label === section.label);
            const labelClass = 'h-6 px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/70';
            return (
            <SidebarGroup key={section.label} className="p-0">
              {section.collapsible ? (
                <SidebarGroupLabel asChild className={cn(labelClass, 'w-full justify-between hover:text-sidebar-foreground')}>
                  <button type="button" className="disabled:cursor-default" aria-expanded={open} onClick={() => setUnfolded((state) => ({ ...state, [section.label]: !open }))} disabled={activeInside}>
                    {section.label}
                    <ChevronRight aria-hidden="true" className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-90')} />
                  </button>
                </SidebarGroupLabel>
              ) : titled ? (
                <SidebarGroupLabel className={labelClass}>{section.label}</SidebarGroupLabel>
              ) : null}
              {open && <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {section.items.map((item) => {
                    const isActive = isNavItemActive(item, pathname);
                    // What waits there (APP-23): a quiet number beside the name, a dot on the icon when the menu is a rail.
                    const waiting = item.pending ? pending?.[item.pending.key] ?? 0 : 0;

                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.label}
                          className={cn(itemClass, isActive && activeItemClass)}
                        >
                          <Link href={item.href} onClick={closeOnPhone} aria-current={isActive ? 'page' : undefined} data-tour={item.tour}>
                            <item.icon />
                            <span>{item.label}</span>
                            {waiting > 0 && item.pending ? <>
                              <span aria-hidden="true" className="ml-auto min-w-5 rounded-full bg-primary/10 px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums text-primary group-data-[collapsible=icon]:hidden">{waiting > 99 ? '99+' : waiting}</span>
                              <span aria-hidden="true" className="absolute right-1 top-1 hidden h-2 w-2 rounded-full bg-primary group-data-[collapsible=icon]:block" />
                              <span className="sr-only">: {waiting} {item.pending.label}</span>
                            </> : null}
                            <LinkPending />
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>}
            </SidebarGroup>
            );
          })}
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-3 border-t border-sidebar-border/70 px-3 py-2">
        <SidebarMenu className="gap-0.5">
          {/* Help and the tutorial share a row, so the work sections above keep the height of a laptop screen. */}
          <SidebarMenuItem className="flex items-center gap-1">
            <SidebarMenuButton asChild isActive={helpActive} tooltip="Centro de ayuda" className={cn(itemClass, 'flex-1', helpActive && activeItemClass)}>
              <Link href="/ayuda" onClick={closeOnPhone} data-tour="help-center" aria-current={pathname === '/ayuda' ? 'page' : undefined}>
                <BookOpen />
                <span>Centro de ayuda</span>
              </Link>
            </SidebarMenuButton>
            <SidebarMenuButton data-tour="tour-help" onClick={productTour.start} tooltip="Ver tutorial" aria-label="Ver tutorial" title="Ver tutorial" className={cn(itemClass, 'w-8 shrink-0 justify-center px-0 group-data-[collapsible=icon]:hidden')}>
              <PlayCircle />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => signOut()} tooltip="Cerrar sesión" className={itemClass}>
              <LogOut />
              <span>Cerrar sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
