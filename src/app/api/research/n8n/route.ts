// src/app/api/research/n8n/route.ts
// Proxy seguro hacia n8n para investigación de leads.
// Variables requeridas:
//   - N8N_RESEARCH_WEBHOOK_URL (p.ej. https://n8n.tu-dominio/webhook/research)
//   - (alternativa aceptada) N8N_WEBHOOK_URL
//   - (opcional) N8N_API_KEY para Authorization: Bearer <key>

//   - (opcional) N8N_API_KEY para Authorization: Bearer <key>

import { extractJsonFromMaybeFenced } from '@/lib/extract-json';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

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

function getWebhookTimeoutMs() {
  const raw = Number(process.env.N8N_RESEARCH_TIMEOUT_MS || process.env.LEADS_N8N_TIMEOUT_MS || 120000);
  if (!Number.isFinite(raw)) return 120000;
  return Math.min(240000, Math.max(10000, Math.trunc(raw)));
}

function getTextFromMaybeFenced(raw: any) {
  let s = String(raw || '').trim();
  if (!s) return '';

  const fence = String.fromCharCode(96).repeat(3);
  const first = s.indexOf(fence);
  if (first >= 0) {
    let after = s.slice(first + fence.length);
    const nl = after.indexOf('\n');
    if (nl >= 0) after = after.slice(nl + 1);
    const second = after.indexOf(fence);
    s = second >= 0 ? after.slice(0, second) : after;
  }

  return s.trim();
}

function parseResearchJson(raw: any) {
  const strict = extractJsonFromMaybeFenced(raw);
  if (strict && typeof strict === 'object') return strict;

  const text = getTextFromMaybeFenced(raw);
  const start = text.indexOf('{');
  if (start < 0) return null;

  const sliced = text.slice(start).trim();
  const end = sliced.lastIndexOf('}');
  if (end > 0) {
    try {
      return JSON.parse(sliced.slice(0, end + 1));
    } catch {
      // continue with a targeted salvage below
    }
  }

  // n8n/OpenAI can occasionally truncate optional tail blocks. Keep the report body.
  const optionalTailKeys = ['nextSteps', 'confidence', 'contradictions', 'sources'];
  for (const key of optionalTailKeys) {
    const optionalTail = sliced.match(new RegExp(`,\\s*"${key}"\\s*:`));
    if (optionalTail?.index && optionalTail.index > 0) {
      try {
        return JSON.parse(`${sliced.slice(0, optionalTail.index)}\n}`);
      } catch {
        // Try the next optional tail key.
      }
    }
  }

  return null;
}

function extractCitationSources(result: any) {
  const sources: Array<{ title?: string; url: string }> = [];
  const addAnnotations = (annotations: any) => {
    for (const annotation of Array.isArray(annotations) ? annotations : []) {
      const citation = annotation?.url_citation;
      const url = String(citation?.url || '').trim();
      if (!url) continue;

      const exists = sources.some((source) => source.url.toLowerCase() === url.toLowerCase());
      if (!exists) sources.push({ title: citation?.title || undefined, url });
    }
  };

  addAnnotations(result?.message?.annotations);
  addAnnotations(result?.annotations);
  addAnnotations(result?.json?.message?.annotations);
  addAnnotations(result?.json?.annotations);

  if (Array.isArray(result)) {
    for (const item of result) {
      addAnnotations(item?.message?.annotations);
      addAnnotations(item?.annotations);
      addAnnotations(item?.json?.message?.annotations);
      addAnnotations(item?.json?.annotations);
    }
  }

  return sources;
}

function mergeSources(value: any, fallbackSources: Array<{ title?: string; url: string }>) {
  const sources = Array.isArray(value) ? value : [];
  const merged: Array<{ title?: string; url: string }> = [];

  for (const source of [...sources, ...fallbackSources]) {
    const url = String(source?.url || '').trim();
    if (!url) continue;

    const exists = merged.some((item) => item.url.toLowerCase() === url.toLowerCase());
    if (!exists) merged.push({ title: source?.title || source?.name || undefined, url });
  }

  return merged;
}

