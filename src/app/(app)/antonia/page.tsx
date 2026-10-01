import { redirect } from 'next/navigation';
import { requireCoworkAccess } from '@/lib/server/cowork/access';

export const dynamic = 'force-dynamic';

/** The mission agent was retired (docs/retiro-agente-antonia.md): its work now lives in Cowork. Old links and bookmarks land
 * in Cowork for whoever has it, and on the dashboard for everyone else. */
export default async function RetiredAgentPage() {
  let hasCowork = false;
  try {
    await requireCoworkAccess();
    hasCowork = true;
  } catch {
    hasCowork = false;
  }
  redirect(hasCowork ? '/cowork' : '/dashboard');
}
