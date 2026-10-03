import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const WIDTHS = { narrow: 'max-w-3xl', default: 'max-w-[1500px]', wide: 'max-w-[1680px]' } as const;

/** The column every page sits in: one width per kind of page and the same spacing below the header. */
export function PageContainer({ children, width = 'default', className }: { children: ReactNode; width?: keyof typeof WIDTHS; className?: string }) {
  return <div className={cn('mx-auto w-full min-w-0 space-y-6 pb-16', WIDTHS[width], className)}>{children}</div>;
}
