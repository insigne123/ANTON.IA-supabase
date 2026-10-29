import type { AlertProvider, Balance } from '@/lib/server/provider-alerts';

/**
 * For the services' own clients (OpenAI, Claude, Serper, Resend, Reoon, JSearch): passes what they saw to provider-alerts.ts
 * without ever delaying or breaking the call that saw it. Loaded only when there is something to tell, so the clients do
 * not carry the database and the mail code. Off in tests, with PROVIDER_ALERTS=off, and for ten minutes after the same
 * outage was passed by this process.
 */
const recent = new Map<string, number>();
const QUIET_MS = 10 * 60_000;

const enabled = () => process.env.NODE_ENV !== 'test' && process.env.PROVIDER_ALERTS !== 'off';

function quiet(key: string) {
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - QUIET_MS) return true;
  recent.set(key, now);
  return false;
}

export function signalProviderOutage(provider: AlertProvider, level: 'empty' | 'refused', detail: string) {
  if (!enabled() || quiet(`${provider}:${level}`)) return;
  void (async () => {
    const [{ reportProviderOutage }, { getSupabaseAdminClient }] = await Promise.all([import('@/lib/server/provider-alerts'), import('@/lib/server/supabase-admin')]);
    await reportProviderOutage(getSupabaseAdminClient(), provider, level, detail);
  })().catch(() => {});
}

export function signalProviderBalance(provider: AlertProvider, balance: Balance) {
  if (!enabled()) return;
  void (async () => {
    const [{ checkProviderBalance }, { getSupabaseAdminClient }] = await Promise.all([import('@/lib/server/provider-alerts'), import('@/lib/server/supabase-admin')]);
    await checkProviderBalance(getSupabaseAdminClient(), provider, balance);
  })().catch(() => {});
}
