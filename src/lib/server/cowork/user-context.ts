import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkUserContext } from '@/lib/cowork/decision-context';
import { profileOffer } from '@/lib/server/suplia-context';
import { readOrganizationOffer } from './extended-reads';

type Scope = { userId: string; organizationId: string };

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : null;

/** Read once per run, before the first decision: the person's name, role,
 * company and offer, with the same offer rule as app.context (own profile
 * first, then the organization settings). Own profile only: no email,
 * signatures or tokens. Any failure returns null and the model falls back to
 * profile.get and app.context, as before. */
export async function loadCoworkUserContext(client: SupabaseClient, scope: Scope): Promise<CoworkUserContext | null> {
  try {
    const userId = z.string().uuid().parse(scope.userId);
    // select('*') like the shared app context: offer fields differ between workspaces.
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) return null;
    const profile = (data as Record<string, unknown> | null) || null;
    if (profile && profile.id !== userId) return null;
    const own = profileOffer(profile);
    const organization = own ? null : await readOrganizationOffer(client, scope.organizationId);
    return {
      fullName: text(profile?.full_name), jobTitle: text(profile?.job_title),
      companyName: text(profile?.company_name), companyDomain: text(profile?.company_domain),
      offer: own || organization || null, offerSource: own ? 'profile' : organization ? 'organization' : null,
    };
  } catch {
    return null;
  }
}
