import { dayInZone, dayStartInZone } from '@/lib/admin/chile-time';
import { moneyOf } from '@/lib/commercial-opportunities/close-outcome';
import { costSentence, creditResultsSentence, monthName, monthStartOf, type CreditOutcomes } from '@/lib/credit-results';

/**
 * «Resumen del mes» (2 Nov 2026, plan de uso M2 y M3). On the first Monday of each month the administrators' weekly report also
 * tells what the month before got: the Apollo credits and what came of them (src/lib/credit-results.ts), the opportunities
 * presented, won (with their amount) and lost, and one thing to do next. In the app it shows in «Equipo» during the first seven
 * days of the month. Pure: the server reads (server/weekly-report.ts).
 */

export type MonthRange = { start: string; label: string; from: string; to: string };
export type MonthOpportunities = {
  submitted: number;
  won: number;
  lost: number;
  /** The won ones' amounts, added by currency, the largest first. */
  wonAmounts: Array<{ currency: string; amount: number }>;
  /** Won with no amount anywhere: neither told at the close nor in the opportunity. */
  wonWithoutAmount: number;
};
export type MonthSection = MonthRange & {
  /** What the month's credits got; null when it could not be read. */
  credits: CreditOutcomes | null;
  /** The month's opportunities; null when nothing was presented, won or lost, or the person may not see Oportunidades. */
  opportunities: MonthOpportunities | null;
};

/** The first Monday of a month always falls in its first seven days. */
export const MONTH_SUMMARY_DAYS = 7;

/** The month before, in Chile, while today is one of the first seven days of a month; null after them. */
export function reportMonth(now: Date): MonthRange | null {
  const today = dayInZone(now);
  if (Number(today.slice(8, 10)) > MONTH_SUMMARY_DAYS) return null;
  const current = monthStartOf(today);
  const year = Number(current.slice(0, 4));
  const month = Number(current.slice(5, 7));
  const start = month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, '0')}-01`;
  return { start, label: monthName(start), from: dayStartInZone(start).toISOString(), to: dayStartInZone(current).toISOString() };
}

/** A change of stage of an opportunity (opportunity_activity, kinds «state» and «auto_state»); `amount`, told when it was won. */
export type OpportunityMove = { opportunityId: string; to: string | null; amount?: number | null; createdAt: string };
export type OpportunityValue = { id: string; amount: number | null; currency: string | null };

/** The stages before presenting: a move back to one of them takes a presentation back (undoAutomaticMove, or a person's change). */
const BEFORE_PRESENTING = new Set(['unassigned', 'assigned', 'working', 'blocked']);
const currencyKey = (currency: string | null | undefined) => {
  const value = String(currency || '').trim().toUpperCase();
  return !value || value === '$' ? 'CLP' : value.slice(0, 4);
};

/**
 * The month's opportunities from their moves. Each one counts by where the month left it: won or lost by its last move, presented
 * when it moved to «Presentada» and did not go back to a stage before it (won, lost or archived after it still was presented). A won
 * one is worth the amount told when it was closed or, without one, the opportunity's own amount.
 */
export function monthOpportunities(moves: OpportunityMove[], values: OpportunityValue[]): MonthOpportunities | null {
  const last = new Map<string, OpportunityMove>();
  const presented = new Set<string>();
  for (const move of moves) {
    if (move.to === 'submitted') presented.add(move.opportunityId);
    const known = last.get(move.opportunityId);
    if (!known || Date.parse(move.createdAt) >= Date.parse(known.createdAt)) last.set(move.opportunityId, move);
  }
  const valueOf = new Map(values.map(value => [value.id, value]));
  const totals = new Map<string, number>();
  let submitted = 0, won = 0, lost = 0, wonWithoutAmount = 0;
  for (const [id, move] of last) {
    if (presented.has(id) && !BEFORE_PRESENTING.has(String(move.to))) submitted++;
    if (move.to === 'lost') lost++;
    if (move.to !== 'won') continue;
    won++;
    const value = valueOf.get(id);
    const amount = typeof move.amount === 'number' && move.amount > 0 ? move.amount : value?.amount && value.amount > 0 ? value.amount : null;
    if (amount === null) { wonWithoutAmount++; continue; }
    const currency = currencyKey(value?.currency);
    totals.set(currency, (totals.get(currency) || 0) + amount);
  }
  if (!submitted && !won && !lost) return null;
  const wonAmounts = [...totals].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
  return { submitted, won, lost, wonAmounts, wonWithoutAmount };
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;
const list = (parts: string[]) => parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;

/** «Oportunidades: 3 presentadas, 1 ganada por $85.000.000 y 2 perdidas.»; amounts in two currencies go «$… + USD …». Null without any. */
export function opportunitiesSentence(opportunities: MonthOpportunities | null) {
  if (!opportunities || (!opportunities.submitted && !opportunities.won && !opportunities.lost)) return null;
  const amounts = opportunities.wonAmounts.map(item => moneyOf(item.amount, item.currency)).join(' + ');
  const won = opportunities.won
    ? `${plural(opportunities.won, 'ganada', 'ganadas')}${amounts ? ` por ${amounts}${opportunities.wonWithoutAmount ? ` (${opportunities.wonWithoutAmount.toLocaleString('es-CL')} sin monto)` : ''}` : ''}`
    : '';
  const parts = [
    opportunities.submitted ? plural(opportunities.submitted, 'presentada', 'presentadas') : '',
    won,
    opportunities.lost ? plural(opportunities.lost, 'perdida', 'perdidas') : '',
  ].filter(Boolean);
  return `Oportunidades: ${list(parts)}.`;
}

/** «En octubre, con 2.343 créditos hubo datos de 262 personas: …»; null when the month used none or could not be read. */
export function monthCreditsSentence(month: MonthSection) {
  const credits = month.credits;
  if (!credits || (!credits.credits && !credits.paid)) return null;
  const sentence = creditResultsSentence(credits);
  return `En ${month.label}, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
}

