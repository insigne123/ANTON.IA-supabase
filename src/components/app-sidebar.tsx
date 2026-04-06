
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
  SidebarTrigger
} from '@/components/ui/sidebar';
import {
  User, Search, Send, Share2, Briefcase, Settings, Table as TableIcon, Users, MailCheck, Mail, LayoutDashboard, Building2, LogOut, Ban, Shield, LayoutGrid, Bot
} from 'lucide-react';
import Logo from './logo';
import { useAuth } from '@/context/AuthContext';
import { APP_VERSION } from '@/lib/app-version';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { legalConfig } from '@/lib/legal-config';

const navSections = [
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
      { href: '/opportunities', icon: Briefcase, label: 'Oportunidades' },
      { href: '/campaigns', icon: MailCheck, label: 'Campañas' },
    ],
  },
  {
    label: 'Pipeline y seguimiento',
    items: [
      { href: '/sheet', label: 'Sheet (Datos)', icon: TableIcon },
      { href: '/crm', label: 'Pipeline (CRM)', icon: LayoutGrid },
      { href: '/saved/leads', icon: Users, label: 'Guardados · Leads' },
      { href: '/saved/opportunities', icon: Briefcase, label: 'Guardados · Oportunidades' },
      { href: '/contacted', icon: Send, label: 'Leads Contactados' },
    ],
  },
  {
    label: 'Canales y ajustes',
    items: [
      { href: '/outlook', icon: Share2, label: 'Conexión con Outlook' },
      { href: '/gmail', icon: Mail, label: 'Conectar Gmail' },
      { href: '/settings/email-studio', icon: Settings, label: 'Ajustes · Email Studio' },
      { href: '/settings/organization', icon: Building2, label: 'Ajustes · Organización' },
      { href: '/settings/unsubscribes', icon: Ban, label: 'Ajustes · Bajas' },
      { href: '/settings/privacy-requests', icon: Shield, label: 'Ajustes · Solicitudes privacidad' },
      { href: '/settings/privacy-incidents', icon: Shield, label: 'Ajustes · Incidentes privacidad' },
      { href: '/privacy', icon: Shield, label: 'Ajustes · Privacidad' },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { signOut, user } = useAuth();
  const canAccessPrivacyAdmin = String(user?.email || '').trim().toLowerCase() === String(legalConfig.privacyContactEmail || '').trim().toLowerCase();

  const isActiveRoute = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar className="border-r border-sidebar-border/70 bg-[linear-gradient(180deg,hsl(var(--sidebar-background))_0%,hsl(var(--sidebar-background))_68%,hsl(var(--background))_100%)]">
      <SidebarHeader className="gap-4 border-b border-sidebar-border/70 px-3 py-3">
        <div className="flex items-center justify-between gap-3 pr-1">
          <Logo size="xl" showWordmark className="py-1" />
          <SidebarTrigger className="hidden rounded-full border border-sidebar-border/80 bg-sidebar-accent/40 text-sidebar-foreground hover:bg-sidebar-accent md:flex" />
        </div>

        <div className="rounded-[22px] border border-sidebar-border/70 bg-sidebar-accent/30 px-3.5 py-3 shadow-[0_18px_40px_-36px_rgba(15,23,42,0.45)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-sidebar-foreground/65">Workspace</div>
              <div className="mt-1 text-sm font-medium text-sidebar-foreground">Operación comercial</div>
            </div>
            <Badge variant="outline" className="rounded-full border-sidebar-border/80 bg-sidebar/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-foreground/70">
              Activo
            </Badge>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 pb-3 pt-2">
        {navSections.map((section, index) => (
          <React.Fragment key={section.label}>
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/55">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {section.items
                    .filter((item) => canAccessPrivacyAdmin || (item.href !== '/settings/privacy-requests' && item.href !== '/settings/privacy-incidents'))
                    .map((item) => {
                    const isActive = isActiveRoute(item.href);

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
                          <Link href={item.href} className="text-[0.95rem]">
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
