import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

const AI_ASSIST_DAILY_LIMIT = Number(process.env.BULK_AI_ASSIST_DAILY_LIMIT || 50);

/** Shared daily budget for campaign AI assists (audience rank + message proposals). */
export async function consumeAssistBudget(organizationId: string, userId: string) {
  const { data, error } = await getSupabaseAdminClient().rpc('consume_bulk_ai_assist_v1', {
    p_organization_id: organizationId, p_user_id: userId,
    p_day: new Date().toISOString().slice(0, 10), p_limit: AI_ASSIST_DAILY_LIMIT,
  });
  if (error) {
    // Budgets require the profiles/budgets migration; without it assist stays available and flagged in docs.
    if (['42P01', '42p01', 'PGRST205', 'PGRST202'].includes((error as { code?: string }).code || '')) return;
    throw error;
  }
  if (typeof data === 'number' && data < 0) {
    throw Object.assign(new Error('Alcanzaste el límite diario de ayuda IA. Inténtalo mañana.'), { status: 429 });
  }
}
