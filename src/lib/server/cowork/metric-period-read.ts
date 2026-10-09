import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkMetricSpan, type CoworkMetricQuery } from '@/lib/cowork/metric-period';
import { coworkTimeZone } from '@/lib/cowork/decision-context';
type Scope = { userId: string; organizationId: string };
/** Exact counts, explicit self/team and calendar/trailing periods. Cohort rates never divide replies to old sends by this period's sends. */
export async function readCoworkPeriodMetrics(client: SupabaseClient, scope: Scope, requested: CoworkMetricQuery, now = new Date()) {
  const period = coworkMetricSpan(requested, now, coworkTimeZone());
  const base = () => {
    const query = client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId);
    return requested.scope === 'own' ? query.eq('user_id', scope.userId) : query;
  };
  const window = (column: string) => base().gte(column, period.startInclusive).lt(column, period.endExclusive);
  const human = 'reply_intent.is.null,reply_intent.not.in.(auto_reply,delivery_failure)';
  const reads = await Promise.all([
    window('sent_at'),
    window('replied_at').or(human),
    window('sent_at').gte('replied_at', period.startInclusive).lt('replied_at', period.endExclusive).or(human),
    window('replied_at').in('reply_intent', ['positive', 'meeting_request']),
  ]);
  if (reads.some(read => read.error || typeof read.count !== 'number' || !Number.isInteger(read.count) || read.count < 0)) throw new Error('No se pudieron contar todas las métricas del período.');
  const [sent, repliesReceived, cohortReplies, positiveRepliesReceived] = reads.map(read => read.count!);
  if (cohortReplies > sent) throw new Error('Los datos cambiaron durante la lectura. Reintenta las métricas para conservar una base consistente.');
  return { scope: requested.scope === 'own' ? 'own_metrics' : 'organization_metrics', period,
    counts: { sentHistoryRows: sent, repliesReceived, positiveRepliesReceived },
    rates: { reply: { numerator: cohortReplies, denominator: sent, value: sent ? cohortReplies / sent : null,
      unit: 'per_sent_history_row_in_period', source: 'contacted_leads',
      definition: 'Hilos con envío y respuesta no automática registrados dentro del mismo período; una respuesta sin clasificar se incluye, salvo que luego se clasifique automática o de fallo.' } },
    completeness: 'exact_counts_not_preview_rows', consistency: 'separate_counts_at_observed_window',
    limitation: 'Son datos registrados en ANTON.IA: no certifican sincronización completa del correo ni cuentan personas únicas o reuniones confirmadas.' };
}
