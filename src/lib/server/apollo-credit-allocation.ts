import { apolloAllocationRefusal, type ApolloCreditAllocation } from '@/lib/apollo-credit-allocation';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

/** A lookup refused because it does not fit in the organization's Apollo share (or the share could not be read). */
export class ApolloAllocationRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApolloAllocationRefusal';
  }
}

// Before the migration is applied the function does not exist yet: then no organization has an allocation.
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

/** The organization's open allocation and what is left of it, or null when it has none. */
export async function loadApolloCreditAllocation(
  organizationId: string,
  admin: any = getSupabaseAdminClient(),
): Promise<ApolloCreditAllocation | null> {
  const { data, error } = await admin.rpc('apollo_credit_allocation_status_v1', { p_organization_id: organizationId });
  if (error) {
    if (MISSING_FUNCTION.has(String(error.code || ''))) return null;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.credits == null) return null;
  return {
    credits: number(row.credits),
    used: number(row.used),
    remaining: number(row.remaining),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    note: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null,
    usedBefore: number(row.used_before),
    showLimit: row.show_limit !== false,
  };
}

/**
 * Refuses, before any credit is claimed or Apollo is asked, the lookups that do not fit in the organization's share. Credits
 * cost money: when the share cannot be read, nothing is asked either.
 */
export async function assertApolloAllocationAllows(
  organizationId: string,
  needed: number,
  load: (organizationId: string) => Promise<ApolloCreditAllocation | null> = (id) => loadApolloCreditAllocation(id),
) {
  if (needed <= 0) return null;
  let allocation: ApolloCreditAllocation | null;
  try {
    allocation = await load(organizationId);
  } catch {
    throw new ApolloAllocationRefusal('No pudimos comprobar los créditos de Apollo de tu organización. No se pidió nada; intenta de nuevo en un momento.');
  }
  const refusal = apolloAllocationRefusal(allocation, needed);
  if (refusal) throw new ApolloAllocationRefusal(refusal);
  return allocation;
}
