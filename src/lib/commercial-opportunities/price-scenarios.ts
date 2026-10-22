// How the price weighs in the score of a bid, and how far a rival can go: «un rival con tantos puntos en lo demás te gana si cobra menos de
// $X». It is the table the tender reviews were built around, for the most common formula of the bases: the lowest price gets all the
// points of the price criterion and every other offer gets the lowest price divided by its own, times those points.
// Pure: the page and the tests share it. Whether the bases use that formula is for the person to confirm; it is said on screen.

export type ScoreSetup = {
  /** What the price criterion is worth in the bases, in points. */
  priceWeight: number;
  /** The points we expect in everything that is not price (technical, term, seals, experience…). */
  ourOthers: number;
  /** The points a typical rival expects in the same; the most they can get is a safe assumption. */
  rivalOthers: number;
  /** Our total price, in the same terms the bases compare (net or with VAT). */
  ourPrice: number;
};

export const SCORE_EPSILON = 1e-9;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** The points of the price criterion for `price`, when `lowest` is the lowest price offered. */
export const priceScore = (weight: number, lowest: number, price: number) => (price > 0 && lowest > 0 ? (weight * Math.min(lowest, price)) / price : 0);

/** Why the setup cannot be computed, in words for the person; null when it can. */
export function scoreSetupProblem(setup: ScoreSetup): string | null {
  if (![setup.priceWeight, setup.ourOthers, setup.rivalOthers, setup.ourPrice].every(Number.isFinite)) return 'Revisa los números: alguno no es válido.';
  if (setup.priceWeight < 0 || setup.ourOthers < 0 || setup.rivalOthers < 0) return 'Los puntos no pueden ser negativos.';
  if (setup.priceWeight > 100) return 'El precio no puede valer más de 100 puntos.';
  if (setup.ourPrice <= 0) return 'Escribe tu precio total para comparar.';
  return null;
}

export type Matchup = {
  rivalPrice: number; ourPriceScore: number; rivalPriceScore: number; ourTotal: number; rivalTotal: number;
  /** Who gets more points; `tie` when they are even, which the bases settle with their own tie-break. */
  winner: 'us' | 'rival' | 'tie';
};

/** The score of our offer against one rival's price. */
export function matchup(setup: ScoreSetup, rivalPrice: number): Matchup {
  const lowest = Math.min(setup.ourPrice, rivalPrice);
  const ourPriceScore = priceScore(setup.priceWeight, lowest, setup.ourPrice);
  const rivalPriceScore = priceScore(setup.priceWeight, lowest, rivalPrice);
  const ourTotal = ourPriceScore + setup.ourOthers, rivalTotal = rivalPriceScore + setup.rivalOthers;
  const gap = ourTotal - rivalTotal;
  return { rivalPrice, ourPriceScore: round2(ourPriceScore), rivalPriceScore: round2(rivalPriceScore), ourTotal: round2(ourTotal), rivalTotal: round2(rivalTotal),
    winner: Math.abs(gap) < SCORE_EPSILON ? 'tie' : gap > 0 ? 'us' : 'rival' };
}

/** Where the rival wins: below `price` (strictly), never, or at any price. */
export type Threshold = { kind: 'below'; price: number } | { kind: 'never' } | { kind: 'always' };

/**
 * The price under which a rival with `rivalOthers` points in everything but price gets more points than we do. With a rival ahead in
 * the rest it is above our own price (they win even charging more); ahead of them, below it; even, exactly ours.
 */
export function rivalBeatsUsBelow(setup: ScoreSetup): Threshold {
  const { priceWeight: weight, ourPrice } = setup;
  const lead = setup.ourOthers - setup.rivalOthers;
  if (lead > 0) return weight - lead > SCORE_EPSILON ? { kind: 'below', price: (ourPrice * (weight - lead)) / weight } : { kind: 'never' };
  if (lead < 0) return weight + lead > SCORE_EPSILON ? { kind: 'below', price: (ourPrice * weight) / (weight + lead) } : { kind: 'always' };
  return weight > 0 ? { kind: 'below', price: ourPrice } : { kind: 'never' };
}

/** Our score against rivals priced around ours: each step is a share of our price (−0,2 = 20 % cheaper than us). */
export const RIVAL_STEPS = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.4] as const;
export function scenarioGrid(setup: ScoreSetup, steps: readonly number[] = RIVAL_STEPS): Array<Matchup & { step: number }> {
  return steps.map(step => ({ step, ...matchup(setup, setup.ourPrice * (1 + step)) }));
}

/** What changing our own price does to our total against a rival that charges `rivalPrice`. */
export function ourPriceMoves(setup: ScoreSetup, rivalPrice: number, steps: readonly number[] = [-0.1, -0.05, 0.05, 0.1]) {
  const base = matchup(setup, rivalPrice).ourTotal;
  return steps.map(step => {
    const price = setup.ourPrice * (1 + step);
    const next = matchup({ ...setup, ourPrice: price }, rivalPrice);
    return { step, price, ourTotal: next.ourTotal, change: round2(next.ourTotal - base), winner: next.winner };
  });
}

/** The threshold in a sentence: «Un rival con 10 puntos más que tú en lo demás te gana si cobra menos de $X (80 % más)». */
export function thresholdSentence(setup: ScoreSetup, format: (value: number) => string) {
  const threshold = rivalBeatsUsBelow(setup);
  const lead = setup.ourOthers - setup.rivalOthers;
  const who = lead < 0 ? `Un rival con ${format(-lead)} ${-lead === 1 ? 'punto' : 'puntos'} más que tú en lo demás` : lead > 0 ? `Un rival con ${format(lead)} ${lead === 1 ? 'punto' : 'puntos'} menos que tú en lo demás` : 'Un rival igual a ti en lo demás';
  if (threshold.kind === 'always') return `${who} te gana a cualquier precio: el precio no alcanza para compensar esa diferencia.`;
  if (threshold.kind === 'never') return `${who} no te alcanza ni cobrando casi nada: tu ventaja en lo demás es mayor que lo que vale el precio.`;
  const share = (threshold.price / setup.ourPrice - 1) * 100;
  const relative = Math.abs(share) < 0.05 ? 'tu mismo precio' : `${format(Math.round(Math.abs(share) * 10) / 10)} % ${share > 0 ? 'más' : 'menos'} que tú`;
  return `${who} te gana si cobra menos de $${format(Math.round(threshold.price))} (${relative}).`;
}
