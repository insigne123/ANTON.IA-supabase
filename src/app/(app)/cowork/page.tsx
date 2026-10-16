import { notFound, redirect } from 'next/navigation';
import { AuthError } from '@/lib/server/auth-utils';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { CoworkWorkspace } from '@/components/cowork/CoworkWorkspace';
import '@/styles/cowork.css';

export const dynamic = 'force-dynamic';

export default async function CoworkPage() {
  try {
    const auth = await requireCoworkAccess();
    return <CoworkWorkspace key={`${auth.user.id}:${auth.organizationId}`} userId={auth.user.id} organizationId={auth.organizationId} />;
  } catch (error) {
    // A session that ended (revoked or expired) signs in again and comes back; any other refusal is a page that does not exist.
    if (error instanceof AuthError) { if (error.status === 401) redirect('/login?next=%2Fcowork'); notFound(); }
    throw error;
  }
}
