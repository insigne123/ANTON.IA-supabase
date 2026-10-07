type Session = { access_token: string; user: { id: string } };
type SessionResult = { data: { session: Session | null }; error?: unknown };
type Dependencies = {
  getSession: () => Promise<SessionResult>;
  refreshSession: () => Promise<SessionResult>;
  fetch: typeof fetch;
};

/** Forward the browser's current session to our own BFF. Retry only a definitive
 * pre-authentication 401, once, with the same body/idempotency key and person.
 * Never replay permission failures, network errors or uncertain provider work. */
export function createAuthenticatedApiFetch(deps: Dependencies) {
  let refreshing: Promise<SessionResult> | null = null;
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (!/^\/api\//.test(path) || /[\\\u0000-\u001f]/.test(path)) throw new Error('API_PATH_NOT_ALLOWED');
    const session = (await deps.getSession()).data.session;
    const send = (token?: string) => {
      const headers = new Headers(init.headers);
      headers.delete('Authorization');
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return deps.fetch(path, { ...init, headers, credentials: 'same-origin' });
    };
    const response = await send(session?.access_token);
    if (response.status !== 401 || !session || init.signal?.aborted
      || (init.body != null && typeof init.body !== 'string')) return response;
    const body = await response.clone().json().catch(() => null);
    // These are emitted before any quota reservation or provider work.
    if (!body || !['AUTH_SESSION_EXPIRED', 'Unauthorized'].includes(body.code || body.error)) return response;
    if (!refreshing) {
      const pending = deps.refreshSession();
      refreshing = pending;
      void pending.then(() => { if (refreshing === pending) refreshing = null; }, () => { if (refreshing === pending) refreshing = null; });
    }
    const refreshed = await refreshing.catch(() => null);
    const next = refreshed?.data.session;
    if (refreshed?.error || !next || next.user.id !== session.user.id || init.signal?.aborted) return response;
    return send(next.access_token);
  };
}

const sessionClient = async () => typeof window === 'undefined' ? null : (await import('./supabase')).supabase;
const sessionFetch = createAuthenticatedApiFetch({
  getSession: async () => (await sessionClient())?.auth.getSession() || { data: { session: null } },
  refreshSession: async () => (await sessionClient())?.auth.refreshSession() || { data: { session: null } },
  fetch: (input, init) => globalThis.fetch(input, init),
});
export const authenticatedApiFetch = sessionFetch;