export type MonthAction = { text: string; href: string };

/**
 * One thing to do about the month, the most useful first: contact the people already paid for, find people when nobody asked
 * for any, or call when emails got no conversation. Nothing when the month went well.
 */
export function monthRecommendation(month: MonthSection): MonthAction | null {
  const credits = month.credits;
  if (!credits) return null;
  if (credits.waiting) {
    return {
      text: credits.waiting === 1
        ? 'Una persona pagada lleva más de una semana sin contacto: en Administración ves quién la pidió'
        : `${credits.waiting.toLocaleString('es-CL')} personas pagadas llevan más de una semana sin contacto: en Administración ves quién pidió cada una`,
      href: '/dashboard/admin/usage',
    };
  }
  if (!credits.credits && !credits.paid) return { text: `En ${month.label} nadie pidió datos de contacto: busquen personas nuevas en «Buscar»`, href: '/search' };
  if (credits.contacted >= 5 && !credits.conversations) {
    return { text: `Se contactó a ${credits.contacted.toLocaleString('es-CL')} personas sin ninguna conversación: prueben llamar a las que tienen móvil`, href: '/saved/leads/enriched?etapa=to_call' };
  }
  return null;
}

/** The month's lines, as the email and the app show them; empty when there is nothing to tell. */
export function monthRows(month: MonthSection): Array<{ text: string; href?: string }> {
  const rows: Array<{ text: string; href?: string }> = [];
  const credits = monthCreditsSentence(month);
  if (credits) rows.push({ text: credits.replace(/\.$/, ''), href: '/dashboard/admin/usage' });
  const cost = month.credits && credits ? costSentence(month.credits) : null;
  if (cost) rows.push({ text: `${cost.charAt(0).toUpperCase()}${cost.slice(1)}` });
  const opportunities = opportunitiesSentence(month.opportunities);
  if (opportunities) rows.push({ text: opportunities.replace(/\.$/, ''), href: '/opportunities' });
  const next = monthRecommendation(month);
  if (next) rows.push(next);
  return rows;
}
