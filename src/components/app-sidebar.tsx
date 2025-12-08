
"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger
} from '@/components/ui/sidebar';
import {
  User, Search, Send, Share2, Briefcase, Settings, Table as TableIcon, Users, MailCheck, Mail, LayoutDashboard, Building2, LogOut, Ban
} from 'lucide-react';
import Logo from './logo';
import { useAuth } from '@/context/AuthContext';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/profile', icon: User, label: 'Mi Perfil de Empresa' },
  { href: '/search', icon: Search, label: 'Búsqueda de Leads' },
  { href: '/opportunities', icon: Briefcase, label: 'Oportunidades' },
  { href: '/campaigns', icon: MailCheck, label: 'Campañas' },
  { href: '/sheet', label: 'Sheet (CRM)', icon: TableIcon },
  { href: '/saved/leads', icon: Users, label: 'Guardados · Leads' },
  { href: '/saved/opportunities', icon: Briefcase, label: 'Guardados · Oportunidades' },
  { href: '/contacted', icon: Send, label: 'Leads Contactados' },
  { href: '/outlook', icon: Share2, label: 'Conexión con Outlook' },
  { href: '/gmail', icon: Mail, label: 'Conectar Gmail' },
  { href: '/settings/email-studio', icon: Settings, label: 'Ajustes · Email Studio' },
  { href: '/settings/organization', icon: Building2, label: 'Ajustes · Organización' },
  { href: '/settings/unsubscribes', icon: Ban, label: 'Ajustes · Bajas' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between pr-1">
          {/* Logo agrandado */}
          <Logo size="xl" showWordmark className="py-2" />
          <SidebarTrigger className="hidden md:flex" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(item.href)}
                tooltip={item.label}
              >
                <a href={item.href} className="text-[0.95rem]">
                  <item.icon />
                  <span>{item.label}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => signOut()}>
              <LogOut />
              <span>Cerrar Sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
