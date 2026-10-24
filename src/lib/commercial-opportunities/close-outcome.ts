// How an opportunity ends (OPP-29, OPP-30): what Mercado Público says of a tender after it closes, read as a person reads it, and the
// reasons a team gives when it closes one as won or lost, kept so they can be counted («¿cuántas perdimos por precio?»). Pure: the
// server, the page and the administrator's report share it.
import { z } from 'zod';
import { normalizeRut } from '@/lib/public-procurement/market';
import type { TenderResult } from './tenders';

/** The result kept with the opportunity (data.result): when it was read, and whether the company won it (null: unknown). */
export type StoredResult = TenderResult & { checkedAt: string; ours?: boolean | null };
/** The states after which nothing else happens to a tender: someone won it, nobody did, or it was taken back. */
export const FINAL_RESULTS = ['adjudicada', 'desierta', 'revocada'] as const;
export const isFinalResult = (status: string | null | undefined) => (FINAL_RESULTS as readonly string[]).includes(String(status));

const day = (at: string) => new Date(at).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' });
/** «$85.000.000» in pesos, «UF 1.200» or «USD 30.000» otherwise. */
export function moneyOf(amount: number, currency: string | null | undefined) {
  const figure = Math.round(amount).toLocaleString('es-CL');
  return !currency || /^(clp|\$)$/i.test(currency) ? `$${figure}` : `${currency.toUpperCase().slice(0, 4)} ${figure}`;
}

/** The result in one line: «Adjudicada el 20 de octubre a Seguridad Sur SpA por $85.000.000, entre 5 ofertas.» */
export function resultLine(result: Pick<TenderResult, 'status' | 'awardedAt' | 'expectedAt' | 'bidders' | 'winners' | 'total' | 'currency'>) {
  const on = (at: string | null) => (at ? ` el ${day(at)}` : '');
  if (result.status === 'adjudicada') {
    const [first, ...others] = result.winners;
    const to = first ? ` a ${first.name}${others.length ? ` y ${others.length === 1 ? 'otra empresa' : `${others.length} empresas más`}` : ''}` : '';
    const amount = first && result.total !== null ? ` por ${moneyOf(result.total, result.currency)}` : '';
    const bidders = result.bidders ? `, entre ${result.bidders === 1 ? 'una sola oferta' : `${result.bidders} ofertas`}` : '';
    return `Adjudicada${on(result.awardedAt)}${to}${amount}${bidders}.`;
  }
  if (result.status === 'desierta') return `Declarada desierta${on(result.awardedAt)}: nadie se la adjudicó.`;
  if (result.status === 'revocada') return `Revocada por el comprador${on(result.awardedAt)}.`;
  if (result.status === 'suspendida') return 'Suspendida por el comprador: todavía no hay adjudicación.';
  if (result.expectedAt) return `Cerrada; la adjudicación se espera para el ${day(result.expectedAt)}.`;
  return result.status === 'publicada' ? 'Todavía abierta en Mercado Público.' : 'Cerrada; todavía sin adjudicar.';
}

/** Whether the company won it: one of the winners has the RUT of its tender profile (null when either is unknown). */
export function wonByUs(result: Pick<TenderResult, 'winners'>, companyRut: string | null | undefined) {
  const ours = normalizeRut(companyRut);
  if (!ours || !result.winners.some(winner => winner.rut)) return null;
  return result.winners.some(winner => normalizeRut(winner.rut) === ours);
}

/** Why an opportunity was lost or won, in chips: few, plain, and the same for everyone so they can be counted. */
export const LOST_MOTIVES = [['price', 'Precio'], ['competitor', 'Otro proveedor mejor evaluado'], ['requirements', 'Requisitos o documentos'],
  ['deadline', 'Plazo'], ['capacity', 'Sin capacidad para ejecutarla'], ['void', 'Desierta o revocada']] as const;
