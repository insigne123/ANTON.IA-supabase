import type { SupabaseClient } from '@supabase/supabase-js';
import { hasConfirmedEmail, isOpportunitiesUserAllowed, type OpportunitiesIdentity } from '@/lib/commercial-opportunities/access';

/**
 * Who may open «Oportunidades» beyond OPPORTUNITIES_ALLOWED_EMAILS (Plan 15): the members an owner or admin let in from
 * «Administración › Personas», one row per organization and person in commercial_opportunity_members. Only the service
 * client reads it; nothing here imports the request context, so the worker, the daily search and the tests use it too.
 */
const MEMBERS = 'commercial_opportunity_members';

/**
 * The members an owner or admin let into «Oportunidades» in one organization (Plan 15), by user id. Any failure, the table
 * missing included (before its migration), reads as nobody: the accounts of OPPORTUNITIES_ALLOWED_EMAILS keep their access.
 */
export async function opportunitiesGrantedUserIds(client: SupabaseClient, organizationId: string): Promise<Set<string>> {
  try {
    const { data, error } = await client.from(MEMBERS).select('user_id').eq('organization_id', organizationId).limit(1000);
    return error ? new Set() : new Set(((data || []) as Array<{ user_id: string }>).map(row => row.user_id));
  } catch {
    return new Set();
  }
}

/** Whether the members table can be read: the admin panel shows the access switches only then. */
export async function opportunitiesGrantsAvailable(client: SupabaseClient) {
  try {
    const { error } = await client.from(MEMBERS).select('user_id', { head: true, count: 'exact' }).limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Who may open «Oportunidades» in an organization: a confirmed account of OPPORTUNITIES_ALLOWED_EMAILS (in any of its
 * organizations, as before), or a confirmed member an owner or admin of that organization let in. Any doubt is a no.
 */
export async function canUseOpportunities(client: SupabaseClient, user: (OpportunitiesIdentity & { id?: string | null }) | null | undefined,
  organizationId: string | null | undefined, configured = process.env.OPPORTUNITIES_ALLOWED_EMAILS) {
  if (isOpportunitiesUserAllowed(user, configured)) return true;
  if (!user?.id || !organizationId || !hasConfirmedEmail(user)) return false;
  try {
    const { data, error } = await client.from(MEMBERS).select('user_id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}


/** Gives or takes away one member's access. The caller already checked that whoever asks is an owner or admin there. */
export async function setOpportunitiesGrant(client: SupabaseClient, input: { organizationId: string; userId: string; grantedBy: string; enabled: boolean }) {
  const { error } = input.enabled
    ? await client.from(MEMBERS).upsert({ organization_id: input.organizationId, user_id: input.userId, granted_by: input.grantedBy },
      { onConflict: 'organization_id,user_id', ignoreDuplicates: true })
    : await client.from(MEMBERS).delete().eq('organization_id', input.organizationId).eq('user_id', input.userId);
  if (error) {
    console.error('[commercial-opportunities] grant:', error);
    throw new Error('No se pudo cambiar el acceso a Oportunidades.');
  }
}
