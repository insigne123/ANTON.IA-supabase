// The person and organization of the last session in this browser (ids only, never tokens). AuthProvider reads it on
// the first render so the storage scopes are right before any screen reads drafts, research or quota, and so the app
// does not mount twice when the session resolves to the same person and organization.
import { getBrowserStorage } from './browser-storage';

const KEY = 'anton.auth-scope.v1';

export type AuthScope = { userId: string; organizationId: string | null };

export function readCachedAuthScope(storage: Storage | null = getBrowserStorage()): AuthScope | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(KEY) || 'null');
    const userId = typeof value?.userId === 'string' ? value.userId.trim() : '';
    if (!userId) return null;
    const organizationId = typeof value.organizationId === 'string' && value.organizationId.trim() ? value.organizationId.trim() : null;
    return { userId, organizationId };
  } catch {
    return null;
  }
}

export function writeCachedAuthScope(scope: AuthScope | null, storage: Storage | null = getBrowserStorage()) {
  if (!storage) return;
  try {
    if (!scope?.userId) storage.removeItem(KEY);
    else storage.setItem(KEY, JSON.stringify({ userId: scope.userId, organizationId: scope.organizationId || null }));
  } catch {
    // Private mode or a full storage: the app just mounts once more when the session resolves.
  }
}

/** The key AuthProvider remounts the app on: a different person or organization starts every screen from scratch. */
export function authScopeKey(scope: { userId?: string | null; organizationId?: string | null } | null) {
  return `${scope?.userId || 'anonymous'}:${scope?.organizationId || 'personal'}`;
}
