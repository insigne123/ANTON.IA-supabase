import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

type SettingsLinkRowProps = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  className?: string;
};

export function SettingsLinkRow({ href, icon: Icon, title, description, className }: SettingsLinkRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex min-h-24 items-center gap-4 rounded-[20px] px-4 py-4 transition-colors',
        'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background text-foreground shadow-sm">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold tracking-tight text-foreground">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