function getResultObject(result: any) {
  if (Array.isArray(result)) {
    const withJson = result.find((item) => item?.json && typeof item.json === 'object')?.json;
    if (withJson) return withJson;
    return result.find((item) => item && typeof item === 'object') || {};
  }

  return result && typeof result === 'object' ? result : {};
}

function getMessageContentCandidates(result: any) {
  const candidates: string[] = [];
  const add = (value: any) => {
    const text = String(value || '').trim();
    if (text && !candidates.includes(text)) candidates.push(text);
  };

  if (typeof result === 'string') add(result);
  add(result?.message?.content);
  add(result?.json?.message?.content);
  add(result?.content);
  add(result?.json?.content);

  if (Array.isArray(result)) {
    for (const item of result) {
      add(item?.message?.content);
      add(item?.json?.message?.content);
      add(item?.content);
      add(item?.json?.content);
    }
  }

  return candidates;
}

function buildLeadRef(canon: LeadPayload) {
  return String(
    canon.id ||
    canon.email ||
    canon.linkedinUrl ||
    `${canon.fullName || ''}|${canon.companyName || canon.companyDomain || ''}`
  ).trim();
}

function buildReportFromCross(parsed: any, canon: LeadPayload, fallbackSources: Array<{ title?: string; url: string }> = []) {
  const company = parsed?.company || {};
  const cross = {
    ...parsed,
    sources: mergeSources(parsed?.sources, fallbackSources),
  };

  return {
    cross,
    company: {
      name: company.name || canon.companyName || '',
      domain: company.domain || canon.companyDomain || '',
    },
    meta: { leadRef: buildLeadRef(canon) },
    createdAt: new Date().toISOString(),
  };
}

function extractReportsFromMessageContent(result: any, canon: LeadPayload) {
  const fallbackSources = extractCitationSources(result);
  for (const content of getMessageContentCandidates(result)) {
    const parsed = parseResearchJson(content);
    if (!parsed || typeof parsed !== 'object') continue;

    if (Array.isArray((parsed as any).reports)) return (parsed as any).reports;
    return [buildReportFromCross(parsed, canon, fallbackSources)];
  }

  return [];
}

