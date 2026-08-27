
"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
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
  SidebarTrigger
} from '@/components/ui/sidebar';
import {
  User, Search, Send, Briefcase, Settings, Table as TableIcon, Users, MailCheck, LayoutDashboard, Building2, LogOut, Shield, LayoutGrid, Bot, Link2
} from 'lucide-react';
import Logo from './logo';
import { useAuth } from '@/context/AuthContext';
import { APP_VERSION } from '@/lib/app-version';
import { cn } from '@/lib/utils';
import { isOpportunitiesEnabled } from '@/lib/opportunities/access';
import { WorkspaceSwitcher } from '@/components/organization/WorkspaceSwitcher';

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  aliases?: string[];
  feature?: 'opportunities';
};

const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Centro de mando',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/antonia', icon: Bot, label: 'Agente ANTON.IA' },
      { href: '/profile', icon: User, label: 'Mi Perfil de Empresa' },
    ],
  },
  {
    label: 'Prospección',
    items: [
      { href: '/search', icon: Search, label: 'Búsqueda de Leads' },
      { href: '/opportunities', icon: Briefcase, label: 'Oportunidades', feature: 'opportunities' },
      { href: '/campaigns', icon: MailCheck, label: 'Campañas' },
    ],
  },
  {
    label: 'Pipeline y seguimiento',
    items: [
      { href: '/sheet', label: 'Sheet (Datos)', icon: TableIcon },
      { href: '/crm', label: 'Pipeline (CRM)', icon: LayoutGrid },
      { href: '/saved/leads', icon: Users, label: 'Guardados · Leads' },
      { href: '/saved/opportunities', icon: Briefcase, label: 'Guardados · Oportunidades', feature: 'opportunities' },
      { href: '/contacted', icon: Send, label: 'Leads Contactados' },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { href: '/connections', icon: Link2, label: 'Conexiones', aliases: ['/gmail', '/outlook'] },
      { href: '/settings/email-studio', icon: Settings, label: 'Email Studio' },
      { href: '/settings/organization', icon: Building2, label: 'Organización' },
      {
        href: '/settings/privacy',
        icon: Shield,
        label: 'Privacidad',
        aliases: ['/settings/unsubscribes', '/settings/privacy-requests', '/settings/privacy-incidents'],
      },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const canAccessOpportunities = isOpportunitiesEnabled();

  const isActiveRoute = (item: NavItem) => [item.href, ...(item.aliases || [])]
    .some((href) => pathname === href || pathname.startsWith(`${href}/`));

  return (
    <Sidebar className="border-r border-sidebar-border/70 bg-[linear-gradient(180deg,hsl(var(--sidebar-background))_0%,hsl(var(--sidebar-background))_68%,hsl(var(--background))_100%)]">
      <SidebarHeader className="gap-4 border-b border-sidebar-border/70 px-3 py-3">
        <div className="flex items-center justify-between gap-3 pr-1">
          <Logo size="xl" showWordmark className="py-1" />
          <SidebarTrigger className="hidden rounded-full border border-sidebar-border/80 bg-sidebar-accent/40 text-sidebar-foreground hover:bg-sidebar-accent md:flex" />
        </div>

        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent className="px-2 pb-3 pt-2">
        <nav aria-label="Navegacion principal" className="contents">
          {navSections.map((section, index) => (
          <React.Fragment key={section.label}>
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/55">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {section.items
                    .filter((item) => item.feature !== 'opportunities' || canAccessOpportunities)
                    .map((item) => {
                    const isActive = isActiveRoute(item);

                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.label}
                          className={cn(
                            'h-10 rounded-2xl px-3 text-[0.95rem] font-medium text-sidebar-foreground/82 transition-all duration-200',
                            'hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground',
                            isActive && 'bg-sidebar-accent/95 text-sidebar-accent-foreground shadow-[0_18px_38px_-28px_rgba(15,23,42,0.55)]',
                          )}
                        >
                          <Link href={item.href} className="text-[0.95rem]" aria-current={isActive ? 'page' : undefined}>
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
            {index < navSections.length - 1 && <SidebarSeparator className="mx-3 my-2 bg-sidebar-border/65" />}
          </React.Fragment>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-3 border-t border-sidebar-border/70 px-3 py-3">
        <div className="rounded-[20px] border border-sidebar-border/70 bg-sidebar-accent/25 px-3.5 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/55">Versión</div>
          <div className="mt-1 text-sm font-medium text-sidebar-foreground/85">{APP_VERSION}</div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => signOut()}
              className="h-10 rounded-2xl px-3 text-[0.95rem] font-medium text-sidebar-foreground/82 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground"
            >
              <LogOut />
              <span>Cerrar Sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
