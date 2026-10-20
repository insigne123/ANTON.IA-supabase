'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { companyInitials } from '@/lib/companies/coverage';

const SIZES = { md: 'h-10 w-10 rounded-xl', lg: 'h-14 w-14 rounded-2xl' } as const;
const INNER = { md: 'h-6 w-6', lg: 'h-9 w-9' } as const;

/**
 * A company's logo from its web domain (the icon its own site publishes, as Google's favicon service serves it), on a
 * white tile so it reads in both themes. Without a domain, or when the site has only the default globe (16 px), its
 * initials. Only the company's public domain leaves the browser, never a person's name.
 */
export function CompanyLogo({ name, domain, size = 'md', className }: { name: string; domain?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = Boolean(domain) && failed !== domain;
  return (
    <span aria-hidden="true" className={cn('relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden ring-1 ring-border',
      SIZES[size], showLogo ? 'bg-white' : 'bg-muted text-foreground/70', className)}>
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain!)}&sz=128`} alt="" loading="lazy" referrerPolicy="no-referrer"
          className={cn('object-contain', INNER[size])} onError={() => setFailed(domain!)}
          onLoad={event => { if (event.currentTarget.naturalWidth < 32) setFailed(domain!); }} />
      ) : <span className={cn('font-semibold', size === 'lg' ? 'text-base' : 'text-xs')}>{companyInitials(name)}</span>}
    </span>
  );
}
