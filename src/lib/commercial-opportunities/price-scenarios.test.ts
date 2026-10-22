import assert from 'node:assert/strict';
import test from 'node:test';
import { matchup, ourPriceMoves, priceScore, rivalBeatsUsBelow, scenarioGrid, scoreSetupProblem, thresholdSentence, type ScoreSetup } from './price-scenarios';

const near = (actual: number, expected: number, digits = 2) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≉ ${expected}`);
const fmt = (value: number) => value.toLocaleString('es-CL', { maximumFractionDigits: 1 });

// The reviews of a municipal Compra Ágil (price worth 50 points; the lowest price takes them all): our offer at $3,6 MM, a rival with the
// full 30 technical and 20 term points (50 in everything but price) against our 28, 34, 36 and 42 as the commitments grow. The review
// computed the price under which that rival wins as $6,43 MM, $5,29 MM, $5,00 MM and $4,29 MM.
test('a rival with the full technical score beats us below the prices the review computed', () => {
  for (const [others, expected] of [[28, 6.43], [34, 5.29], [36, 5.0], [42, 4.29]] as const) {
    const threshold = rivalBeatsUsBelow({ priceWeight: 50, ourOthers: others, rivalOthers: 50, ourPrice: 3.6 });
    assert.equal(threshold.kind, 'below');
    near((threshold as { price: number }).price, expected);
  }
});

test('the threshold is the price where both end even: a cent below it the rival wins, a cent above we do', () => {
  for (const setup of [
    { priceWeight: 50, ourOthers: 28, rivalOthers: 50, ourPrice: 3_600_000 }, { priceWeight: 60, ourOthers: 35, rivalOthers: 30, ourPrice: 100 }, { priceWeight: 40, ourOthers: 10, rivalOthers: 10, ourPrice: 250 },
  ] satisfies ScoreSetup[]) {
    const threshold = rivalBeatsUsBelow(setup);
    assert.equal(threshold.kind, 'below');
    const price = (threshold as { price: number }).price;
    assert.equal(matchup(setup, price).winner, 'tie', 'even at the threshold');
    assert.equal(matchup(setup, price * 0.999).winner, 'rival');
    assert.equal(matchup(setup, price * 1.001).winner, 'us');
  }
});

test('when we are ahead in the rest the rival has to be cheaper than us; when the rest decides everything, the price cannot save anyone', () => {
  const ahead = { priceWeight: 50, ourOthers: 40, rivalOthers: 30, ourPrice: 1000 };
  near((rivalBeatsUsBelow(ahead) as { price: number }).price, 800, 6);
  assert.deepEqual(rivalBeatsUsBelow({ ...ahead, ourOthers: 80 }), { kind: 'never' }, 'a lead as big as the price criterion');
  assert.deepEqual(rivalBeatsUsBelow({ ...ahead, ourOthers: 90 }), { kind: 'never' });
  assert.deepEqual(rivalBeatsUsBelow({ priceWeight: 50, ourOthers: 0, rivalOthers: 50, ourPrice: 1000 }), { kind: 'always' }, 'behind by as much as the price is worth');
  assert.deepEqual(rivalBeatsUsBelow({ priceWeight: 50, ourOthers: 0, rivalOthers: 60, ourPrice: 1000 }), { kind: 'always' });
  assert.deepEqual(rivalBeatsUsBelow({ priceWeight: 50, ourOthers: 20, rivalOthers: 20, ourPrice: 1000 }), { kind: 'below', price: 1000 }, 'even: only a cheaper rival wins');
  assert.deepEqual(rivalBeatsUsBelow({ priceWeight: 0, ourOthers: 20, rivalOthers: 20, ourPrice: 1000 }), { kind: 'never' });
  assert.deepEqual(rivalBeatsUsBelow({ priceWeight: 0, ourOthers: 10, rivalOthers: 20, ourPrice: 1000 }), { kind: 'always' });
});

test('the lowest price takes all the points of the price criterion and the others get their share of it', () => {
  assert.equal(priceScore(50, 100, 100), 50);
  assert.equal(priceScore(50, 100, 200), 25);
  assert.equal(priceScore(50, 100, 0), 0);
  const setup = { priceWeight: 50, ourOthers: 28, rivalOthers: 50, ourPrice: 3.6 };
  assert.deepEqual(matchup(setup, 6.43 * 1.0001), { rivalPrice: 6.43 * 1.0001, ourPriceScore: 50, rivalPriceScore: 27.99, ourTotal: 78, rivalTotal: 77.99, winner: 'us' });
  const cheaper = matchup(setup, 1.8);
  assert.deepEqual([cheaper.ourPriceScore, cheaper.rivalPriceScore, cheaper.ourTotal, cheaper.rivalTotal, cheaper.winner], [25, 50, 53, 100, 'rival']);
  assert.equal(matchup(setup, 3.6).ourPriceScore, 50);
});

test('the grid puts rivals around our price, and cheaper than us costs us points', () => {
  const grid = scenarioGrid({ priceWeight: 50, ourOthers: 30, rivalOthers: 30, ourPrice: 1000 });
  assert.deepEqual(grid.map(row => row.step), [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.4]);
  assert.deepEqual(grid.map(row => row.winner), ['rival', 'rival', 'rival', 'tie', 'us', 'us', 'us']);
  near(grid[0].ourPriceScore, 35, 1);
  assert.equal(grid[3].ourTotal, grid[3].rivalTotal);
});

test('lowering our price against a rival that charges more than we do changes nothing once we are the cheapest; against a cheaper one it adds points', () => {
  const setup = { priceWeight: 50, ourOthers: 30, rivalOthers: 30, ourPrice: 1000 };
  const against = ourPriceMoves(setup, 900);
  assert.deepEqual(against.map(move => move.step), [-0.1, -0.05, 0.05, 0.1]);
  assert.ok(against[0].change > 0 && against[1].change > 0, 'cheaper means more points while the rival is under us');
  assert.ok(against[2].change < 0 && against[3].change < 0);
  assert.equal(against[0].winner, 'tie', '−10 % of 1000 is exactly the rival\'s 900');
  const over = ourPriceMoves(setup, 1050);
  assert.deepEqual(over.slice(0, 2).map(move => move.change), [0, 0], 'already the lowest: lowering the price gives no more points');
  assert.equal(over[2].change, 0, 'raising it up to the rival\'s price still costs nothing');
  assert.ok(over[3].change < 0, 'but raising it past the rival costs');
});

test('what cannot be computed says why', () => {
  assert.equal(scoreSetupProblem({ priceWeight: 50, ourOthers: 28, rivalOthers: 50, ourPrice: 3.6 }), null);
  assert.match(scoreSetupProblem({ priceWeight: 50, ourOthers: 28, rivalOthers: 50, ourPrice: 0 })!, /Escribe tu precio/);
  assert.match(scoreSetupProblem({ priceWeight: 120, ourOthers: 0, rivalOthers: 0, ourPrice: 1 })!, /100 puntos/);
  assert.match(scoreSetupProblem({ priceWeight: 50, ourOthers: -1, rivalOthers: 0, ourPrice: 1 })!, /negativos/);
  assert.match(scoreSetupProblem({ priceWeight: NaN, ourOthers: 1, rivalOthers: 0, ourPrice: 1 })!, /Revisa/);
});

test('the answer is one sentence a person can read aloud', () => {
  assert.equal(thresholdSentence({ priceWeight: 50, ourOthers: 28, rivalOthers: 50, ourPrice: 3_600_000 }, fmt),
    'Un rival con 22 puntos más que tú en lo demás te gana si cobra menos de $6.428.571 (78,6 % más que tú).');
  assert.equal(thresholdSentence({ priceWeight: 50, ourOthers: 40, rivalOthers: 30, ourPrice: 1000 }, fmt),
    'Un rival con 10 puntos menos que tú en lo demás te gana si cobra menos de $800 (20 % menos que tú).');
  assert.match(thresholdSentence({ priceWeight: 50, ourOthers: 20, rivalOthers: 20, ourPrice: 1000 }, fmt), /^Un rival igual a ti en lo demás te gana si cobra menos de \$1\.000 \(tu mismo precio\)\.$/);
  assert.match(thresholdSentence({ priceWeight: 50, ourOthers: 0, rivalOthers: 60, ourPrice: 1000 }, fmt), /te gana a cualquier precio/);
  assert.match(thresholdSentence({ priceWeight: 50, ourOthers: 90, rivalOthers: 0, ourPrice: 1000 }, fmt), /no te alcanza ni cobrando casi nada/);
  assert.match(thresholdSentence({ priceWeight: 50, ourOthers: 29, rivalOthers: 30, ourPrice: 1000 }, fmt), /^Un rival con 1 punto más que tú/);
});
