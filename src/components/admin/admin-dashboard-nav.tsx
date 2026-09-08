'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Coins, LayoutDashboard, Users, UsersRound } from 'lucide-react';

import { cn } from '@/lib/utils';

const adminNavigation = [
  { href: '/dashboard/admin', label: 'Resumen', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/admin/users', label: 'Personas', icon: Users },
  { href: '/dashboard/admin/teams', label: 'Equipos', icon: UsersRound },
  { href: '/dashboard/admin/credits', label: 'Créditos', icon: Coins },
];

export function AdminDashboardNav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-12 z-[8] -mx-4 -mt-4 mb-6 border-b border-border/60 bg-background/90 px-4 backdrop-blur-xl md:-mx-6 md:-mt-5 md:px-6">
      <nav aria-label="Administración" className="mx-auto flex w-full max-w-[1320px] gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {adminNavigation.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-2.5 text-[13px] font-medium text-muted-foreground transition-colors sm:px-3.5 sm:text-sm',
                'hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active && 'bg-muted/70 text-foreground',
              )}
            >
              <Icon className={cn('hidden h-4 w-4 sm:block', active && 'text-primary')} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
