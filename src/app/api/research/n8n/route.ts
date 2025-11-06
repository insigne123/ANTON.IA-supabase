// src/app/api/research/n8n/route.ts
// Proxy seguro hacia n8n para investigación de leads.
// Variables requeridas:
//   - N8N_RESEARCH_WEBHOOK_URL (p.ej. https://n8n.tu-dominio/webhook/research)
//   - (alternativa aceptada) N8N_WEBHOOK_URL
//   - (opcional) N8N_API_KEY para Authorization: Bearer <key>

import { extractJsonFromMaybeFenced } from '@/lib/extract-json';

export const dynamic = 'force-dynamic'; // evita caché
export const revalidate = 0;
export const runtime = 'nodejs';

type LeadPayload = {
  id?: string | null;
  fullName?: string | null;
  title?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  [k: string]: any;
};

type N8nResponse = {
  reports?: any[];
  skipped?: string[];
  error?: string;
  [k: string]: any;
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch((e) => { clearTimeout(t); reject(e); });
  });
}

export async function GET(): Promise<Response> {
  const hasUrl = !!(
    process.env.N8N_RESEARCH_WEBHOOK_URL ||
    process.env.N8N_WEBHOOK_URL
  );
  return new Response(JSON.stringify({ ok: true, hasUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const webhook =
    process.env.N8N_RESEARCH_WEBHOOK_URL ||
    process.env.N8N_WEBHOOK_URL; // ← compatibilidad con tu .env compartido
  if (!webhook) {
    console.error('[research:n8n] Falta N8N_RESEARCH_WEBHOOK_URL');
    return json(500, { error: 'Server not configured: N8N_RESEARCH_WEBHOOK_URL' });
  }

  // Hacemos opcional el header; si no viene, usar fallback estable
  const userId = req.headers.get('x-user-id') || 'anon';

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  // --- NUEVO: soportar también body.companies[0] { lead:{...}, targetCompany:{...}, leadRef } ---
  const c0 = Array.isArray(body?.companies) && body.companies.length
    ? body.companies[0]
    : null;
  const c0Lead = c0?.lead || null;
  const c0Company = c0?.targetCompany || c0?.company || null;

  const canon: LeadPayload = {
    id: body?.id ?? body?.lead?.id ?? body?.payload?.id ?? body?.personId ?? c0Lead?.id ?? null,
    fullName:
      body?.fullName ?? body?.lead?.fullName ?? body?.person?.fullName ?? body?.name ?? c0Lead?.fullName ?? null,
    title: body?.title ?? body?.lead?.title ?? body?.person?.title ?? c0Lead?.title ?? null,
    email:
      body?.email ??
      body?.lead?.email ??
      body?.person?.email ??
      body?.payload?.email ??
      c0Lead?.email ??
      null,
    linkedinUrl:
      body?.linkedinUrl ??
      body?.lead?.linkedinUrl ??
      body?.person?.linkedinUrl ??
      c0Lead?.linkedinUrl ??
      null,
    companyName:
      body?.companyName ??
      body?.lead?.companyName ??
      body?.company?.name ??
      c0Company?.name ??
      null,
    companyDomain:
      body?.companyDomain ??
      body?.lead?.companyDomain ??
      body?.company?.domain ??
      c0Company?.domain ??
      null,
  };

  // Validación básica: al menos un identificador útil
  const hasAnyId =
    !!canon.id ||
    !!canon.email ||
    !!canon.linkedinUrl ||
    (!!canon.fullName && (!!canon.companyName || !!canon.companyDomain));

  if (!hasAnyId) {
    return json(400, { error: 'Payload incompleto: requiere id/email/linkedin o nombre+empresa' });
  }

  // Reenvío a n8n
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  };
  const apiKey = process.env.N8N_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let n8nRes: Response;
  try {
    // Reenviamos el body original pero garantizando campos canónicos en raíz
    const forward = { ...body, ...canon };
    n8nRes = await withTimeout(fetch(webhook, {
      method: 'POST',
      headers,
      body: JSON.stringify(forward),
      // Evita colas/caches intermedias
      cache: 'no-store',
    }), 20000);
  } catch (e: any) {
    console.error('[research:n8n] fetch error:', e?.message || e);
    return json(e?.message === 'timeout' ? 504 : 502, { error: 'n8n unreachable', reason: e?.message || 'fetch_failed' });
  }

  let result: N8nResponse | string;
  const text = await n8nRes.text(); // lee texto primero, luego intenta parsear
  try {
    result = JSON.parse(text);
  } catch {
    result = text;
  }

  if (!n8nRes.ok) {
    console.warn('[research:n8n] n8n HTTP', n8nRes.status, result);
    return json(n8nRes.status, typeof result === 'string' ? { error: result } : result);
  }

  // Normalizamos campos esperados por el cliente
  const out: N8nResponse =
    typeof result === 'string'
      ? { reports: [], skipped: [], text: result }
      : {
          reports: Array.isArray(result.reports) ? result.reports : [],
          skipped: Array.isArray(result.skipped) ? result.skipped : [],
          ...result,
        };

  // --- Fallback: n8n devolvió un mensaje con JSON en message.content ---
  try {
    if ((!out.reports || out.reports.length === 0) && (result as any)?.message?.content) {
      const parsed = extractJsonFromMaybeFenced((result as any).message?.content);
      if (parsed && typeof parsed === 'object') {
        const leadRef =
          canon.id ||
          canon.email ||
          canon.linkedinUrl ||
          `${canon.fullName || ''}|${canon.companyName || canon.companyDomain || ''}`;

        const company = (parsed as any).company || {};
        out.reports = [{
          cross: parsed,
          company: {
            name: company.name || (canon.companyName ?? ''),
            domain: company.domain || (canon.companyDomain ?? ''),
          },
          meta: { leadRef },
          createdAt: new Date().toISOString(),
        }];
      }
    }
  } catch (e) {
    console.warn('[research:n8n] fallback parse failed:', (e as any)?.message);
  }

  console.info('[research:n8n] OK → n8n aceptó', { userId, reports: out.reports?.length ?? 0, skipped: out.skipped?.length ?? 0 });
  return json(200, out);
}
