// How well an opportunity fits the company, as one to five stars, so a person can skim thousands of them. The pipeline and the
// list share it. Pure: the page, the API and the tests read the same thing.

/**
 * The score (0–100) the AI and the search profile give each opportunity: the words and codes that match, the amount, the region,
 * the time left and the AI's verdict. The cuts follow what production holds: what the AI recommends scores 55–90 (half of it 80
 * or more), what it asks to review spreads from 1 to 85 (median 35, one in twenty above 70) and what it leaves out stays at 10 or below.
 */
export const PRIORITY_STEPS = [
  { stars: 5, from: 80, label: 'Calza muy bien con tu oferta' },
  { stars: 4, from: 65, label: 'Calza bien con tu oferta' },
  { stars: 3, from: 50, label: 'Calza en parte: vale la pena revisarla' },
  { stars: 2, from: 30, label: 'Calza poco con tu oferta' },
  { stars: 1, from: 0, label: 'Calza muy poco con tu oferta' },
] as const;
export type Stars = typeof PRIORITY_STEPS[number]['stars'];

/** One to five stars for a score; a missing or broken score is one star, never a crash or a blank. */
export function starsFor(score: number | null | undefined): Stars {
  const value = Number(score);
  if (!Number.isFinite(value)) return 1;
  return PRIORITY_STEPS.find(step => value >= step.from)?.stars ?? 1;
}

export const starLabel = (stars: Stars) => PRIORITY_STEPS.find(step => step.stars === stars)!.label;

/** What «Calce ★★★★☆» says in words, for the screen readers and the tooltip. */
export const starsText = (score: number | null | undefined) => { const stars = starsFor(score); return `Calce ${stars} de 5: ${starLabel(stars).toLowerCase()}`; };

/** The two ways to read thousands: by how well they fit, or by how soon they close. */
export type PrioritySort = 'priority' | 'deadline';
export const PRIORITY_SORTS: ReadonlyArray<{ id: PrioritySort; label: string; hint: string }> = [
  { id: 'priority', label: 'Prioridad', hint: 'Primero las que mejor calzan con tu oferta; con las mismas estrellas, las que cierran antes.' },
  { id: 'deadline', label: 'Cierran antes', hint: 'Primero las que cierran antes; con la misma fecha, las que mejor calzan.' },
];
export const parsePrioritySort = (value: unknown): PrioritySort => value === 'deadline' ? 'deadline' : 'priority';

type Ranked = { id: string; score: number; days: number | null };
const byDays = (a: Ranked, b: Ranked) => (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER);
/** The order of the cards: most stars first and, among the same stars, the soonest to close; or the soonest first and, on the same day, the most stars. */
export function comparePriority(sort: PrioritySort) {
  return (a: Ranked, b: Ranked) => sort === 'deadline'
    ? byDays(a, b) || (b.score - a.score) || a.id.localeCompare(b.id)
    : (starsFor(b.score) - starsFor(a.score)) || byDays(a, b) || (b.score - a.score) || a.id.localeCompare(b.id);
}
