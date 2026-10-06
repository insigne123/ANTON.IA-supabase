// The visual audit's local Supabase: PostgREST (`postgrest.mjs`), the parts of GoTrue the app touches, RPC fixtures and a few
// control endpoints. It listens on 127.0.0.1 only and keeps everything in memory: nothing here reaches a real service.
import http from 'node:http';
import { createStore, handleRest } from './postgrest.mjs';
import { sessionFor } from './session.mjs';

const json = value => (value === undefined ? '' : JSON.stringify(value));
const decodeJwt = token => {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
};

/**
 * `datasets` maps a name to `{ tables, rpc, embeds }` as built by `fixtures/index.mjs`. `personas` maps a user id to its auth
 * user object. `serviceKey` is the bearer server code uses with the service role.
 */
export function startFakeSupabase({ port = 54321, datasets, personas, serviceKey, onLog = () => {} }) {
  let datasetName = 'full';
  let dataset = datasets[datasetName];
  let store = createStore(dataset.tables);
  const faults = new Map();
  const requests = [];
  const log = entry => { onLog(entry); };

  const reset = name => {
    datasetName = name || datasetName;
    dataset = datasets[datasetName];
    store = createStore(dataset.tables);
    faults.clear();
    requests.length = 0;
  };
  const caller = req => {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (bearer && bearer === serviceKey) return { service: true, user: null };
    const claims = decodeJwt(bearer);
    return { service: false, user: claims?.sub ? personas[claims.sub] || null : null };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': req.headers.origin || '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-expose-headers': 'content-range, content-profile, x-total-count',
        ...headers,
      });
      res.end(req.method === 'HEAD' ? undefined : json(body));
    };
    if (req.method === 'OPTIONS') return send(204);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let body;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) { try { body = JSON.parse(text); } catch { body = text; } }
      const who = caller(req);
      requests.push({ method: req.method, path: url.pathname, search: url.search, service: who.service, user: who.user?.id || null });

      // Control endpoints (the runner only).
      if (url.pathname === '/__reset') { reset(body?.dataset); return send(200, { ok: true, dataset: datasetName }); }
      if (url.pathname === '/__fault') { faults.set(body.target, { status: body.status || 500, remaining: body.count ?? 1000 }); return send(200, { ok: true }); }
      if (url.pathname === '/__log') return send(200, { dataset: datasetName, log: store.log, requests });

      // GoTrue: the user behind the bearer, token refresh, logout, password recovery, admin reads.
      if (url.pathname === '/auth/v1/user') {
        if (req.method === 'PUT') return who.user ? send(200, { ...who.user, ...(body?.data ? { user_metadata: { ...who.user.user_metadata, ...body.data } } : {}) }) : send(401, { code: 401, msg: 'Invalid token' });
        return who.user ? send(200, who.user) : send(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      }
      if (url.pathname === '/auth/v1/token') {
        // Refresh by the persona the refresh token names; password sign-in by email (any password).
        const byRefresh = String(body?.refresh_token || '').startsWith('audit-refresh:') ? personas[String(body.refresh_token).slice('audit-refresh:'.length)] : null;
        const byEmail = body?.email ? Object.values(personas).find(user => user.email === String(body.email).toLowerCase()) : null;
        const user = byRefresh || byEmail;
        return user ? send(200, sessionFor(user)) : send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      if (url.pathname === '/auth/v1/logout') return send(204);
      if (url.pathname === '/auth/v1/recover' || url.pathname === '/auth/v1/otp') return send(200, {});
      if (url.pathname.startsWith('/auth/v1/admin/users')) {
        const id = url.pathname.split('/')[5];
        if (id) return personas[id] ? send(200, personas[id]) : send(404, { code: 404, msg: 'User not found' });
        return send(200, { users: Object.values(personas), aud: 'authenticated' });
      }
      if (url.pathname.startsWith('/auth/v1/')) return send(200, {});
      // Storage: only the objects the fixtures keep (`storage`, by «bucket/path»), read only; anything else is not there.
      if (url.pathname.startsWith('/storage/v1/')) {
        const key = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\/(?:authenticated\/|public\/)?/, ''));
        const object = req.method === 'GET' || req.method === 'HEAD' ? dataset.storage?.[key] : null;
        if (!object) return send(404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        res.writeHead(200, { 'content-type': object.type, 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-credentials': 'true' });
        return res.end(req.method === 'HEAD' ? undefined : object.body);
      }

      // RPC
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.slice('/rest/v1/rpc/'.length);
        const fault = faults.get(`rpc:${name}`);
        if (fault && fault.remaining-- > 0) return send(fault.status, { code: 'AUDIT', message: `Falla inyectada en ${name}` });
        const handler = dataset.rpc?.[name];
        if (!handler) { store.log.push({ kind: 'rpc-unfixtured', name }); log({ kind: 'rpc-unfixtured', name }); return send(200, null); }
        const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : (body || {});
        try { return send(200, handler(args, { store, user: who.user, service: who.service })); } catch (error) { return send(400, { code: 'AUDIT', message: String(error.message || error) }); }
      }

      // PostgREST
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.slice('/rest/v1/'.length);
        const fault = faults.get(table);
        if (fault && fault.remaining-- > 0) return send(fault.status, { code: 'AUDIT', message: `Falla inyectada en ${table}` });
        const result = handleRest({
          store, method: req.method, table, search: url.searchParams, body,
          prefer: String(req.headers.prefer || ''), accept: String(req.headers.accept || ''), range: String(req.headers.range || ''),
          embeds: dataset.embeds, onLog: log,
        });
        return send(result.status, result.body, result.headers || {});
      }
      return send(404, { message: 'Not found in the audit stand-in' });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port, reset, requests, get store() { return store; },
      close: () => new Promise(done => server.close(() => done())),
    }));
  });
}
