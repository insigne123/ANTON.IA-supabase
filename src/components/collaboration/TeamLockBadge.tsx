'use client';

import { Bookmark, MessageSquareWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import { teamLockNotice, type TeamLock } from '@/lib/team-lock';

/** «En conversación con Ana» / «Contactado por Ana · libre desde el 3 nov», only when someone else in the team holds the contact.
 * «Guardado por Ana» is a notice, not a lock: it reads in the quiet tone and with its own icon. */
export function TeamLockBadge({ lock, className }: { lock: TeamLock | null | undefined; className?: string }) {
  const notice = teamLockNotice(lock);
  if (!notice) return null;
  const Icon = notice.blocks ? MessageSquareWarning : Bookmark;
  return <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs',
    notice.blocks ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground', className)}>
    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span className="truncate" title={notice.text}>{notice.text}</span>
  </span>;
}
