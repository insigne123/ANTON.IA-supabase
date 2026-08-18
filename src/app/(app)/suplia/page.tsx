import { SupliaWorkspace } from '@/components/suplia/SupliaWorkspace';
import { isSupliaEnabled } from '@/lib/suplia/access';
import { notFound } from 'next/navigation';

export default function SupliaPage() {
  if (!isSupliaEnabled()) notFound();

  return <SupliaWorkspace />;
}
