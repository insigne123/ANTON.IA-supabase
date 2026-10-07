import { normalizeSavedSearchCriteria, type LeadSearchFilters } from './saved-search-criteria';

type Scope = { userId: string; organizationId: string | null } | null;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (scope: NonNullable<Scope>) => `antonia:search:reauth:${scope.userId}:${scope.organizationId || ''}`;
const TTL = 20 * 60_000;

/** Only criteria, never result rows or authentication material; same person and
 * team can recover once after signing in. Blocked storage never blocks login. */
export function saveSearchReauthCriteria(store: Store, scope: Scope, filters: LeadSearchFilters, now = Date.now()) {
  if (!scope) return;
  try {
    const value = JSON.stringify({ at: now, filters: normalizeSavedSearchCriteria(filters) });
    if (value.length <= 20000) store.setItem(key(scope), value);
  } catch { /* Private mode/full storage: still allow sign-in. */ }
}

export function consumeSearchReauthCriteria(store: Store, scope: Scope, now = Date.now()): LeadSearchFilters | null {
  if (!scope) return null;
  try {
    const raw = store.getItem(key(scope));
    if (!raw) return null;
    store.removeItem(key(scope));
    if (raw.length > 20000) return null;
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.at) || now < value.at || now - value.at > TTL || !value.filters || typeof value.filters !== 'object') return null;
    return normalizeSavedSearchCriteria(value.filters);
  } catch { return null; }
}
