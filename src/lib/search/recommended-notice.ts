/**
 * The person's recommended contacts inside «Buscar prospectos» (19 Nov 2026, the owner: «si el módulo de buscador es el más usado
 * podríamos poner una alerta cuando entren a esa página para decirles que tenemos una nueva sección de leads recomendados del día»).
 * That week nine people of a team searched by hand and spent credits there while four opened the contacts already chosen for them.
 *
 * First a notice, large and in the middle of the screen. In two days it brought nobody to their contacts: of 29 people who got
 * them, three opened any, and those who came to search closed it and searched. Since 21 Nov 2026 (the owner: «hagamos el 3»,
 * «mostrar los recomendados dentro del buscador como resultados listos y no como aviso») the contacts themselves are on the page,
 * above the search, as results that are already there: who each one is, why, and «Enriquecer» in its row (SearchRecommended).
 *
 * `recommendedNoticeOf` and `recommendedResultsOf` read what «Hoy» reads (GET /api/lead-drops/latest): the person's last contacts
 * of the week with something left to do. Nothing left, nothing shown.
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
    const left = items.filter(waits).length;
    return left ? { id: board.id, total: items.length, left, today: board.date === today } : null;
  }
  const drop = latest?.drop;
  if (drop && typeof drop.id === 'string') {
    const total = count(drop.total), left = Math.min(count(drop.left), total);
    return left ? { id: drop.id, total, left, today: drop.dropDate === today } : null;
  }
  return null;
}

/** How many of the results are on screen before «Ver los N»: three rows leave the search in sight. */
export const RECOMMENDED_ROWS = 3;

type Row = Record<string, unknown> & { leadId: string };
/** As «Hoy» counts them: an email still to look up, or a campaign still to approve. */
const waits = (item: Record<string, unknown>) => !item.savedLeadId || Boolean(item.draft && !item.campaign);

/**
 * The contacts of several to show as results: the whole drop (the page keeps its rows as they change) and which of them wait, in
 * the order they came. A drop of one contact has no rows of its own here: `recommendedNoticeOf` says it in a line.
 */
export function recommendedResultsOf(latest: Latest, today: string): { id: string; date: string; today: boolean; items: Row[]; waiting: string[] } | null {
  const board = latest?.board;
  if (!board || typeof board.id !== 'string' || !Array.isArray(board.items)) return null;
  const items = board.items.filter((item): item is Row => Boolean(item) && typeof item === 'object' && typeof (item as Row).leadId === 'string');
  const waiting = items.filter(waits).map(item => item.leadId);
  return waiting.length ? { id: board.id, date: typeof board.date === 'string' ? board.date : '', today: board.date === today, items, waiting } : null;
}

/** The section's headline: how many wait, said large. */
export function recommendedNoticeTitle(notice: RecommendedNotice): string {
  if (notice.today && notice.left === notice.total) return notice.total === 1 ? 'Tienes un contacto recomendado para hoy' : `Tienes ${notice.total} contactos recomendados para hoy`;
  return notice.left === 1 ? 'Te espera un contacto recomendado' : `Te esperan ${notice.left} contactos recomendados`;
}

/** The section's headline while the person works through its rows: what is left, or that nothing is. */
export function recommendedResultsTitle(input: { total: number; left: number; today: boolean }): string {
  if (!input.left) return 'Listo: ya revisaste tus contactos recomendados';
  return recommendedNoticeTitle({ id: '', ...input });
}

/** «Ver los 6» and back. */
export const recommendedMoreLabel = (total: number, all: boolean) => (all ? 'Ver menos' : `Ver los ${total}`);

/** Where the person's choice to fold the section away is kept: by drop, so the next day's contacts are shown again. */
export const recommendedNoticeKey = (dropId: string) => `anton:search-recommended:${dropId}`;
