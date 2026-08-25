import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { APOLLO_DISPLAY_TOTAL_CREDITS } from '@/lib/apollo-credit-costs';

type UsageSnapshot = {
  scope_type?: unknown;
  usage?: unknown;
  cycle_end?: unknown;
  captured_at?: unknown;
};

export type ApolloCreditBalance = {
  remaining: number;
  used: number;
  limit: number;
  cycleEnd: string | null;
  capturedAt: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

export function parseApolloCreditBalance(snapshots: UsageSnapshot[]): ApolloCreditBalance | null {
  for (const team of snapshots.filter((snapshot) => String(snapshot.scope_type || '') === 'team')) {
    const usage = record(team.usage);
    const leadCredit = record(record(usage.creditUsage).lead_credit);
    const remaining = finiteNumber(leadCredit.left_over);
    const providerLimit = finiteNumber(leadCredit.limit);
    const capturedAt = timestamp(team.captured_at);
    if (remaining !== null && providerLimit !== null && capturedAt) {
      // Apollo's provider limit includes the purchased add-on. The product counter
      // intentionally shows the contracted 2,500-credit pool for this workspace.
      const limit = APOLLO_DISPLAY_TOTAL_CREDITS;
      const visibleRemaining = Math.min(remaining, limit);
      return {
        remaining: visibleRemaining,
        used: limit - visibleRemaining,
        limit,
        cycleEnd: timestamp(team.cycle_end),
        capturedAt,
      };
    }
  }

  for (const user of snapshots.filter((snapshot) => String(snapshot.scope_type || '') === 'user')) {
    const creditFields = record(record(user.usage).creditFields);
    const remaining = finiteNumber(creditFields.num_credits_remaining);
    const providerLimit = finiteNumber(creditFields.effective_num_lead_credits ?? creditFields.num_lead_credits);
    const capturedAt = timestamp(user.captured_at);
    if (remaining !== null && providerLimit !== null && capturedAt) {
      const limit = APOLLO_DISPLAY_TOTAL_CREDITS;
      const visibleRemaining = Math.min(remaining, limit);
      return {
        remaining: visibleRemaining,
        used: limit - visibleRemaining,
        limit,
        cycleEnd: timestamp(user.cycle_end),
        capturedAt,
      };
    }
  }
  return null;
}

export async function loadLatestApolloCreditBalance(admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin
    .from('antonia_provider_usage_snapshots')
    .select('scope_type, usage, cycle_end, captured_at')
    .eq('provider', 'apollo')
    .in('scope_type', ['team', 'user'])
    .order('captured_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return parseApolloCreditBalance(data || []);
}
