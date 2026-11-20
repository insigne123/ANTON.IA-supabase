import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CREDIT_PRICES, countedCreditCost, creditCost, creditPricesOf, creditsLabel } from './credit-prices';

test('an organization without prices of its own keeps what the screens always said: 1, 8, and 8 for both', () => {
  assert.deepEqual(DEFAULT_CREDIT_PRICES, { email: 1, phone: 8, both: 8 });
  for (const row of [null, undefined, {}, 'x', { email_credits: null, phone_credits: null, both_credits: null }]) assert.deepEqual(creditPricesOf(row), DEFAULT_CREDIT_PRICES);
  assert.deepEqual([creditCost({ revealEmail: true, revealPhone: false }), creditCost({ revealEmail: false, revealPhone: true }),
    creditCost({ revealEmail: true, revealPhone: true }), creditCost({ revealEmail: false, revealPhone: false })], [1, 8, 8, 0]);
});

test('an organization with its own prices: both together cost what its row says, or the two added', () => {
  assert.deepEqual(creditPricesOf({ email_credits: 1, phone_credits: 5 }), { email: 1, phone: 5, both: 6 });
  assert.deepEqual(creditPricesOf({ email_credits: 1, phone_credits: 5, both_credits: null }), { email: 1, phone: 5, both: 6 });
  assert.deepEqual(creditPricesOf({ email_credits: 1, phone_credits: 8, both_credits: 8 }), { email: 1, phone: 8, both: 8 });
  assert.deepEqual(creditPricesOf({ email: '2', phone: 5, both: 6 }), { email: 2, phone: 5, both: 6 }, 'as the app\'s own answer carries them');
  assert.deepEqual(creditPricesOf({ email_credits: 0, phone_credits: 0 }), { email: 0, phone: 0, both: 0 }, 'free is a price');
  // What is out of range or not a whole number keeps the default of that field.
  assert.deepEqual(creditPricesOf({ email_credits: -1, phone_credits: 5.5, both_credits: 900 }), { email: 1, phone: 8, both: 9 });
  const own = { email: 1, phone: 5, both: 6 };
  assert.deepEqual([creditCost({ revealEmail: true, revealPhone: false }, own), creditCost({ revealEmail: false, revealPhone: true }, own), creditCost({ revealEmail: true, revealPhone: true }, own)], [1, 5, 6]);
});

test('the reports count a lookup as the database does: at the organization\'s own prices, or 1 and 8 added', () => {
  const both = { revealEmail: true, revealPhone: true };
  assert.equal(countedCreditCost(both, null), 9);
  assert.equal(countedCreditCost({ revealEmail: false, revealPhone: true }, null), 8);
  assert.equal(countedCreditCost(both, { email: 1, phone: 5, both: 6 }), 6);
  assert.equal(countedCreditCost(both, { email: 1, phone: 8, both: 8 }), 8);
});

test('credits are said in singular and plural', () => {
  assert.deepEqual([creditsLabel(1), creditsLabel(5), creditsLabel(0), creditsLabel(2500)], ['1 crédito', '5 créditos', '0 créditos', '2.500 créditos']);
});
