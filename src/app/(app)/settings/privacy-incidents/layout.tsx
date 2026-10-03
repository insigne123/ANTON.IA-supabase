import type { ReactNode } from 'react';

import { requirePrivacyAdminPage } from '@/lib/server/privacy-admin-page';

export const dynamic = 'force-dynamic';

export default async function PrivacyAdminLayout({ children }: { children: ReactNode }) {
  await requirePrivacyAdminPage();
  return children;
}
