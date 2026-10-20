import { dayInZone } from '@/lib/admin/chile-time';

/**
 * «Metas semanales» (idea 4): a simple goal per person and week. How many people to contact (an email sent, a LinkedIn
 * message or a call done) and how many new contacts with an email to find. The admins set the team's goal and, when
 * someone needs another, that person's; while nobody sets anything, DEFAULT_GOALS applies. «Hoy» shows the person's
 * progress, «Tu semana» the team's for the admins, and the morning alerts and Monday's report carry it by email. Pure: the
 * server reads in server/weekly-goals.ts.
 */

export type GoalTargets = { contacted: number; found: number };
export type GoalCounts = { contacted: number; found: number };
export type GoalSource = 'default' | 'team' | 'person';
export type GoalProgress = { targets: GoalTargets; counts: GoalCounts; source: GoalSource };

export const DEFAULT_GOALS: GoalTargets = { contacted: 10, found: 15 };
export const GOAL_MAX = 500;

/** The two goals, the main one first: contacting people is the work; finding contacts is what makes it possible. */
export const GOAL_METRICS = [
  { key: 'contacted', label: 'Personas contactadas', one: 'persona contactada', many: 'personas contactadas' },
  { key: 'found', label: 'Contactos nuevos con correo', one: 'contacto nuevo con correo', many: 'contactos nuevos con correo' },
] as const;

const count = (value: number, one: string, many: string) => `${value.toLocaleString('es-CL')} ${value === 1 ? one : many}`;

/** Whole numbers between 0 and GOAL_MAX; anything else is not a goal. */
export function validTargets(value: unknown): GoalTargets | null {
  const raw = value as Partial<Record<keyof GoalTargets, unknown>> | null;
  const read = (field: unknown) => typeof field === 'number' && Number.isInteger(field) && field >= 0 && field <= GOAL_MAX ? field : null;
  const contacted = read(raw?.contacted), found = read(raw?.found);
  return contacted === null || found === null ? null : { contacted, found };
}

/** The person's own goal, else the team's, else the default. */
export function resolveTargets(team: GoalTargets | null, person: GoalTargets | null): { targets: GoalTargets; source: GoalSource } {
  if (person) return { targets: person, source: 'person' };
  if (team) return { targets: team, source: 'team' };
  return { targets: DEFAULT_GOALS, source: 'default' };
}

/** A team whose admins set both goals to 0 has no goals: nothing shows and nothing is sent about them. */
export const goalsOff = (targets: GoalTargets) => !targets.contacted && !targets.found;

export const goalMet = (progress: GoalProgress) => progress.counts.contacted >= progress.targets.contacted && progress.counts.found >= progress.targets.found;

/** Working days of the week already over when today starts, in Chile: 0 on Monday, 4 on Friday, 5 on the weekend. */
export function workdaysBefore(now: Date) {
  const weekday = (new Date(`${dayInZone(now)}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  return Math.min(weekday, 5);
}

/** Where the person should be to finish the week at an even pace: by the start of today, and by its end. */
export function goalPace(progress: GoalProgress, now: Date) {
  const before = workdaysBefore(now);
  const at = (days: number): GoalCounts => ({
    contacted: Math.ceil((progress.targets.contacted * days) / 5), found: Math.ceil((progress.targets.found * days) / 5),
  });
  const expected = at(before);
  const today = at(Math.min(before + 1, 5));
  return {
    behind: progress.counts.contacted < expected.contacted || progress.counts.found < expected.found,
    /** What is missing today to be on pace at its end. */
    todayLeft: { contacted: Math.max(0, today.contacted - progress.counts.contacted), found: Math.max(0, today.found - progress.counts.found) },
  };
}

/** «Vas al día», «Para ir al día, contacta hoy a 3 personas» or «Cumpliste tu meta»: one line under the progress. */
export function paceSentence(progress: GoalProgress, now: Date) {
  if (goalMet(progress)) return 'Cumpliste tu meta de la semana.';
  if (workdaysBefore(now) >= 5) return 'La semana termina el domingo; el lunes empieza una nueva meta.';
  const { behind, todayLeft } = goalPace(progress, now);
  const task = todayLeft.contacted ? `contacta hoy a ${count(todayLeft.contacted, 'persona', 'personas')}`
    : todayLeft.found ? `suma hoy ${count(todayLeft.found, 'contacto con correo', 'contactos con correo')}` : '';
  if (!behind) return task ? `Vas al día. Para seguir así, ${task}.` : 'Vas al día.';
  return task ? `Para ir al día, ${task}.` : 'Vas un poco atrás.';
}

/**
 * The one thing to do next for the goal: write to the contacts already ready, or find new ones when there are none ready
 * or the contacts are what is missing.
 */
export function goalNextStep(progress: GoalProgress, ready: number): { text: string; href: string } | null {
  const contactedLeft = Math.max(0, progress.targets.contacted - progress.counts.contacted);
  const foundLeft = Math.max(0, progress.targets.found - progress.counts.found);
  if (!contactedLeft && !foundLeft) return null;
  if (contactedLeft && ready > 0) return { text: ready === 1 ? 'Escribe a tu contacto listo' : 'Escribe a tus contactos listos', href: '/saved/leads/enriched' };
  return { text: 'Busca contactos nuevos', href: '/search' };
}

/** «4 de 10 personas contactadas · 6 de 15 contactos nuevos con correo», only the goals that are on. */
export function progressText(progress: GoalProgress) {
  return GOAL_METRICS.filter(metric => progress.targets[metric.key] > 0)
    .map(metric => `${progress.counts[metric.key].toLocaleString('es-CL')} de ${count(progress.targets[metric.key], metric.one, metric.many)}`).join(' · ');
}

/** The goal in one sentence for an email: this week's progress, or how last week ended. */
export function goalSentence(progress: GoalProgress, which: 'current' | 'previous') {
  const done = goalMet(progress);
  if (which === 'previous') return done ? `Cumpliste tu meta de la semana pasada: ${progressText(progress)}.` : `Tu meta de la semana pasada: ${progressText(progress)}.`;
  return done ? `Ya cumpliste tu meta de esta semana: ${progressText(progress)}.` : `Tu meta de esta semana: llevas ${progressText(progress)}.`;
}

/** Who set the goal, in the person's words; an admin is not told to ask an admin. */
export function sourceText(source: GoalSource, admin = false) {
  if (source === 'team') return 'Meta de tu equipo.';
  if (admin) return source === 'person' ? 'Tu meta personal.' : 'Meta sugerida por ANTON.IA.';
  return source === 'person' ? 'Meta personal, puesta por tu administrador.' : 'Meta sugerida. Tu administrador puede cambiarla.';
}