export const WON_MOTIVES = [['price', 'Precio'], ['experience', 'Experiencia'], ['technical', 'Propuesta técnica'], ['deadline', 'Plazo'],
  ['relationship', 'Relación con el cliente']] as const;
export const MAX_MOTIVES = 3;
export const motivesFor = (state: 'won' | 'lost') => (state === 'won' ? WON_MOTIVES : LOST_MOTIVES) as ReadonlyArray<readonly [string, string]>;
export const motiveLabel = (state: 'won' | 'lost', id: string) => motivesFor(state).find(([key]) => key === id)?.[1] ?? null;

/** What closing as won or lost may carry besides its line: the reasons, and who won and for how much. */
export const closeDetailSchema = z.object({
  motives: z.array(z.string().max(30)).max(MAX_MOTIVES).optional(),
  winner: z.string().trim().max(200).optional(),
  amount: z.number().nonnegative().max(1e13).optional(),
}).strict();
export type CloseDetail = z.infer<typeof closeDetailSchema>;

/** The reasons kept: only the ones of that state, once each, in the order of the list. */
export function closeMotives(state: 'won' | 'lost', motives: readonly string[] | null | undefined) {
  const chosen = new Set(motives || []);
  return motivesFor(state).map(([id]) => id).filter(id => chosen.has(id)).slice(0, MAX_MOTIVES);
}

/** The line the activity keeps: «Estado: perdida · Precio, Plazo. Ganó Seguridad Sur SpA por $85.000.000. Pidieron menor plazo.» */
export function closeBody(label: string, state: 'won' | 'lost', detail: CloseDetail, note: string | undefined, currency?: string | null) {
  const motives = closeMotives(state, detail.motives).map(id => motiveLabel(state, id)).filter(Boolean);
  const winner = state === 'lost' && detail.winner ? ` Ganó ${detail.winner}${detail.amount !== undefined ? ` por ${moneyOf(detail.amount, currency)}` : ''}.` : '';
  const amount = state === 'won' && detail.amount !== undefined ? ` Por ${moneyOf(detail.amount, currency)}.` : '';
  return `Estado: ${label}${motives.length ? ` · ${motives.join(', ')}` : ''}.${winner}${amount}${note ? ` ${note}` : ''}`;
}

export type ClosedRow = { opportunityId: string; to: string | null; motives?: unknown; winner?: string | null; createdAt: string };
type Count = { id: string; label: string; count: number };
/**
 * «Lo que aprendimos»: of the opportunities closed in a period, how many were won and lost, the reasons given for each (most
 * frequent first), and the suppliers that won the ones lost. The last close of each opportunity counts, as the page reads it.
 */
export function lessonsLearned(rows: ClosedRow[]) {
  const last = new Map<string, ClosedRow>();
  for (const row of rows) if ((row.to === 'won' || row.to === 'lost') && !(Date.parse(last.get(row.opportunityId)?.createdAt || '') > Date.parse(row.createdAt))) last.set(row.opportunityId, row);
  const closes = [...last.values()];
  const count = (state: 'won' | 'lost'): Count[] => motivesFor(state).map(([id, label]) => ({ id, label,
    count: closes.filter(row => row.to === state && Array.isArray(row.motives) && row.motives.includes(id)).length })).filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const rivals = new Map<string, { name: string; count: number }>();
  for (const row of closes) {
    const name = row.to === 'lost' ? String(row.winner || '').replace(/\s+/g, ' ').trim() : '';
    if (!name) continue;
    const key = name.toLowerCase();
    rivals.set(key, { name: rivals.get(key)?.name ?? name, count: (rivals.get(key)?.count ?? 0) + 1 });
  }
  const won = closes.filter(row => row.to === 'won').length, lost = closes.filter(row => row.to === 'lost').length;
  return { won, lost, winRate: won + lost ? won / (won + lost) : null, wonFor: count('won'), lostFor: count('lost'),
    rivals: [...rivals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es')).slice(0, 5) };
}
