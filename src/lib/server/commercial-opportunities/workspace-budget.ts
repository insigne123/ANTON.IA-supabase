import type { SupabaseClient } from '@supabase/supabase-js';
import { OPPORTUNITY_MONTHLY_MICRO_USD } from '@/lib/commercial-opportunities/workspace';
import { opportunityDb } from './workspace-store';

/**
 * The caps opportunity_budget_reserve applies (migration 20261012162000), in micro-USD: the month of the whole workspace, each kind
 * of work within it, and one report across its reading and writing. The database refuses without saying which one; this says it.
 */
export const OPPORTUNITY_CATEGORY_MICRO_USD: Record<string, number> = { sources: 8_000_000, evaluation: 3_000_000, research: 6_000_000, chat: 2_000_000, other: 1_000_000 };
export const OPPORTUNITY_REPORT_MICRO_USD = 750_000;

const KIND: Record<string, string> = {
  sources: 'Las búsquedas de oportunidades', evaluation: 'Las evaluaciones de oportunidades', research: 'Los informes',
  chat: 'Las preguntas sobre oportunidades', other: 'Las tareas de Oportunidades',
};
const KEEP_BASES = 'Quita los que no sean bases ni anexos y vuelve a generarlo.';
/** A report whose documents need more than one report may spend: what to do is to keep only the bases and their annexes. */
export const REPORT_TOO_LONG = `Los documentos son demasiado extensos para un informe. ${KEEP_BASES}`;

type Row = { state: string; cost_micro_usd: number | string | null; held_micro_usd: number | string | null };
/** What a reservation weighs, as the database counts it: its cost once settled, what it holds until then. */
const weight = (rows: Row[]) => rows.reduce((sum, row) => sum + Number((row.state === 'settled' ? row.cost_micro_usd : row.held_micro_usd) || 0), 0);
const usd = (micro: number) => `US$${(micro / 1e6).toLocaleString('es-CL', { minimumFractionDigits: micro % 1_000_000 ? 2 : 0, maximumFractionDigits: 2 })}`;
const monthName = (date: Date) => date.toLocaleDateString('es-CL', { month: 'long', timeZone: 'UTC' });

export type BudgetRoom = { month: number; category: number; report: number | null; period: string };

/** Pages of a reservations query (PostgREST answers 1,000 rows at most), in a stable order. */
async function every(build: () => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; page < 20; page++) {
    const batch = (opportunityDb(await build().order('id').range(page * 1000, page * 1000 + 999)) || []) as Row[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

/**
 * What is left, in micro-USD, of the month, of one kind of work this month and (with a job) of that report, counted as
 * opportunity_budget_reserve counts it: the month's spent and reserved plus older calls still unsettled; a kind's settled cost and
 * holds; and for a research job, all of its steps.
 */
export async function opportunityBudgetRoom(client: SupabaseClient, organizationId: string, category: string, jobId: string | null, now = new Date()): Promise<BudgetRoom> {
  const period = `${now.toISOString().slice(0, 7)}-01`;
  const reservations = () => client.from('opportunity_budget_reservations').select('state,cost_micro_usd,held_micro_usd').eq('organization_id', organizationId);
  const [month, older, kind, job] = await Promise.all([
    client.from('opportunity_budget_months').select('spent_micro_usd,reserved_micro_usd').eq('organization_id', organizationId).eq('period', period).maybeSingle()
      .then((result: any) => opportunityDb(result) as { spent_micro_usd?: number | string | null; reserved_micro_usd?: number | string | null } | null),
    every(() => reservations().neq('period', period).neq('state', 'settled')),
    every(() => reservations().eq('category', category).or(`period.eq.${period},state.neq.settled`)),
    jobId && category === 'research' ? every(() => reservations().eq('job_id', jobId)) : Promise.resolve(null),
  ]);
  const held = older.reduce((sum, row) => sum + Number(row.held_micro_usd || 0), 0);
  return {
    month: OPPORTUNITY_MONTHLY_MICRO_USD - Number(month?.spent_micro_usd || 0) - Number(month?.reserved_micro_usd || 0) - held,
    category: (OPPORTUNITY_CATEGORY_MICRO_USD[category] ?? 0) - weight(kind),
    report: job ? OPPORTUNITY_REPORT_MICRO_USD - weight(job) : null,
    period,
  };
}

/** Which cap a step of `micro` does not fit, in the order the database checks them, said with when it renews. Null: it fits. */
export function budgetRefusalMessage(room: BudgetRoom, category: string, micro: number) {
  const start = new Date(`${room.period}T12:00:00.000Z`);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12));
  const renews = `Se renueva el 1 de ${monthName(next)}.`;
  if (room.month < micro) return `Oportunidades llegó al tope de ${usd(OPPORTUNITY_MONTHLY_MICRO_USD)} de ${monthName(start)}. ${renews}`;
  if (room.category < micro) return `${KIND[category] || KIND.other} llegaron al tope de ${usd(OPPORTUNITY_CATEGORY_MICRO_USD[category] ?? 0)} de ${monthName(start)}. ${renews}`;
  if (room.report !== null && room.report < micro) return `Este informe llegó a su tope de ${usd(OPPORTUNITY_REPORT_MICRO_USD)}: sus documentos son demasiado extensos. ${KEEP_BASES}`;
  return null;
}

/**
 * About what a report of `fragments` costs with Haiku, to say before it starts that it will not fit (OPP-18): each part (four fragments)
 * about US$0.005 once settled, and the writing as its reservation holds it, with the facts it reads (about 2.2 kB a fragment) and the
 * rest of its prompt (sources, rules and contract, about 75 kB), at the long-context price past the line. Measured in October 2026.
 */
export function reportCostEstimate(fragments: number) {
  const parts = Math.ceil(Math.max(0, fragments) / 4);
  const bytes = Math.max(0, fragments) * 2_200 + 75_000;
  const long = bytes > 95_000;
  return Math.ceil(parts * 5_000 + bytes * (long ? 0.5 : 0.1) + 24_000 * (long ? 2.5 : 0.5));
}

/**
 * Whether a report of `fragments` can be asked for now: null if it fits what is left, else what to tell the person, before any
 * reading (a report used to be refused at its last step, sixteen minutes in). The room cannot be read: the reservations still decide.
 */
export async function reportBudgetCheck(client: SupabaseClient, organizationId: string, fragments: number, now = new Date()) {
  const micro = reportCostEstimate(fragments);
  if (micro > OPPORTUNITY_REPORT_MICRO_USD) return REPORT_TOO_LONG;
  const room = await opportunityBudgetRoom(client, organizationId, 'research', null, now).catch(() => null);
  return room ? budgetRefusalMessage(room, 'research', micro) : null;
}

/**
 * What a refused reservation tells the person: the cap it hit. When nothing seems full any more (another job took the room and
 * already settled it), or the budget cannot be read now, it asks to try again in a moment.
 */
export async function budgetRefusal(client: SupabaseClient, job: { id: string; organization_id: string }, category: string, micro: number, now = new Date()) {
  const room = await opportunityBudgetRoom(client, job.organization_id, category, job.id, now).catch(() => null);
  return (room && budgetRefusalMessage(room, category, micro)) || 'Otro trabajo de Oportunidades ocupó lo que quedaba del presupuesto. Vuelve a intentarlo en unos minutos.';
}
