import type { SupabaseClient } from '@supabase/supabase-js';
import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';

type Scope = { userId: string; organizationId: string };

/**
 * Whether the owner of a Cowork run can open «Oportunidades» in the run's organization: the same rule as the page
 * (OPPORTUNITIES_ALLOWED_EMAILS, or a member an admin let in, with a confirmed email), read from the auth record with the
 * worker's service client. Cowork does not read the section (owner's decision, 24 oct 2026: it has its own assistant and a chat
 * in each opportunity); this only decides whether the answer offers the link to it. Any doubt is a no.
 */
export async function coworkOpportunitiesSection(client: SupabaseClient, scope: Scope, configured = process.env.OPPORTUNITIES_ALLOWED_EMAILS) {
  try {
    const { data, error } = await client.auth.admin.getUserById(scope.userId);
    return Boolean(!error && data?.user && await canUseOpportunities(client, data.user, scope.organizationId, configured));
  } catch {
    return false;
  }
}
