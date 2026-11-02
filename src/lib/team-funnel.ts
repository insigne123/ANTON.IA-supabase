/**
 * «El trabajo, paso a paso» (2 Nov 2026, plan de uso A4). The steps each person sees in «Tu semana» (audit N1), for a
 * team in Administración: the contacts saved, with an email, researched and with a draft, then the people contacted (an
 * email sent, or a call or a WhatsApp with its result) and the conversations (a real reply, or a call answered). It says
 * where the work stops for most of the team, so an administrator knows what to ask about. Pure: the reads are in
 * src/lib/server/team-funnel.ts.
 */

export type WorkFunnel = { saved: number; withEmail: number; researched: number; drafts: number; contacted: number; conversations: number };
export type WorkStep = keyof WorkFunnel;
export type TeamFunnelPerson = { userId: string; name?: string; funnel: WorkFunnel };
export type TeamFunnel = { total: WorkFunnel; people: TeamFunnelPerson[] };

export const EMPTY_FUNNEL: WorkFunnel = { saved: 0, withEmail: 0, researched: 0, drafts: 0, contacted: 0, conversations: 0 };

export const WORK_STEPS: Array<{ key: WorkStep; label: string }> = [
  { key: 'saved', label: 'Guardados' }, { key: 'withEmail', label: 'Con correo' }, { key: 'researched', label: 'Investigados' },
  { key: 'drafts', label: 'Borradores' }, { key: 'contacted', label: 'Contactados' }, { key: 'conversations', label: 'Conversaciones' },
];

/** The work in the team's own hands ends at «Contactados»: a conversation depends on the other side, so no stall is read there. */
const WORK: WorkStep[] = ['saved', 'withEmail', 'researched', 'drafts', 'contacted'];
export type StallStep = 'withEmail' | 'researched' | 'drafts' | 'contacted';

const count = (value: number, one: string, many: string) => `${value.toLocaleString('es-CL')} ${value === 1 ? one : many}`;

/** Each stall by the step not taken: where it happens, what is left on the step before, and what the people do. */
export const STALLS: Record<StallStep, { at: string; left: (lost: number) => string; why: string }> = {
  withEmail: { at: 'al conseguir el correo', left: lost => `${count(lost, 'guardado', 'guardados')} sin correo`, why: 'guardan personas, pero no consiguen su correo' },
  researched: { at: 'al investigar', left: lost => `${lost.toLocaleString('es-CL')} con correo sin investigar`, why: 'tienen el correo, pero no investigan a la persona' },
  drafts: { at: 'al preparar el borrador', left: lost => `${count(lost, 'investigado', 'investigados')} sin borrador`, why: 'investigan, pero no preparan el borrador' },
  contacted: { at: 'al enviar', left: lost => `${count(lost, 'borrador', 'borradores')} sin enviar`, why: 'tienen borradores, pero no los envían' },
};

export function addFunnels(a: WorkFunnel, b: WorkFunnel): WorkFunnel {
  return {
    saved: a.saved + b.saved, withEmail: a.withEmail + b.withEmail, researched: a.researched + b.researched,
    drafts: a.drafts + b.drafts, contacted: a.contacted + b.contacted, conversations: a.conversations + b.conversations,
  };
}

export const hasWork = (funnel: WorkFunnel | null | undefined) => Boolean(funnel && WORK_STEPS.some(step => funnel[step.key] > 0));

/**
 * Where the work stops: between two steps in a row, the biggest fall, when it is at least three and the step before had at
 * least three. Every step is counted in the same period, and a later one makes up for a fall before it: someone who saved
 * 30 people and called 30 skipped the email, they did not stop. So a fall is only what no later step made up.
 */
export function workStall(funnel: WorkFunnel | null | undefined): { step: StallStep; lost: number } | null {
  if (!funnel) return null;
  let best: { step: StallStep; lost: number } | null = null;
  for (let index = 1; index < WORK.length; index += 1) {
    const before = funnel[WORK[index - 1]];
    const lost = before - Math.max(...WORK.slice(index).map(step => funnel[step]));
    if (before >= 3 && lost >= 3 && (!best || lost > best.lost)) best = { step: WORK[index] as StallStep, lost };
  }
  return best;
}

/**
 * The stall most of the team shares: the step where most people stop (on a tie, where more is left). With nobody stopping
 * alone, the team's own: five people with two drafts each still leave ten unsent. `people` counts who stop there, of `of`
 * with any work in the period.
 */
export function teamStall(funnel: TeamFunnel): { step: StallStep; people: number; of: number; lost: number; name: string | null } | null {
  const active = funnel.people.filter(person => hasWork(person.funnel));
  const byStep = new Map<StallStep, { people: number; lost: number; name: string | null }>();
  for (const person of active) {
    const stall = workStall(person.funnel);
    if (!stall) continue;
    const known = byStep.get(stall.step);
    byStep.set(stall.step, known ? { people: known.people + 1, lost: known.lost + stall.lost, name: null } : { people: 1, lost: stall.lost, name: person.name || null });
  }
  let best: { step: StallStep; people: number; of: number; lost: number; name: string | null } | null = null;
  for (const [step, found] of byStep) {
    if (!best || found.people > best.people || (found.people === best.people && found.lost > best.lost)) best = { step, ...found, of: active.length };
  }
  if (best) return best;
  const own = workStall(funnel.total);
  return own ? { step: own.step, people: 0, of: active.length, lost: own.lost, name: null } : null;
}

/** The card's sentence: where the work stops, for one person or for most of the team; that nothing stops; or that there was no work. */
export function funnelSentence(funnel: TeamFunnel, single: boolean) {
  if (!hasWork(funnel.total)) return single ? 'En este período no guardó, escribió ni llamó a ningún contacto.' : 'En este período nadie guardó, escribió ni llamó a un contacto.';
  if (single) {
    const stall = workStall(funnel.total);
    return stall ? `Se frena ${STALLS[stall.step].at}: ${STALLS[stall.step].left(stall.lost)}.` : 'Ningún paso se queda atrás en este período.';
  }
  const stall = teamStall(funnel);
  if (!stall) return 'Ningún paso se queda atrás en este período.';
  const { at, left, why } = STALLS[stall.step];
  if (stall.people > 1) return `${stall.people.toLocaleString('es-CL')} de ${stall.of.toLocaleString('es-CL')} personas se frenan ${at}: ${why}.`;
  if (stall.people === 1) return `${stall.name || 'Una persona'} se frena ${at}: ${left(stall.lost)}.`;
  return `El equipo se frena ${at}: ${left(stall.lost)}.`;
}

/** One person's row: where they stop, with what is left; «—» when nothing stops; nothing done in the period. */
export function stallCell(funnel: WorkFunnel) {
  if (!hasWork(funnel)) return 'Sin actividad';
  const stall = workStall(funnel);
  if (!stall) return '—';
  const at = STALLS[stall.step].at;
  return `${at.charAt(0).toUpperCase()}${at.slice(1)} (${stall.lost.toLocaleString('es-CL')})`;
}
