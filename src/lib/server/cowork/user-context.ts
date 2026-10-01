import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkUserContext } from '@/lib/cowork/decision-context';
import { memoryValueText, profileOffer, profileOfferDetails, readOrganizationOffer } from '@/lib/server/suplia-context';

type Scope = { userId: string; organizationId: string };

const text = (value: unknown, max = 120) => typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null;
const items = (values: string[], count: number, max: number) =>
  values.map(value => text(value, max)).filter((value): value is string => Boolean(value)).slice(0, count);

/** Memories that reach the model at most, and how long each one can be. */
const MEMORIES = 8;
const MEMORY_LENGTH = 240;

/**
 * What the person approved for ANTON.IA to remember (suplia_memories, «approved»): the
 * organization's shared memories and their own, not a teammate's personal ones, and none
 * that expired. Newest first. Any failure leaves them out: the turn goes on without them.
 */
export async function loadCoworkMemories(client: SupabaseClient, scope: Scope, now = Date.now()): Promise<string[]> {
  try {
    const { data, error } = await client.from('suplia_memories').select('scope,user_id,memory_type,key,value,expires_at')
      .eq('organization_id', scope.organizationId).eq('status', 'approved')
      // Filter before LIMIT: newer personal memories from teammates must not hide this person's own or shared ones.
      .or(`scope.eq.organization,user_id.eq.${z.string().uuid().parse(scope.userId)}`)
      .order('updated_at', { ascending: false }).limit(MEMORIES * 3);
    if (error || !Array.isArray(data)) return [];
    const seen = new Set<string>();
    return (data as Array<{ scope?: string | null; user_id?: string | null; memory_type?: string | null; key?: string | null; value?: unknown; expires_at?: string | null }>)
      .filter(row => (row.scope === 'organization' || row.user_id === scope.userId) && !(row.expires_at && Date.parse(row.expires_at) <= now))
      .map(row => {
        const label = memoryValueText(row.key) || memoryValueText(row.memory_type);
        const body = memoryValueText(row.value);
        const line = body && label && !body.toLowerCase().startsWith(label.toLowerCase()) ? `${label}: ${body}` : body || label;
        return line.length > MEMORY_LENGTH ? `${line.slice(0, MEMORY_LENGTH - 1).trimEnd()}…` : line;
      })
      .filter(line => line && !seen.has(line) && Boolean(seen.add(line)))
      .slice(0, MEMORIES);
  } catch {
    return [];
  }
}

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
  const differentiators = items(details.differentiators || [], 4, 200);
  const roles = items(details.targetRoles || [], 6, 80);
  const industries = items(details.targetIndustries || [], 6, 80);
  return {
    fullName: text(profile?.full_name), jobTitle: text(profile?.job_title) || text(details.role),
    companyName: text(profile?.company_name), companyDomain: text(profile?.company_domain),
    offer: own || organizationOffer || null, offerSource: own ? 'profile' : organizationOffer ? 'organization' : null,
    ...(services.length ? { services } : {}),
    ...(proofPoints.length ? { proofPoints } : {}),
    ...(sector ? { sector } : {}),
    ...(differentiators.length ? { differentiators } : {}),
    ...(roles.length || industries.length
      ? { idealCustomer: { ...(roles.length ? { roles } : {}), ...(industries.length ? { industries } : {}) } }
      : {}),
  };
}

/** Read once per run, before the first decision: the person as «Perfil» stores them plus what they approved for ANTON.IA to
 * remember, with the same offer rule as app.context (own profile first, then the organization settings). Own profile only: no
 * email, signatures or tokens. Any failure returns null and the model falls back to profile.get and app.context. */
export async function loadCoworkUserContext(client: SupabaseClient, scope: Scope, options: { memories?: boolean } = {}): Promise<CoworkUserContext | null> {
  try {
    const userId = z.string().uuid().parse(scope.userId);
    // select('*') like the shared app context: older offer fields differ between workspaces.
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) return null;
    const profile = (data as Record<string, unknown> | null) || null;
    if (profile && profile.id !== userId) return null;
    const [organization, memories] = await Promise.all([
      profileOffer(profile) ? null : readOrganizationOffer(client, scope.organizationId),
      options.memories === false ? [] : loadCoworkMemories(client, { userId, organizationId: scope.organizationId }),
    ]);
    return {
      ...coworkUserContextFromProfile(profile, organization),
      // Only when there are some, so a turn without memories reads exactly as before (plan 2, V7).
      ...(memories.length ? { memories } : {}),
    };
  } catch {
    return null;
  }
}
