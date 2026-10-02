import { teamLockNotice, type TeamLock } from './team-lock';

/**
 * What the extension shows next to a person on LinkedIn (plan 8, phase 4, PR-4b): one short line, the most useful first.
 * Someone else working the contact comes before anything of one's own, then a reply, the last contact and being saved.
 */
export type PresenceTone = 'success' | 'info' | 'warning';
export type ProfilePresence = { label: string; tone: PresenceTone; blocks: boolean };
export type PresenceFacts = {
  /** The team lock (only with collaboration on); one's own locks say nothing here. */
  lock: TeamLock | null;
  saved: { mine: boolean } | null;
  /** The last confirmed LinkedIn message and the last email sent to this person, by anyone in the organization. */
  lastLinkedinAt: string | null;
  lastEmailAt: string | null;
  repliedAt: string | null;
};

const DAY = 86_400_000;
/** «hoy», «ayer» or «hace 5 días», in Chilean Spanish. */
export function daysAgo(at: string, now = Date.now()) {
  const days = Math.floor((now - Date.parse(at)) / DAY);
  return days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`;
}

export function profilePresence(facts: PresenceFacts, now = Date.now()): ProfilePresence | null {
  const notice = teamLockNotice(facts.lock, now);
  if (notice) return { label: notice.text, tone: notice.blocks ? 'warning' : 'info', blocks: notice.blocks };
  const contacts = [facts.lastLinkedinAt, facts.lastEmailAt].filter((at): at is string => Boolean(at) && Number.isFinite(Date.parse(at!)));
  const last = contacts.sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? null;
  // A reply after the last contact is what matters most of one's own.
  if (facts.repliedAt && Number.isFinite(Date.parse(facts.repliedAt)) && (!last || Date.parse(facts.repliedAt) >= Date.parse(last))) {
    return { label: `Respondió ${daysAgo(facts.repliedAt, now)}`, tone: 'success', blocks: false };
  }
  if (last) return { label: `Contactado ${daysAgo(last, now)} por ${last === facts.lastLinkedinAt ? 'LinkedIn' : 'correo'}`, tone: 'info', blocks: false };
  if (facts.saved) return { label: facts.saved.mine ? 'Guardado' : 'Guardado en tu organización', tone: 'success', blocks: false };
  return null;
}
