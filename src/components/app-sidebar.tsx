
"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
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
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { BookOpen, CircleHelp, LogOut } from 'lucide-react';
import Logo from './logo';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { WorkspaceSwitcher } from '@/components/organization/WorkspaceSwitcher';
import { useProductTour } from '@/components/onboarding/ProductTour';
import type { NavAccess } from '@/hooks/use-nav-access';
import { NAV_SECTIONS, isNavItemActive } from '@/lib/navigation';

const itemClass = 'h-10 rounded-2xl px-3 text-[0.95rem] font-medium text-sidebar-foreground/80 transition-colors duration-200 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground';
const activeItemClass = 'bg-sidebar-accent/95 text-sidebar-accent-foreground shadow-[0_18px_38px_-28px_rgba(15,23,42,0.55)]';

/** `access` comes from the shell, which also uses it for the help: one request for both. */
export function AppSidebar({ access }: { access: NavAccess }) {
  const pathname = usePathname();
  const { signOut, organizationId, organizationRole } = useAuth();
  const productTour = useProductTour();
  const { isMobile, setOpenMobile } = useSidebar();
  // Every organization's owners and admins see its panel; the server checks the role again (admin-dashboard-auth.ts).
  const canAccessAdminDashboard = Boolean(organizationId) && (organizationRole === 'owner' || organizationRole === 'admin');

  // On phones the menu is a sheet over the page: it closes once a screen is chosen, also when it is the one on view.
  React.useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  const closeOnPhone = () => { if (isMobile) setOpenMobile(false); };

  const helpActive = pathname === '/ayuda' || pathname.startsWith('/ayuda/');
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
    <Sidebar className="border-r border-sidebar-border/70 bg-[linear-gradient(180deg,hsl(var(--sidebar-background))_0%,hsl(var(--sidebar-background))_68%,hsl(var(--background))_100%)]">
      <SidebarHeader className="gap-4 border-b border-sidebar-border/70 px-3 py-3">
        <Logo size="xl" showWordmark className="py-1" />
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent className="px-2 pb-3 pt-2">
        <nav aria-label="Navegación principal" className="contents">
          {visibleSections.map((section, index) => (
          <React.Fragment key={section.label}>
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/70">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {section.items.map((item) => {
                    const isActive = isNavItemActive(item, pathname);

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
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {index < visibleSections.length - 1 && <SidebarSeparator className="mx-3 my-2 bg-sidebar-border/65" />}
          </React.Fragment>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-3 border-t border-sidebar-border/70 px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={helpActive} className={cn(itemClass, helpActive && activeItemClass)}>
              <Link href="/ayuda" onClick={closeOnPhone} data-tour="help-center" aria-current={pathname === '/ayuda' ? 'page' : undefined}>
                <BookOpen />
                <span>Centro de ayuda</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton data-tour="tour-help" onClick={productTour.start} className={itemClass}>
              <CircleHelp />
              <span>Ver tutorial</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => signOut()} className={itemClass}>
              <LogOut />
              <span>Cerrar sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
