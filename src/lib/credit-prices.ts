/**
 * What an email, a phone and both together cost an organization, in credits (20 Nov 2026). Every organization paid the same,
 * written in the code; a customer's contract can say otherwise (5 for a phone, 6 with its email), so each one can have its own
 * (table organization_credit_prices, read by src/lib/server/credit-prices.ts). An organization with its own prices is counted
 * at them everywhere: the buttons, the checks before a lookup and the database (apollo_credit_allocation_status_v3).
 *
 * One without a row stays exactly as it was: the screens say 1 for the email and 8 for the phone or for both (the phone's
 * lookup brings the email, audit T5), while the database has always counted the two added, 9 (v1, v2 and now v3). That
 * difference is older than this file and is the owner's to settle: a row of 1, 8 and 8 makes the database count 8, and
 * `both: 9` below makes the screens say 9. Pure: the screens, the server and the tests share it.
 */
export type CreditPrices = { email: number; phone: number; both: number };

export const DEFAULT_CREDIT_PRICES: CreditPrices = { email: 1, phone: 8, both: 8 };

const price = (value: unknown, fallback: number, max = 100) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
};

/**
 * The prices of a row, or of an answer of the server. A row without prices (an organization that has none of its own) is the
 * default; in one that has them, both together cost what it says, or the two added when it says nothing.
 */
export function creditPricesOf(row: unknown): CreditPrices {
  const source = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const email = source.email ?? source.email_credits, phone = source.phone ?? source.phone_credits;
  if (email == null && phone == null) return DEFAULT_CREDIT_PRICES;
  const own = { email: price(email, DEFAULT_CREDIT_PRICES.email), phone: price(phone, DEFAULT_CREDIT_PRICES.phone) };
  return { ...own, both: price(source.both ?? source.both_credits, own.email + own.phone, 200) };
}

/** What a lookup costs: the email, the phone, or both together. */
export function creditCost(fields: { revealEmail: boolean; revealPhone: boolean }, prices: CreditPrices = DEFAULT_CREDIT_PRICES) {
  if (fields.revealEmail && fields.revealPhone) return prices.both;
  return fields.revealPhone ? prices.phone : fields.revealEmail ? prices.email : 0;
}

/**
 * What the database counts for a lookup, for the reports that must add up with it: at the organization's own prices when it
 * has them (`own`), and otherwise the two added, 1 and 8, as apollo_credit_allocation_status_v3 does.
 */
export function countedCreditCost(fields: { revealEmail: boolean; revealPhone: boolean }, own: CreditPrices | null) {
  return own ? creditCost(fields, own) : (fields.revealEmail ? 1 : 0) + (fields.revealPhone ? 8 : 0);
}

/** «1 crédito», «5 créditos». */
export const creditsLabel = (amount: number) => `${amount.toLocaleString('es-CL')} ${amount === 1 ? 'crédito' : 'créditos'}`;
