import { notFound } from 'next/navigation';
import { AuthError } from '@/lib/server/auth-utils';
import { requireOpportunitiesUser } from '@/lib/server/commercial-opportunities/access';
import { OpportunitiesWorkspace } from '@/components/commercial-opportunities/OpportunitiesWorkspace';

export const dynamic = 'force-dynamic';

/** «Oportunidades» (plan 8, phase 3): only the accounts in OPPORTUNITIES_ALLOWED_EMAILS; any other gets a 404. */
export default async function OpportunitiesPage() {
  try {
    const auth = await requireOpportunitiesUser();
    return <OpportunitiesWorkspace key={`${auth.user.id}:${auth.organizationId}`} />;
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}
