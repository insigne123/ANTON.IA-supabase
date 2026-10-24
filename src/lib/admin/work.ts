// «Oportunidades y Cowork» in Administración (OPP-07, APP-14, COW-15): what «Uso y resultados» did not measure. Who works the
// opportunities and how they end, who uses Cowork and what it costs, and the three budgets of ANTON.IA side by side (the US$20 a month of
// Oportunidades, Cowork's calls per person and day, the daily credits of prospecting). In production, in 30 days, between 1 and 3 of the
// 28 people let into Oportunidades acted on it and nobody assigned: this is where an administrator sees that. Pure: the server reads the
// rows (server/admin-work-data.ts), the page shows the report.
import { dayInZone, dayStartInZone, shiftDay } from './chile-time';

/** Cowork's calls a person may make in a day (cowork_reserve_model_call, 20261023130000). */
export const COWORK_DAILY_CALLS = 300;
const IN_PLAY = ['assigned', 'working', 'blocked'];

export type WorkReportInput = {
  people: Array<{ id: string; name: string }>;
  /** The period, days in Chile (yyyy-mm-dd), both included. */
  from: string; to: string; now: Date;
  work: Array<{ opportunityId: string; state: string; responsibleId: string | null; deadlineAt: string | null }>;
  participants: Array<{ opportunityId: string; userId: string }>;
  /** What people did on the opportunities in the period; `to` is the stage of a move. */
  activity: Array<{ actorId: string | null; kind: string; to?: string | null; createdAt: string }>;
  /** Decisions and blocks no administrator has answered. */
  waiting: number;
  runs: Array<{ id: string; userId: string; rootRunId: string | null; createdAt: string }>;
  /** Cowork's model calls of the period (cost in US$ when the price was known) and of today (to compare with the daily cap). */
  calls: Array<{ userId: string; createdAt: string; costUsd: number | null }>;
  callsToday: Array<{ userId: string }>;
  budget: { spent: number; cap: number };
  credits: { used: number; limit: number } | null;
};

export type WorkReport = {
  opportunities: { inPlay: number; overdue: number; submitted: number; won: number; lost: number; waiting: number; activePeople: number;
    people: Array<{ id: string; name: string; open: number; actions: number; submitted: number; won: number; lastAt: string | null }> };
  cowork: { conversations: number; turns: number; activePeople: number; costUsd: number; unknownCost: number;
    people: Array<{ id: string; name: string; conversations: number; turns: number; costUsd: number; lastAt: string | null }> };
  caps: Array<{ id: 'opportunities' | 'cowork' | 'credits'; label: string; used: number; limit: number; detail: string }>;
};

