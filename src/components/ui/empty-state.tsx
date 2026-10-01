import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** The one next step: usually a single button or link. */
  action?: ReactNode;
  /** Heading level for the title, so the empty state fits the page outline. */
  headingLevel?: 'h2' | 'h3' | 'p';
  className?: string;
};

/** An empty list that says why it is empty and what to do next, with one action (AGENTS.md, empty states). */
export function EmptyState({ icon: Icon, title, description, action, headingLevel = 'h2', className }: EmptyStateProps) {
  const Title = headingLevel;
  return (
    <div className={cn('mx-auto flex max-w-md flex-col items-center px-4 py-8 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <Title className="mt-4 text-sm font-semibold text-foreground">{title}</Title>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
