
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
  User, Search, Send, Briefcase, Settings, Table as TableIcon, Users, MailCheck, LayoutDashboard, LogOut, Shield, ShieldCheck, LayoutGrid, Bot, Link2, CircleHelp, Megaphone,
  BookOpen,
} from 'lucide-react';
import Logo from './logo';
import { useAuth } from '@/context/AuthContext';
import { APP_VERSION } from '@/lib/app-version';
import { cn } from '@/lib/utils';
import { WorkspaceSwitcher } from '@/components/organization/WorkspaceSwitcher';
import { COWORK_OWNER_EMAIL } from '@/lib/cowork/access';
import { useProductTour } from '@/components/onboarding/ProductTour';

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  aliases?: string[];
  feature?: 'opportunities' | 'admin-dashboard' | 'cowork';
  /** Step of the guided tour that highlights this entry. */
  tour?: string;
  /** Active only on its own path, not on the paths below it (/saved/leads vs /saved/leads/enriched). */
  exact?: boolean;
};

/** Grouped by what the person is doing, in the order of the work: today, find people, the people to write to, follow-up.
 * Labels say the state of a contact («Por escribir»: has an email; «Por completar»: still needs one) instead of the table it
 * lives in, so a contact that gets its email does not seem to vanish (H01, H14 of the GrupoExpro walkthrough). */
const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Centro de mando',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Hoy', tour: 'home' },
      { href: '/cowork', icon: Bot, label: 'Cowork', feature: 'cowork' },
    ],
  },
  {
    label: 'Prospectar',
    items: [
      { href: '/search', icon: Search, label: 'Buscar prospectos', tour: 'search' },
      { href: '/opportunities', icon: Briefcase, label: 'Oportunidades', feature: 'opportunities' },
    ],
  },
  {
    label: 'Contactos',
    items: [
      { href: '/saved/leads/enriched', icon: MailCheck, label: 'Por escribir', tour: 'saved-leads' },
      { href: '/saved/leads', icon: Users, label: 'Por completar', exact: true },
      { href: '/sheet', label: 'Tabla de datos', icon: TableIcon, aliases: ['/leads/import'] },
    ],
  },
  {
    label: 'Seguimiento',
    items: [
      { href: '/contacted', icon: Send, label: 'Conversaciones', tour: 'contacted' },
      { href: '/campaigns', icon: Megaphone, label: 'Campañas', tour: 'campaigns' },
      { href: '/crm', label: 'Pipeline', icon: LayoutGrid },
    ],
  },
  {
    label: 'Administración',
    items: [
      { href: '/dashboard/admin', icon: ShieldCheck, label: 'Administración', feature: 'admin-dashboard' },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { href: '/profile', icon: User, label: 'Perfil', tour: 'profile' },
      { href: '/connections', icon: Link2, label: 'Conexiones', aliases: ['/gmail', '/outlook'], tour: 'connections' },
      { href: '/settings/email-studio', icon: Settings, label: 'Firmas y estilo' },
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
  const { signOut, user, organizationId, organizationRole } = useAuth();
  const productTour = useProductTour();
  const [coworkScope, setCoworkScope] = React.useState<string | null>(null);
  const currentScope = `${user?.id || ''}:${organizationId || ''}`;
  React.useEffect(() => {
    setCoworkScope(null);
    if (user?.email?.trim().toLowerCase() !== COWORK_OWNER_EMAIL) return;
    const controller = new AbortController();
    fetch('/api/cowork/access', { cache: 'no-store', signal: controller.signal })
      .then(response => { if (response.ok && !controller.signal.aborted) setCoworkScope(currentScope); })
      .catch(() => {});
    return () => controller.abort();
  }, [currentScope, user?.email]);
  // «Oportunidades» is for the accounts in OPPORTUNITIES_ALLOWED_EMAILS: the server answers, the menu only follows it.
  const [opportunitiesScope, setOpportunitiesScope] = React.useState<string | null>(null);
  React.useEffect(() => {
    setOpportunitiesScope(null);
    if (!user?.id) return;
    const controller = new AbortController();
    fetch('/api/commercial-opportunities/access', { cache: 'no-store', signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data?.available === true && !controller.signal.aborted) setOpportunitiesScope(currentScope); })
      .catch(() => {});
    return () => controller.abort();
  }, [currentScope, user?.id]);
  const canAccessOpportunities = opportunitiesScope === currentScope;
  // Every organization's owners and admins see its panel; the server checks the role again (admin-dashboard-auth.ts).
  const canAccessAdminDashboard = Boolean(organizationId) && (organizationRole === 'owner' || organizationRole === 'admin');

  const isActiveRoute = (item: NavItem) => [item.href, ...(item.aliases || [])]
    .some((href) => pathname === href || (!item.exact && href !== '/dashboard' && pathname.startsWith(`${href}/`)));
  const helpActive = pathname === '/ayuda' || pathname.startsWith('/ayuda/');
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => item.feature !== 'opportunities' || canAccessOpportunities)
        .filter((item) => item.feature !== 'admin-dashboard' || canAccessAdminDashboard)
        .filter((item) => item.feature !== 'cowork' || coworkScope === currentScope),
    }))
    .filter((section) => section.items.length > 0);

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
          {visibleSections.map((section, index) => (
          <React.Fragment key={section.label}>
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/55">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {section.items.map((item) => {
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
                          <Link href={item.href} className="text-[0.95rem]" aria-current={isActive ? 'page' : undefined} data-tour={item.tour}>
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
        <div className="rounded-[20px] border border-sidebar-border/70 bg-sidebar-accent/25 px-3.5 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/55">Versión</div>
          <div className="mt-1 text-sm font-medium text-sidebar-foreground/85">{APP_VERSION}</div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={helpActive}
              className={cn(
                'h-10 rounded-2xl px-3 text-[0.95rem] font-medium text-sidebar-foreground/82 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground',
                helpActive && 'bg-sidebar-accent/95 text-sidebar-accent-foreground',
              )}
            >
              <Link href="/ayuda" data-tour="help-center" aria-current={pathname === '/ayuda' ? 'page' : undefined}>
                <BookOpen />
                <span>Centro de ayuda</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-tour="tour-help"
              onClick={productTour.start}
              className="h-10 rounded-2xl px-3 text-[0.95rem] font-medium text-sidebar-foreground/82 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground"
            >
              <CircleHelp />
              <span>Ver tutorial</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
