/**
 * Who in the team holds a contact (Plan 5, PR-9b): «En conversación con Ana», «Contactado por Ana · libre desde el 3 nov».
 * The lock itself lives in organization_contact_threads and the database enforces it when sending; this only says it
 * where people decide whom to write to (Buscar, Por escribir, Cowork). Pure: the screens, Cowork and the tests share it.
 */
export type TeamLockStatus = 'reserved' | 'active' | 'closed' | 'suppressed';

export type TeamLock = {
  status: TeamLockStatus;
  /** Who holds it: the member who opened the thread. */
  ownerName: string | null;
  mine: boolean;
  /** The recipient replied in this cycle: the contact stays with its owner until they close the conversation. */
  replied: boolean;
  lastContactedAt: string | null;
};

export const TEAM_LOCK_RELEASE_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

/** When a contact with no reply is free for the team again: 30 days after the last send. */
export function teamLockFreeFrom(lock: TeamLock): Date | null {
  if (lock.status !== 'active' || lock.replied) return null;
  const last = Date.parse(lock.lastContactedAt || '');
  return Number.isFinite(last) ? new Date(last + TEAM_LOCK_RELEASE_DAYS * DAY) : null;
}

function shortDate(date: Date) {
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).format(date).replace(/\.$/, '');
}

/** The notice for someone else's lock; your own contacts and free ones say nothing. */
export function teamLockNotice(lock: TeamLock | null | undefined, now = Date.now()): { text: string; blocks: boolean } | null {
  if (!lock || lock.mine) return null;
  const owner = lock.ownerName?.trim() || 'otra persona del equipo';
  if (lock.status === 'reserved') return { text: `${owner} está preparando un envío`, blocks: true };
  if (lock.status === 'closed') return { text: `Ganado por ${owner}: no se vuelve a prospectar`, blocks: true };
  if (lock.status === 'suppressed') return { text: 'No contactar: el equipo lo cerró como No interesado', blocks: true };
  if (lock.replied) return { text: `En conversación con ${owner}`, blocks: true };
  const free = teamLockFreeFrom(lock);
  if (!free) return { text: `Contactado por ${owner}`, blocks: true };
  if (free.getTime() <= now) return { text: `Contactado por ${owner} · se libera hoy`, blocks: true };
  return { text: `Contactado por ${owner} · libre desde el ${shortDate(free)}`, blocks: true };
}

export const normalizeLockEmail = (value: unknown) => String(value || '').trim().toLowerCase();

/** LinkedIn profile URLs compared without protocol, «www.», query or trailing slash. */
export function normalizeLockLinkedin(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  const match = text.match(/linkedin\.com\/in\/([^/?#\s]+)/);
  return match ? `linkedin.com/in/${decodeURIComponent(match[1])}` : '';
}
