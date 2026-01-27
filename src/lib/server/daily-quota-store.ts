import { createClient } from '@supabase/supabase-js';

// Use a service role client for reliable quota updates (bypassing RLS if needed for atomic increments)
// or standard client if we trust RLS. For atomic increments via RPC + security definer, service role is safest or
// standard client if the user has execute permission. 
// However, here we are in a library that might be called by API routes.
// Let's assume we pass the supabase client or use a global admin one.
// Since 'daily-quota-store' is server-side only, we can instantiate a service-role client.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type DailyQuotaResult = {
  allowed: boolean;
  count: number;
  limit: number;
  dayKey: string;
  resetAtISO: string;
};

// Map 'resource' string to database column name
const RESOURCE_TO_COLUMN: Record<string, string> = {
  'leadSearch': 'leads_searched',
  'enrich': 'leads_enriched',
  'research': 'leads_investigated', // legacy mapping
  'contact': 'contacted_leads',     // Note: contact is special, might check another table? 
  // For now, let's assume we track contacts in usage table too.
  // But 'checkAndConsume' logic implies we increment usage table.
  // Let's assume there is a 'leads_contacted' or similar?
  // Looking at 'antonia_daily_usage' columns from 'create_atomic_quota_function.sql':
  // leads_searched, search_runs, leads_enriched, leads_investigated. 
  // NO 'contacts' column in usage table?
  // Wait, 'contacted_leads' is a separate table.
  // For simplicity and unification, we should probably add 'leads_contacted' to usage table 
  // or handle 'contact' resource differently (query count).
  // Given the 'quota/route.ts' counts from 'contacted_leads' table directly, 
  // consuming 'contact' quota here strictly updates the Usage Table or just checks?
  // If we want to unify, let's treat 'contact' as 'leads_contacted' (if it existed) 
  // OR just return "allowed" based on limits without incrementing if we rely on DB inserts elsewhere.
  // BUT, 'leads/route.ts' calls 'checkAndConsume'.
  // We'll stick to 'leads_searched' etc.
  // If unknown resource, we might error or fallback.
};

function todayKeyUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextDayStartISOUTC(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toISOString();
}

/**
 * Checks and consumes daily quota using Supabase.
 * Now requires organizationId instead of just userId for the DB lookup.
 * Backward compatibility: If userId is passed, we must resolve orgId.
 */
export async function checkAndConsumeDailyQuota(
  params: { userId: string; organizationId?: string; resource: string; limit: number; count?: number }
): Promise<DailyQuotaResult> {
  const { userId, resource, limit, count = 1 } = params;
  let organizationId = params.organizationId;

  if (!organizationId) {
    // Resolve organization from user if not provided (slower)
    const { data, error } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!data) throw new Error(`User ${userId} has no organization for quota`);
    organizationId = data.organization_id;
  }

  const date = todayKeyUTC();

  // Decide which column to increment
  let col = RESOURCE_TO_COLUMN[resource];

  // Special handling for 'contact' if column doesn't exist in usage table
  // The RPC `increment_daily_usage` supports: p_leads_searched, p_search_runs, p_leads_enriched, p_leads_investigated.
  // It does NOT support contacts. 
  // Warning: If resource is 'contact', we currently can't track it in `antonia_daily_usage` via this RPC.
  // However, `contacted_leads` table is the source of truth for contacts.
  // So 'consuming' contact quota might just mean "Check if we are over limit" and rely on the caller to insert into contacted_leads?
  // OR we can add a column. For now, let's map 'contact' to a no-op increment or fail safe.
  // Actually, leads/route.ts calls this for 'contact' resource. 
  // Recommendation: Add `leads_contacted` to `antonia_daily_usage` and RPC.
  // For now, I will map it to `leads_searched` just to not break compiling, but COMMENTED OUT and throwing error or handling gracefully?
  // Better approach: If resource is 'contact', check limits against `contacted_leads` table count.

  if (resource === 'contact') {
    // Validar contra tabla real de contactos
    const { count: currentCount, error } = await supabaseAdmin
      .from('contacted_leads')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('created_at', `${date}T00:00:00Z`); // Start of today UTC

    const used = currentCount || 0;
    if (used + count > limit) {
      return { allowed: false, count: used, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
    }

    // We don't "increment" a counter table for contacts, we assume the caller will insert a row in contacted_leads.
    // So we return allowed.
    return { allowed: true, count: used + count, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
  }

  if (!col) {
    // Fallback or error?
    // Maybe 'search' -> 'leads_searched'?
    if (resource === 'search') col = 'search_runs';
    else throw new Error(`Unknown quota resource: ${resource}`);
  }

  // Prepare RPC params
  const rpcParams: any = {
    p_organization_id: organizationId,
    p_date: date
  };

  // Dynamic param based on resource
  // p_leads_searched, p_search_runs, etc.
  if (col === 'leads_searched') rpcParams.p_leads_searched = count;
  if (col === 'leads_enriched') rpcParams.p_leads_enriched = count;
  if (col === 'leads_investigated') rpcParams.p_leads_investigated = count;
  if (col === 'search_runs') rpcParams.p_search_runs = count;

  try {
    // First, CHECK current usage (optimistic check) to avoid RPC overhead if already blocked?
    // OR rely on RPC to fail/return? The current RPC `increment_daily_usage` just increments, it doesn't check limit.
    // So we must READ first.

    const { data: usage } = await supabaseAdmin
      .from('antonia_daily_usage')
      .select(col)
      .eq('organization_id', organizationId)
      .eq('date', date)
      .maybeSingle();

    const current = usage ? (usage as any)[col] || 0 : 0;

    if (current + count > limit) {
      return { allowed: false, count: current, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
    }

    // Execute Increment
    const { error: rpcError } = await supabaseAdmin.rpc('increment_daily_usage', rpcParams);

    if (rpcError) {
      console.error('Quota RPC error:', rpcError);
      // Fail open or closed? Fail closed for safety.
      throw rpcError;
    }

    return { allowed: true, count: current + count, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };

  } catch (err) {
    console.error('Quota check failed:', err);
    return { allowed: false, count: -1, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
  }
}

export async function getDailyQuotaStatus(
  params: { userId: string; organizationId?: string; resource: string; limit: number }
): Promise<DailyQuotaResult> {
  // Similar to above but read-only
  const { userId, resource, limit } = params;
  let organizationId = params.organizationId;

  if (!organizationId) {
    const { data } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (!data) return { allowed: false, count: 0, limit, dayKey: todayKeyUTC(), resetAtISO: nextDayStartISOUTC() };
    organizationId = data.organization_id;
  }

  const date = todayKeyUTC();

  if (resource === 'contact') {
    const { count: currentCount } = await supabaseAdmin
      .from('contacted_leads')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('created_at', `${date}T00:00:00Z`);
    const used = currentCount || 0;
    return { allowed: used < limit, count: used, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
  }

  let col = RESOURCE_TO_COLUMN[resource];
  if (resource === 'search') col = 'search_runs';

  if (!col) return { allowed: false, count: 0, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };

  const { data: usage } = await supabaseAdmin
    .from('antonia_daily_usage')
    .select(col)
    .eq('organization_id', organizationId)
    .eq('date', date)
    .maybeSingle();

  const val = usage ? (usage as any)[col] || 0 : 0;

  return {
    allowed: val < limit,
    count: val,
    limit,
    dayKey: date,
    resetAtISO: nextDayStartISOUTC()
  };
}

export const tryConsumeDailyQuota = checkAndConsumeDailyQuota;
export const ensureDailyQuota = checkAndConsumeDailyQuota;
export const canConsumeDailyQuota = getDailyQuotaStatus;