const latest = (a: string | null, b: string) => (!a || b > a ? b : a);
const money = (value: number) => `US$${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function workReport(input: WorkReportInput): WorkReport {
  const start = dayStartInZone(input.from).getTime(), end = dayStartInZone(shiftDay(input.to, 1)).getTime();
  const inPeriod = (at: string) => { const time = Date.parse(at); return time >= start && time < end; };
  const name = (id: string) => input.people.find(person => person.id === id)?.name || 'Exintegrante';

  // Opportunities: what is in play now, what closed without being submitted, and what each person did in the period.
  const inPlay = new Set(input.work.filter(row => IN_PLAY.includes(row.state)).map(row => row.opportunityId));
  const overdue = input.work.filter(row => IN_PLAY.includes(row.state) && row.deadlineAt && Date.parse(row.deadlineAt) < input.now.getTime()).length;
  const moves = input.activity.filter(row => inPeriod(row.createdAt) && (row.kind === 'state' || row.kind === 'auto_state'));
  const moved = (to: string) => moves.filter(row => row.to === to).length;
  const acted = new Map<string, { actions: number; submitted: number; won: number; lastAt: string | null }>();
  for (const row of input.activity) {
    if (!row.actorId || !inPeriod(row.createdAt)) continue;
    const mine = acted.get(row.actorId) ?? { actions: 0, submitted: 0, won: 0, lastAt: null };
    mine.actions++; mine.lastAt = latest(mine.lastAt, row.createdAt);
    if ((row.kind === 'state' || row.kind === 'auto_state') && row.to === 'submitted') mine.submitted++;
    if ((row.kind === 'state' || row.kind === 'auto_state') && row.to === 'won') mine.won++;
    acted.set(row.actorId, mine);
  }
  const open = new Map<string, number>();
  for (const row of input.participants) if (inPlay.has(row.opportunityId)) open.set(row.userId, (open.get(row.userId) ?? 0) + 1);
  const opportunityPeople = [...new Set([...input.people.map(person => person.id), ...acted.keys()])]
    .map(id => ({ id, name: name(id), open: open.get(id) ?? 0, ...(acted.get(id) ?? { actions: 0, submitted: 0, won: 0, lastAt: null }) }))
    .filter(person => person.open || person.actions)
    .sort((a, b) => b.actions - a.actions || b.open - a.open || a.name.localeCompare(b.name, 'es'));

  // Cowork: conversations (a turn belongs to the conversation that started it), turns and the cost of the period, by person.
  const runs = input.runs.filter(run => inPeriod(run.createdAt));
  const calls = input.calls.filter(call => inPeriod(call.createdAt));
  const coworkPeople = [...new Set([...runs.map(run => run.userId), ...calls.map(call => call.userId)])].map(id => {
    const mine = runs.filter(run => run.userId === id);
    const spent = calls.filter(call => call.userId === id).reduce((sum, call) => sum + (call.costUsd ?? 0), 0);
    return { id, name: name(id), conversations: new Set(mine.map(run => run.rootRunId ?? run.id)).size, turns: mine.length, costUsd: spent,
      lastAt: mine.reduce<string | null>((at, run) => latest(at, run.createdAt), null) };
  }).sort((a, b) => b.turns - a.turns || b.costUsd - a.costUsd || a.name.localeCompare(b.name, 'es'));

  const today = new Map<string, number>();
  for (const call of input.callsToday) today.set(call.userId, (today.get(call.userId) ?? 0) + 1);
  const busiest = [...today.entries()].sort((a, b) => b[1] - a[1])[0];
  const caps: WorkReport['caps'] = [
    { id: 'opportunities', label: 'Oportunidades este mes', used: input.budget.spent, limit: input.budget.cap,
      detail: `${money(input.budget.spent)} de ${money(input.budget.cap)}: búsquedas, informes y borradores de toda la empresa.` },
    { id: 'cowork', label: 'Cowork hoy', used: busiest?.[1] ?? 0, limit: COWORK_DAILY_CALLS,
      detail: busiest ? `Quien más lo usó hoy, ${name(busiest[0])}, lleva ${busiest[1].toLocaleString('es-CL')} de ${COWORK_DAILY_CALLS} llamadas a la IA; cada persona tiene las suyas.` : `Nadie lo usó hoy. Cada persona tiene ${COWORK_DAILY_CALLS} llamadas a la IA por día.` },
    ...(input.credits ? [{ id: 'credits' as const, label: 'Créditos de prospección hoy', used: input.credits.used, limit: input.credits.limit,
      detail: `${input.credits.used.toLocaleString('es-CL')} de ${input.credits.limit.toLocaleString('es-CL')} créditos del equipo; se renuevan cada día.` }] : []),
  ];

  return {
    opportunities: { inPlay: inPlay.size, overdue, submitted: moved('submitted'), won: moved('won'), lost: moved('lost'), waiting: input.waiting,
      activePeople: opportunityPeople.filter(person => person.actions > 0).length, people: opportunityPeople },
    cowork: { conversations: new Set(runs.map(run => `${run.userId}:${run.rootRunId ?? run.id}`)).size, turns: runs.length, activePeople: coworkPeople.filter(person => person.turns > 0).length,
      costUsd: calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0), unknownCost: calls.filter(call => call.costUsd === null).length, people: coworkPeople },
    caps,
  };
}

/** The period of the report: the last `days` days in Chile, today included. */
export const lastDays = (days: number, now = new Date()) => ({ from: shiftDay(dayInZone(now), -(days - 1)), to: dayInZone(now) });
