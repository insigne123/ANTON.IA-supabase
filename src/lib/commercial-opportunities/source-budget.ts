/** Price arithmetic in microUSD so USD0.06 admits ten USD0.005 items plus the USD0.01 start. */
export function opportunitySourceItemLimit(input: { cap: number; price: number; start: number; queries?: number; emptyQuery?: number; max: number }) {
  const { cap, price, start, queries = 1, emptyQuery = 0, max } = input;
  if (![cap, price, start, emptyQuery].every(Number.isFinite) || cap <= 0 || price <= 0 || start < 0 || emptyQuery < 0
    || !Number.isSafeInteger(queries) || queries < 1 || !Number.isSafeInteger(max) || max < 1) return 0;
  const microCap = Math.floor(cap * 1e6);
  const microPrice = Math.ceil(price * 1e6);
  const fixed = Math.ceil(start * 1e6) + queries * Math.ceil(emptyQuery * 1e6);
  if (![microCap, microPrice, fixed, microPrice * queries].every(Number.isSafeInteger)) return 0;
  return Math.max(0, Math.min(max, Math.floor((microCap - fixed) / (microPrice * queries))));
}
