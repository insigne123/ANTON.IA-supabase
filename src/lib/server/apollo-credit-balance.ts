import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

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
    const limit = finiteNumber(leadCredit.limit);
    const consumed = finiteNumber(leadCredit.consumed);
    const capturedAt = timestamp(team.captured_at);
    if (remaining !== null && limit !== null && capturedAt) {
      return {
        remaining: Math.min(remaining, limit),
        used: Math.min(consumed ?? Math.max(0, limit - remaining), limit),
        limit,
        cycleEnd: timestamp(team.cycle_end),
        capturedAt,
      };
    }
  }

  for (const user of snapshots.filter((snapshot) => String(snapshot.scope_type || '') === 'user')) {
    const creditFields = record(record(user.usage).creditFields);
    const remaining = finiteNumber(creditFields.num_credits_remaining);
    const limit = finiteNumber(creditFields.effective_num_lead_credits ?? creditFields.num_lead_credits);
    const capturedAt = timestamp(user.captured_at);
    if (remaining !== null && limit !== null && capturedAt) {
      return {
        remaining: Math.min(remaining, limit),
        used: Math.max(0, limit - remaining),
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
