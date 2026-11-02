/**
 * «Qué se obtuvo con los créditos» (2 Nov 2026, plan de uso M1). The people paid for with Apollo credits in a period
 * (1 credit an email, 8 email and mobile) and what happened with them afterwards, however long it took: contacted by
 * email, call or WhatsApp, a real conversation (a human reply, or a call answered), a meeting (asked for in a reply,
 * or booked on a call). Each person counts for whoever paid for them. «Esperan contacto»: paid more than seven days ago
 * and still nobody wrote or called. Administración shows it by person and team; «Hoy», each person's own month.
 * Pure: the screens, the server and the tests share it.
 */

export type CreditOutcomes = {
  /** Apollo credits used: 1 an email, 8 email and mobile; paying twice for someone counts twice. */
  credits: number;
  /** People paid for, once each. */
  paid: number;
  /** Of them, with a mobile. */
  withPhone: number;
  contacted: number;
  conversations: number;
  meetings: number;
  /** Paid more than seven days ago and still not contacted. */
  waiting: number;
};

export type CreditResultsPerson = CreditOutcomes & { userId: string; name?: string };
export type CreditResults = { totals: CreditOutcomes; people: CreditResultsPerson[] };

export const EMPTY_OUTCOMES: CreditOutcomes = { credits: 0, paid: 0, withPhone: 0, contacted: 0, conversations: 0, meetings: 0, waiting: 0 };
export const WAITING_AFTER_DAYS = 7;

/** The steps in the order the work goes, as the card shows them. */
export const CREDIT_STEPS: Array<{ key: keyof CreditOutcomes; label: string }> = [
  { key: 'credits', label: 'Créditos usados' },
  { key: 'paid', label: 'Personas con datos' },
  { key: 'contacted', label: 'Contactadas' },
  { key: 'conversations', label: 'Conversaciones' },
  { key: 'meetings', label: 'Reuniones' },
];

export function addOutcomes(a: CreditOutcomes, b: CreditOutcomes): CreditOutcomes {
  return {
    credits: a.credits + b.credits,
    paid: a.paid + b.paid,
    withPhone: a.withPhone + b.withPhone,
    contacted: a.contacted + b.contacted,
    conversations: a.conversations + b.conversations,
    meetings: a.meetings + b.meetings,
    waiting: a.waiting + b.waiting,
  };
}

const count = (value: number) => value.toLocaleString('es-CL');
const plural = (value: number, one: string, many: string) => `${count(value)} ${value === 1 ? one : many}`;

/** Credits each result cost, rounded; null while there is none to divide by. */
export function creditsPer(credits: number, results: number) {
  return results > 0 ? Math.round(credits / results) : null;
}

/** «Con 2.343 créditos hubo datos de 262 personas: se contactó a 2, con 0 conversaciones y 0 reuniones.» */
export function creditResultsSentence(totals: CreditOutcomes) {
  if (!totals.credits && !totals.paid) return 'En este período no se usaron créditos de Apollo.';
  return `Con ${plural(totals.credits, 'crédito', 'créditos')} hubo datos de ${plural(totals.paid, 'persona', 'personas')}: `
    + `se contactó a ${count(totals.contacted)}, con ${plural(totals.conversations, 'conversación', 'conversaciones')} `
    + `y ${plural(totals.meetings, 'reunión', 'reuniones')}.`;
}

/** What each conversation and meeting cost, only when there were some. */
export function costSentence(totals: CreditOutcomes) {
  const perConversation = creditsPer(totals.credits, totals.conversations);
  const perMeeting = creditsPer(totals.credits, totals.meetings);
  const parts = [
    perConversation !== null ? `${count(perConversation)} créditos por conversación` : '',
    perMeeting !== null ? `${count(perMeeting)} por reunión` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The paid people nobody contacted after a week: the credits that still can turn into something. */
export function waitingSentence(totals: CreditOutcomes) {
  if (!totals.waiting) return null;
  return `${plural(totals.waiting, 'persona pagada lleva', 'personas pagadas llevan')} más de ${WAITING_AFTER_DAYS} días sin contacto.`;
}

/** The first day of the month in Chile (YYYY-MM-01) for a day key (YYYY-MM-DD). */
export function monthStartOf(day: string) {
  return `${day.slice(0, 7)}-01`;
}

/** «noviembre» for a day key, as «Hoy» names the month. */
export function monthName(day: string) {
  const [year, month] = day.split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, 15)).toLocaleDateString('es-CL', { month: 'long', timeZone: 'UTC' });
}
