import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { isOpportunitiesEnabled } from '@/lib/opportunities/access';

export default function SavedOpportunitiesLayout({ children }: { children: ReactNode }) {
  if (!isOpportunitiesEnabled()) notFound();

  return children;
}
