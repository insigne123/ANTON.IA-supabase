import { APOLLO_DISPLAY_TOTAL_CREDITS } from '@/lib/apollo-credit-costs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type UsageSnapshot = {
  scope_type?: unknown;
  provider_account_id?: unknown;
  provider_user_id?: unknown;
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

const STALE_AFTER_MS = 2 * 60 * 60 * 1_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function finiteNumber(...values: unknown[]) {
  for (const value of values) {
    if (value == null || String(value).trim() === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function timestamp(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized && Number.isFinite(Date.parse(normalized))) return normalized;
  }
  return null;
}

function snapshotCreditFields(snapshot: UsageSnapshot) {
  const usage = record(snapshot.usage);
  const creditUsage = record(usage.creditUsage);
  const leadCredit = record(creditUsage.lead_credit ?? creditUsage.leadCredit);
  const profileUsage = record(usage.profileCreditUsage);
  const creditFields = record(usage.creditFields ?? profileUsage.credit_fields ?? profileUsage.creditFields);

  const remaining = finiteNumber(
    leadCredit.left_over,
    leadCredit.remaining,
    creditUsage.credits_remaining,
    creditUsage.credit_remaining,
    creditUsage.remaining,
    creditFields.num_credits_remaining,
    creditFields.credits_remaining,
    profileUsage.num_credits_remaining,
    profileUsage.credits_remaining,
  );
  const used = finiteNumber(
    leadCredit.consumed,
    leadCredit.used,
    creditUsage.credits_used,
    creditUsage.credit_used,
    creditUsage.used,
    creditFields.num_credits_used,
    profileUsage.credits_used,
  );
  const providerLimit = finiteNumber(
    leadCredit.limit,
    creditUsage.credits_limit,
    creditUsage.credit_limit,
    creditUsage.limit,
    creditFields.effective_num_lead_credits,
    creditFields.num_lead_credits,
    profileUsage.effective_num_lead_credits,
    profileUsage.num_lead_credits,
  );
  const cycleEnd = timestamp(
    snapshot.cycle_end,
    leadCredit.cycle_end,
    creditUsage.cycle_end,
    creditFields.cycle_end,
    profileUsage.cycle_end,
  );

  return { remaining, used, providerLimit, cycleEnd };
}

function byNewestCapture(left: UsageSnapshot, right: UsageSnapshot) {
  return Date.parse(String(right.captured_at || '')) - Date.parse(String(left.captured_at || ''));
}

export function parseApolloCreditBalance(
  snapshots: UsageSnapshot[],
  expectedAccountId?: string | null,
): ApolloCreditBalance | null {
  const ordered = [...snapshots].sort(byNewestCapture);
  const selectedAccountId = text(expectedAccountId)
    || ordered.map((snapshot) => text(snapshot.provider_account_id)).find(Boolean)
    || null;
  const accountSnapshots = selectedAccountId
    ? ordered.filter((snapshot) => text(snapshot.provider_account_id) === selectedAccountId)
    : ordered.filter((snapshot) => !text(snapshot.provider_account_id));

  for (const scope of ['team', 'user']) {
    for (const snapshot of accountSnapshots.filter((item) => String(item.scope_type || '') === scope)) {
      const capturedAt = timestamp(snapshot.captured_at);
      if (!capturedAt) continue;

      const fields = snapshotCreditFields(snapshot);
      if (fields.remaining === null && fields.used === null) continue;
      if (fields.providerLimit === null && fields.remaining === null) continue;

      const visibleRemaining = fields.remaining === null
        ? Math.max(0, APOLLO_DISPLAY_TOTAL_CREDITS - Math.min(fields.used || 0, APOLLO_DISPLAY_TOTAL_CREDITS))
        : Math.min(fields.remaining, APOLLO_DISPLAY_TOTAL_CREDITS);

      return {
        remaining: visibleRemaining,
        used: APOLLO_DISPLAY_TOTAL_CREDITS - visibleRemaining,
        limit: APOLLO_DISPLAY_TOTAL_CREDITS,
        cycleEnd: fields.cycleEnd,
        capturedAt,
      };
    }
  }

  return null;
}

export function isApolloCreditBalanceStale(
  balance: Pick<ApolloCreditBalance, 'capturedAt'>,
  now = Date.now(),
) {
  return now - Date.parse(balance.capturedAt) > STALE_AFTER_MS;
}

export async function loadLatestApolloCreditBalance(admin: any = getSupabaseAdminClient()) {
  const expectedAccountId = text(process.env.APOLLO_SHARED_ACCOUNT_ID);
  let query = admin
    .from('antonia_provider_usage_snapshots')
    .select('scope_type, provider_account_id, provider_user_id, usage, cycle_end, captured_at')
    .eq('provider', 'apollo')
    .in('scope_type', ['team', 'user'])
    .order('captured_at', { ascending: false })
    .limit(50);
  if (expectedAccountId) query = query.eq('provider_account_id', expectedAccountId);

  const { data, error } = await query;
  if (error) throw error;
  return parseApolloCreditBalance(data || [], expectedAccountId);
}
