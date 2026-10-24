'use client';

import { useLinkStatus } from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Inside a menu link: a small spinner while its screen loads (APP-18), so the click is answered before the server is. Hidden
 * from screen readers: the screen's own loading state says it.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={cn('ml-auto size-3 shrink-0 rounded-full border-2 border-current border-t-transparent opacity-0 transition-opacity group-data-[collapsible=icon]:hidden',
    pending && 'animate-spin opacity-60 motion-reduce:animate-none', className)} />;
}
