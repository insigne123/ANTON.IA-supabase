// What the audited browser may reach. Only the app (9005) and the local Supabase (54321) answer; any other host is aborted
// and recorded. App GETs pass through to the real server code. App writes are recorded and answered with a 503, so loading
// a page never sends mail, spends credits or calls a provider; the few endpoints listed in PASS_WRITES only touch the
// in-memory database and run for real.
export const BLOCKED_MESSAGE = 'Bloqueado por la auditoría visual: esta acción no se ejecuta durante el recorrido.';

/** Writes that only touch the local stand-in database: they run, and are still reported. */
const PASS_WRITES = [
  /^\/api\/onboarding\/tour$/,
  /^\/api\/leads\/search\/checkpoint$/,
  // Renaming and hiding a Cowork conversation only writes cowork_thread_settings.
  /^\/api\/cowork\/threads\/[0-9a-f-]{36}$/,
];
/** Reads sent as POST (a body with many ids): they run and are not reported. */
const PASS_READS = [
  /^\/api\/native-research\/status$/,
  /^\/api\/team-locks$/,
];

export function classify(request, { appOrigin, supabaseOrigin }) {
  const url = new URL(request.url());
  const method = request.method();
  if (url.protocol === 'data:' || url.protocol === 'blob:') return { action: 'continue' };
  if (url.origin === supabaseOrigin) return { action: 'continue', record: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? null : 'supabase-write' };
  if (url.origin !== appOrigin) return { action: 'abort', record: 'external' };
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { action: 'continue' };
  // Server actions run in-process (they can only reach loopback); they are recorded, not blocked.
  if (!url.pathname.startsWith('/api/')) return { action: 'continue', record: 'server-action' };
  if (PASS_READS.some(pattern => pattern.test(url.pathname))) return { action: 'continue' };
  if (PASS_WRITES.some(pattern => pattern.test(url.pathname))) return { action: 'continue', record: 'app-write' };
  return { action: 'block', record: 'app-write' };
}

export async function installPolicy(context, { appOrigin, supabaseOrigin, onRecord }) {
  await context.route('**/*', async route => {
    const request = route.request();
    const decision = classify(request, { appOrigin, supabaseOrigin });
    if (decision.record) onRecord({ kind: decision.record, method: request.method(), url: request.url(), blocked: decision.action !== 'continue' });
    if (decision.action === 'abort') return route.abort('blockedbyclient');
    if (decision.action === 'block') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: BLOCKED_MESSAGE }) });
    return route.continue();
  });
}

/**
 * Supabase Realtime over a mocked socket: joins succeed and echo each postgres_changes binding with an id, as the server
 * does, and heartbeats are answered. No change is ever pushed, so pages stay as loaded.
 */
export async function installRealtime(context) {
  if (typeof context.routeWebSocket !== 'function') return false;
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, ws => {
    ws.onMessage(raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const frame = Array.isArray(message)
        ? { join_ref: message[0], ref: message[1], topic: message[2], event: message[3], payload: message[4] }
        : message;
      const reply = payload => {
        const out = { topic: frame.topic, event: 'phx_reply', payload, ref: frame.ref, join_ref: frame.join_ref ?? frame.ref };
        ws.send(JSON.stringify(Array.isArray(message) ? [out.join_ref, out.ref, out.topic, out.event, out.payload] : out));
      };
      if (frame.event === 'phx_join') {
        const bindings = (frame.payload?.config?.postgres_changes || []).map((binding, index) => ({ ...binding, id: 1000 + index }));
        reply({ status: 'ok', response: { postgres_changes: bindings } });
      } else if (frame.event === 'heartbeat' || frame.event === 'access_token' || frame.event === 'phx_leave') {
        reply({ status: 'ok', response: {} });
      }
    });
  });
  return true;
}
