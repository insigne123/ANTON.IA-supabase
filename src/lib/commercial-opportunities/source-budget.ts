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

/**
 * What one LinkedIn search may spend, in USD: the source the workspace put first gets the most, the other one less. The
 * workspace's monthly cap still rules over every run. At USD0.002 a post and USD0.005 an ad, 0.40 buys 78 ads or 150
 * posts (30 for each of five queries); 0.15, 28 ads or 70 posts.
 */
export function linkedinRunCap(priority: string, kind: 'posts' | 'hiring') {
  if (priority === 'balanced') return .3;
  return priority === kind ? .4 : .15;
}

/**
 * How far back a LinkedIn search looks: the last day of ads (the last week of posts) when the source ran recently, and
 * the last week (month) when it has not, so a few days without searching leave no gap.
 */
export function linkedinWindow(kind: 'posts' | 'hiring', lastRunAt: string | null, now = Date.now()) {
  const since = lastRunAt ? now - Date.parse(lastRunAt) : Number.POSITIVE_INFINITY;
  if (kind === 'hiring') return since > 22 * 3_600_000 ? '7d' as const : '24h' as const;
  return since > 6 * 86_400_000 ? 'month' as const : 'week' as const;
}
