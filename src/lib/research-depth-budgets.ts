/**
 * Depth budgets for questionnaire-driven research.
 *
 * Each depth caps the amount of work a single research pass may request:
 * searches (planned queries), pages (fetched sources), evidence (facts kept
 * for the model-facing projection) and model stages (reason + write + audit).
 * Full payloads and audit provenance are never trimmed; budgets only bound
 * the model-facing projection and the plan normalization below.
 */

export type ResearchDepth = 'express' | 'standard' | 'deep';

export type ResearchDepthBudget = {
  depth: ResearchDepth;
  /** Max search queries emitted by the plan normalization. */
  maxQueries: number;
  /** Max pages/sources fetched for the pass. */
  maxPages: number;
  /** Max evidence facts projected to model stages. */
  maxEvidence: number;
  /** Max model stages allowed for the pass (reason, write, audit, rewrite). */
  maxModelStages: number;
  /** Max queries kept per query family. */
  maxPerFamily: number;
  /** Max queries allowed against the company's own domain. */
  maxOwnDomain: number;
};

export const RESEARCH_DEPTH_BUDGETS: Record<ResearchDepth, ResearchDepthBudget> = {
  // Express still covers every required query family (7) with one query each.
  express: { depth: 'express', maxQueries: 7, maxPages: 10, maxEvidence: 24, maxModelStages: 2, maxPerFamily: 1, maxOwnDomain: 1 },
  standard: { depth: 'standard', maxQueries: 10, maxPages: 18, maxEvidence: 48, maxModelStages: 3, maxPerFamily: 2, maxOwnDomain: 2 },
  deep: { depth: 'deep', maxQueries: 12, maxPages: 28, maxEvidence: 80, maxModelStages: 4, maxPerFamily: 3, maxOwnDomain: 2 },
};

export const RESEARCH_DEPTHS: ResearchDepth[] = ['express', 'standard', 'deep'];

export function normalizeResearchDepth(value: unknown): ResearchDepth {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'express' || normalized === 'standard' || normalized === 'deep') return normalized;
  return 'standard';
}

export function getResearchDepthBudget(depth?: unknown): ResearchDepthBudget {
  return RESEARCH_DEPTH_BUDGETS[normalizeResearchDepth(depth)];
}

/** Maps the qualification gate depth to a research depth. Fail-closed: unknown maps to cheapest. */
export function depthFromAllowedDepth(value: unknown): ResearchDepth {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'deep') return 'deep';
  if (normalized === 'shallow') return 'standard';
  return 'express';
}

/**
 * Caps an ordered query list to a depth budget, deterministically.
 * Required families are kept first so depth caps never weaken the
 * required-field fallbacks added by the plan normalization.
 */
export function capQueriesForDepth<T extends { family: string; ownDomain?: boolean }>(
  queries: T[],
  depth?: unknown,
  options?: { maxQueries?: number; requiredFamilies?: string[] },
): T[] {
  const budget = getResearchDepthBudget(depth);
  const maxQueries = Math.max(1, Math.trunc(Number(options?.maxQueries) || budget.maxQueries));
  const required = new Set((options?.requiredFamilies || []).map((family) => family.toLowerCase()));
  const kept: T[] = [];
  const perFamily = new Map<string, number>();
  let ownDomainCount = 0;
  const fits = (query: T): boolean => {
    const family = String(query.family).toLowerCase();
    if ((perFamily.get(family) || 0) >= budget.maxPerFamily) return false;
    if (query.ownDomain && ownDomainCount >= budget.maxOwnDomain) return false;
    return true;
  };
  const push = (query: T): void => {
    const family = String(query.family).toLowerCase();
    perFamily.set(family, (perFamily.get(family) || 0) + 1);
    if (query.ownDomain) ownDomainCount += 1;
    kept.push(query);
  };
  queries.forEach((query) => {
    if (required.has(String(query.family).toLowerCase()) && kept.length < maxQueries && fits(query)) push(query);
  });
  queries.forEach((query) => {
    if (!required.has(String(query.family).toLowerCase()) && kept.length < maxQueries && fits(query)) push(query);
  });
  return kept;
}
