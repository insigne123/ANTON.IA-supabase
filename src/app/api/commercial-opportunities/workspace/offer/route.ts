import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';
/**
 * The offer the workspace admins confirmed, so «Perfil» can propose it to anyone who sells it. Only the text a seller
 * repeats: never the criteria, budget or schedule, which stay with the admins (workspace-store.ts).
 */
export async function GET() {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const row = opportunityDb(await auth.admin.from('opportunity_company_context').select('offer,services,territories')
      .eq('organization_id', scope.organizationId).maybeSingle());
    return opportunitiesJson({ offer: row ? { offer: row.offer, services: row.services || [], territories: row.territories || [] } : null });
  } catch (error) { return opportunitiesError(error); }
}
