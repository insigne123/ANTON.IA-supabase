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

const AI_PERSONAL_DAILY_LIMIT = Number(process.env.BULK_AI_PERSONAL_DAILY_LIMIT || 600);

/**
 * The people a user may have campaign emails written for in a day (src/lib/server/campaign-personal.ts): each one is a call or two
 * to the model, so a campaign of a hundred fits several times and a loop does not become a bill. Apart from the assists' budget,
 * which a single campaign would otherwise use up.
 */
export async function consumePersonalBudget(organizationId: string, userId: string, people: number) {
  const { data, error } = await getSupabaseAdminClient().rpc('consume_bulk_ai_personal_v1', {
    p_organization_id: organizationId, p_user_id: userId,
    p_day: new Date().toISOString().slice(0, 10), p_amount: people, p_limit: AI_PERSONAL_DAILY_LIMIT,
  });
  if (error) {
    // Before its migration is applied the writing stays available, as the assists did.
    if (['42P01', '42p01', '42883', 'PGRST205', 'PGRST202'].includes((error as { code?: string }).code || '')) return;
    throw error;
  }
  if (typeof data === 'number' && data < 0) {
    throw Object.assign(new Error('Alcanzaste el límite diario de correos escritos con IA. Inténtalo mañana o aprueba la campaña con el texto base.'), { status: 429 });
  }
}
