import { notFound } from 'next/navigation';
import { AuthError } from '@/lib/server/auth-utils';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { CoworkWorkspace } from '@/components/cowork/CoworkWorkspace';
import '@/styles/cowork.css';

export const dynamic = 'force-dynamic';

export default async function CoworkPage() {
  try {
    const auth = await requireCoworkAccess();
    return <CoworkWorkspace key={`${auth.user.id}:${auth.organizationId}`} userId={auth.user.id} />;
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}
