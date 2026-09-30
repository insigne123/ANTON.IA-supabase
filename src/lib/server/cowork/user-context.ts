import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkUserContext } from '@/lib/cowork/decision-context';
import { profileOffer, profileOfferDetails, readOrganizationOffer } from '@/lib/server/suplia-context';

type Scope = { userId: string; organizationId: string };

const text = (value: unknown, max = 120) => typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null;
const items = (values: string[], count: number, max: number) =>
  values.map(value => text(value, max)).filter((value): value is string => Boolean(value)).slice(0, count);

/**
 * The person as «Perfil» stores them: name, role, company, and what they sell with its services,
 * the results they can show and their sector (`signatures.profile_extended`). The offer falls back
 * to the organization settings. Services, proof points and sector appear only when present, so a
 * turn without them reads exactly as before. Never the email signatures kept in the same column.
 */
export function coworkUserContextFromProfile(profile: Record<string, unknown> | null, organizationOffer: string | null = null): CoworkUserContext {
  const own = profileOffer(profile);
  const details = profileOfferDetails(profile);
  const services = items(details.services, 6, 120);
  const proofPoints = items(details.proofPoints, 4, 200);
  const sector = text(details.sector);
  return {
    fullName: text(profile?.full_name), jobTitle: text(profile?.job_title) || text(details.role),
    companyName: text(profile?.company_name), companyDomain: text(profile?.company_domain),
    offer: own || organizationOffer || null, offerSource: own ? 'profile' : organizationOffer ? 'organization' : null,
    ...(services.length ? { services } : {}),
    ...(proofPoints.length ? { proofPoints } : {}),
    ...(sector ? { sector } : {}),
  };
}

/** Read once per run, before the first decision, with the same offer rule as app.context (own
 * profile first, then the organization settings). Own profile only: no email, signatures or
 * tokens. Any failure returns null and the model falls back to profile.get and app.context. */
export async function loadCoworkUserContext(client: SupabaseClient, scope: Scope): Promise<CoworkUserContext | null> {
  try {
    const userId = z.string().uuid().parse(scope.userId);
    // select('*') like the shared app context: older offer fields differ between workspaces.
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) return null;
    const profile = (data as Record<string, unknown> | null) || null;
    if (profile && profile.id !== userId) return null;
    const organization = profileOffer(profile) ? null : await readOrganizationOffer(client, scope.organizationId);
    return coworkUserContextFromProfile(profile, organization);
  } catch {
    return null;
  }
}
