import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkUserContext } from '@/lib/cowork/decision-context';
import { readCompanyFields } from '@/lib/server/company-profile';
import type { DropSeller } from '@/lib/server/lead-drop-writer';

/**
 * What the writer of one person's emails (lead-drop-writer.ts) knows of whoever sells, for a recommended contact and for each
 * recipient of a campaign: what Cowork knows, plus the customers the profile says
 * may be named and the problems it says it solves, which Cowork's context does not carry.
 */
export async function dropSellerOf(client: SupabaseClient, scope: { organizationId: string; userId: string }, context: CoworkUserContext | null): Promise<DropSeller | null> {
  if (!context) return null;
  const [company, profile]: any[] = await Promise.all([
    readCompanyFields(client, scope.organizationId).catch(() => null),
    Promise.resolve(client.from('profiles').select('signatures').eq('id', scope.userId).maybeSingle()).catch(() => null),
  ]);
  const own = (profile?.data?.signatures?.profile_extended ?? {}) as Record<string, unknown>;
  const lines = (value: unknown, by: RegExp) => String(value || '').split(by).map(entry => entry.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6);
  return {
    fullName: context.fullName, jobTitle: context.jobTitle, companyName: context.companyName, offer: context.offer, sector: context.sector,
    services: context.services, proofPoints: context.proofPoints, differentiators: context.differentiators,
    referenceClients: lines(company?.referenceClients || own.referenceClients, /\n|;|,/), painPoints: lines(company?.painPoints || own.painPoints, /\n|;/),
    inOwnWords: context.idealCustomer?.inOwnWords ?? null, teamInOwnWords: context.idealCustomer?.teamInOwnWords ?? null,
  };
}
