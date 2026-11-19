/**
 * The notice of «Buscar prospectos» about the person's recommended contacts (19 Nov 2026, the owner: «si el módulo de buscador es el
 * más usado podríamos poner una alerta cuando entren a esa página para decirles que tenemos una nueva sección de leads recomendados
 * del día»). That week nine people of a team searched by hand and spent credits there while four opened the contacts already chosen
 * for them: the search is where they are, so it says what waits for them and takes them to it.
 *
 * `recommendedNoticeOf` reads what «Hoy» reads (GET /api/lead-drops/latest): the person's last contacts of the week with something
 * left to do. Nothing left, nothing said.
 */

export type RecommendedNotice = { id: string; total: number; left: number; today: boolean };

type Latest = {
  drop?: { id?: unknown; dropDate?: unknown; total?: unknown; left?: unknown } | null;
  board?: { id?: unknown; date?: unknown; items?: unknown } | null;
} | null | undefined;

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** `today`: the day in Chile (dayInZone), to tell today's contacts from earlier ones still waiting. */
export function recommendedNoticeOf(latest: Latest, today: string): RecommendedNotice | null {
  const board = latest?.board;
  if (board && typeof board.id === 'string' && Array.isArray(board.items)) {
    const items = board.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    // As «Hoy» counts them: an email still to look up, or a campaign still to approve.
    const left = items.filter(item => !item.savedLeadId || (item.draft && !item.campaign)).length;
    return left ? { id: board.id, total: items.length, left, today: board.date === today } : null;
  }
  const drop = latest?.drop;
  if (drop && typeof drop.id === 'string') {
    const total = count(drop.total), left = Math.min(count(drop.left), total);
    return left ? { id: drop.id, total, left, today: drop.dropDate === today } : null;
  }
  return null;
}

/** What the notice says, in one sentence. */
export function recommendedNoticeText(notice: RecommendedNotice): string {
  if (notice.today && notice.left === notice.total) return notice.total === 1
    ? 'Hoy elegimos un contacto para ti con tu cliente ideal, con su campaña ya escrita.'
    : `Hoy elegimos ${notice.total} contactos para ti con tu cliente ideal, cada uno con su campaña ya escrita.`;
  return notice.left === 1
    ? (notice.total === 1 ? 'Tienes un contacto elegido para ti por revisar, con su campaña ya escrita.' : `Te queda 1 de tus ${notice.total} contactos recomendados por revisar.`)
    : `Te quedan ${notice.left} de tus ${notice.total} contactos recomendados por revisar.`;
}

/** Where the person's choice to close the notice is kept: by drop, so the next day's contacts are said again. */
export const recommendedNoticeKey = (dropId: string) => `anton:search-recommended:${dropId}`;