export async function GET(): Promise<Response> {
  const hasUrl = !!(
    process.env.ANTONIA_N8N_WEBHOOK_URL ||
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
    process.env.ANTONIA_N8N_WEBHOOK_URL ||
    process.env.N8N_RESEARCH_WEBHOOK_URL ||
    process.env.N8N_WEBHOOK_URL; // ← compatibilidad con tu .env compartido
  if (!webhook) {
    console.error('[research:n8n] Falta N8N_RESEARCH_WEBHOOK_URL');
    return json(500, { error: 'Server not configured: N8N_RESEARCH_WEBHOOK_URL' });
  }

  // --- Authenticate User via Session (Cookies) ---
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  const userIdHeader = req.headers.get('x-user-id')?.trim() || '';
  if (!user?.id && userIdHeader && !isTrustedInternalRequest(req)) {
    return json(401, { error: 'UNAUTHORIZED_INTERNAL_REQUEST' });
  }
  const userId = user?.id || userIdHeader;
  if (!userId) {
    return json(401, { error: 'UNAUTHORIZED' });
  }

  // Fallback to header only if session is missing (e.g. server-to-server calls?? unlikely in this app context)
  // const userIdHeader = req.headers.get('x-user-id');
  // const finalUserId = userId !== 'anon' ? userId : (userIdHeader || 'anon');

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

  // --- FETCH USER PROFILE (Name & Job Title) ---
  // If userContext is already provided in body (e.g. from Cloud Function), use it.
  // Otherwise, fetch from DB (frontend calls).
  // --- FETCH USER PROFILE & ORGANIZATION ---
  let userContext = body.userContext;
  let organizationId: string | null = null;
  let useSocialContext = false;

  if (userId) {
    // 1. Fetch User details
    let userJobTitle: string | null = null;
    let userFullName: string | null = null;
    let userCompanyName: string | null = null;
    let userCompanyDomain: string | null = null;

    try {
      // Fetch Profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, job_title, company_name, company_domain')
        .eq('id', userId)
        .single();

      if (profile) {
        userJobTitle = profile.job_title || null;
        userFullName = profile.full_name || null;
        userCompanyName = profile.company_name || null;
        userCompanyDomain = profile.company_domain || null;
      }

      // 2. Fetch Organization & Credits
      // Try to find org via members table
      const { data: member } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1)
        .single();

      if (member) {
        organizationId = member.organization_id;

        // Check credits
        const { data: org } = await supabase
          .from('organizations')
          .select('social_search_credits, feature_social_search_enabled')
          .eq('id', organizationId)
          .single();

        if (org) {
          const credits = org.social_search_credits ?? 0; // Default 0 if null (though migration sets 100)
          const enabled = org.feature_social_search_enabled ?? true;

          if (enabled && credits > 0) {
            useSocialContext = true;
          }
          console.log('[research:n8n] Org Check:', { organizationId, credits, enabled, useSocialContext });
        } else {
          console.warn('[research:n8n] Organization not found for ID:', organizationId);
        }
      }

    } catch (err) {
      console.warn('[research:n8n] Failed to fetch user/org profile:', err);
    }

    if (!userContext) {
      userContext = {
        id: userId,
        name: userFullName,
        jobTitle: userJobTitle,
        company: {
          name: userCompanyName,
          domain: userCompanyDomain
        }
      };
    }
  }

  const forwardOrganizationId = String(body?.organization_id || organizationId || '').trim() || null;
  const forwardScopeKey = String(body?.scope_key || body?.scopeKey || forwardOrganizationId || `user:${userId}`).trim();

  let n8nRes: Response;
  try {
    // Reenviamos el body original pero garantizando campos canónicos en raíz
    // Add userContext and social search flag
    // We send `use_social_context` explicitly for n8n to switch logic
    const forward = {
      ...body,
      ...canon,
      user_id: body?.user_id || userId,
      organization_id: forwardOrganizationId,
      scope_key: forwardScopeKey,
      userContext,
      use_social_context: useSocialContext
    };

    const timeoutMs = getWebhookTimeoutMs();
    n8nRes = await withTimeout(fetch(webhook, {
      method: 'POST',
      headers,
      body: JSON.stringify(forward),
      // Evita colas/caches intermedias
      cache: 'no-store',
    }), timeoutMs);
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

  // --- DEDUCT CREDITS IF SUCCESS AND USED ---
  // --- DEDUCT CREDITS IF SUCCESS AND USED ---
  if (useSocialContext && organizationId) {
    // Must await in serverless/Next.js to ensure execution before teardown
    try {
      const { data, error } = await supabase.rpc('decrement_social_credit', { org_id: organizationId });
      if (error) {
        console.error('[research:n8n] Failed to decrement credits:', error);
      } else {
        console.info('[research:n8n] Credits decremented. New balance:', data);
      }
    } catch (err) {
      console.error('[research:n8n] Unexpected error decrementing credits:', err);
    }
  }

  // Normalizamos campos esperados por el cliente
  const resultObject = getResultObject(result);
  const out: N8nResponse =
    typeof result === 'string'
      ? { reports: [], skipped: [], text: result }
      : {
        reports: Array.isArray(resultObject.reports) ? resultObject.reports : [],
        skipped: Array.isArray(resultObject.skipped) ? resultObject.skipped : [],
        ...resultObject,
      };

  // --- Fallback: n8n devolvió un mensaje con JSON en message.content ---
  try {
    if (!out.reports || out.reports.length === 0) {
      out.reports = extractReportsFromMessageContent(result, canon);
    }
  } catch (e) {
    console.warn('[research:n8n] fallback parse failed:', (e as any)?.message);
  }

  if (!out.reports || out.reports.length === 0) {
    console.warn('[research:n8n] n8n returned no parseable reports', { userId, resultType: Array.isArray(result) ? 'array' : typeof result });
    return json(502, { error: 'N8N_RESPONSE_UNPARSEABLE', message: 'n8n no devolvio un reporte interpretable' });
  }

  console.info('[research:n8n] OK → n8n aceptó', { userId, useSocialContext, reports: out.reports?.length ?? 0, skipped: out.skipped?.length ?? 0 });
  return json(200, out);
}
