// Simple bus de logs en memoria (dev)
type Side = 'server' | 'client';
export type DebugLog = {
  ts: string;
  side: Side;
  name: string;
  durationMs?: number;
  request: { method: string; url: string; headers?: any; body?: any };
  response?: { status: number; headers?: any; bodySnippet?: string };
  error?: string;
};

const LOG_LIMIT = 200;
const g: any = globalThis as any;
g.__DEBUG_LOGS ||= [] as DebugLog[];
export const __LOGS: DebugLog[] = g.__DEBUG_LOGS;

const SENSITIVE = ['authorization','x-api-key','cookie','set-cookie','proxy-authorization','apikey','token','access_token','refresh_token'];

function redactHeaders(h?: any) {
  if (!h) return undefined;
  const obj: Record<string, string> = {};
  // Headers puede ser objeto, array o Headers
  const entries = h instanceof Headers ? Array.from(h.entries()) : Object.entries(h);
  for (const [k,v] of entries) {
    const key = String(k).toLowerCase();
    obj[key] = SENSITIVE.includes(key) ? '***redacted***' : String(v);
  }
  return obj;
}

function redactBody(b: any) {
  try {
    if (!b) return undefined;
    const json = typeof b === 'string' ? JSON.parse(b) : b;
    const walk = (x: any): any => {
      if (x && typeof x === 'object') {
        if (Array.isArray(x)) return x.map(walk);
        const out: any = {};
        for (const [k,v] of Object.entries(x)) {
          const key = k.toLowerCase();
          out[k] = SENSITIVE.includes(key) ? '***redacted***' : walk(v);
        }
        return out;
      }
      return x;
    };
    return walk(json);
  } catch {
    return b; // si no es JSON, lo dejamos tal cual
  }
}

export function addLog(entry: DebugLog) {
  __LOGS.push(entry);
  if (__LOGS.length > LOG_LIMIT) __LOGS.splice(0, __LOGS.length - LOG_LIMIT);
  // Siempre a consola también
  // eslint-disable-next-line no-console
  console.log('[DEBUG]', entry.name, entry.request.url, entry.response?.status ?? '', entry.error ?? '');
}

export function getLogs() { return __LOGS; }
export function clearLogs() { __LOGS.length = 0; }

export async function fetchWithLog(name: string, url: string, init: RequestInit = {}, side: Side = 'server'): Promise<Response> {
  const t0 = Date.now();
  const method = (init.method || 'GET').toString().toUpperCase();
  const reqBody = (init.body && typeof init.body !== 'string') ? await (async () => {
    try { return JSON.parse(init.body as any); } catch { return init.body; }
  })() : init.body;

  let res: Response | undefined;
  let err: string | undefined;
  try {
    res = await fetch(url, init);
    return res;
  } catch (e: any) {
    err = e?.message || String(e);
    throw e;
  } finally {
    const durationMs = Date.now() - t0;
    let status = -1, headers: any, bodySnippet: string | undefined;
    try {
      if (res) {
        status = res.status;
        headers = redactHeaders(res.headers);
        const clone = res.clone();
        const text = await clone.text();
        bodySnippet = text.slice(0, 2000); // evita explotar UI
      }
    } catch {}
    addLog({
      ts: new Date().toISOString(),
      side,
      name,
      durationMs,
      request: { method, url, headers: redactHeaders(init.headers), body: redactBody(reqBody) },
      response: res ? { status, headers, bodySnippet } : undefined,
      error: err,
    });
  }
}
