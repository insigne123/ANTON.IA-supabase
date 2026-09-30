import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkUserContext } from '@/lib/cowork/decision-context';
import { memoryValueText, profileOffer } from '@/lib/server/suplia-context';
import { readOrganizationOffer } from './extended-reads';

type Scope = { userId: string; organizationId: string };

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
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

/** Read once per run, before the first decision: the person's name, role,
 * company, offer and approved memories, with the same offer rule as app.context (own profile
 * first, then the organization settings). Own profile only: no email,
 * signatures or tokens. Any failure returns null and the model falls back to
 * profile.get and app.context, as before. */
export async function loadCoworkUserContext(client: SupabaseClient, scope: Scope, options: { memories?: boolean } = {}): Promise<CoworkUserContext | null> {
  try {
    const userId = z.string().uuid().parse(scope.userId);
    // select('*') like the shared app context: offer fields differ between workspaces.
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) return null;
    const profile = (data as Record<string, unknown> | null) || null;
    if (profile && profile.id !== userId) return null;
    const own = profileOffer(profile);
    const [organization, memories] = await Promise.all([
      own ? null : readOrganizationOffer(client, scope.organizationId),
      options.memories === false ? [] : loadCoworkMemories(client, { userId, organizationId: scope.organizationId }),
    ]);
    return {
      fullName: text(profile?.full_name), jobTitle: text(profile?.job_title),
      companyName: text(profile?.company_name), companyDomain: text(profile?.company_domain),
      offer: own || organization || null, offerSource: own ? 'profile' : organization ? 'organization' : null,
      // Only when there are some, so a turn without memories reads exactly as before (plan 2, V7).
      ...(memories.length ? { memories } : {}),
    };
  } catch {
    return null;
  }
}
