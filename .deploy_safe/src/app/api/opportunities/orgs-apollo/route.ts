import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { searchCompaniesWithPDL } from '@/lib/providers/pdl';
import { isPdlFallbackEnabled, resolveLeadProvider } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = 'https://api.apollo.io/api/v1';

type Body = {
  companyName: string;      // tomado de la oportunidad guardada
  perPage?: number;         // default 8
  page?: number;            // default 1
  provider?: 'apollo' | 'pdl';
};

export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireAuth();
    const { companyName, perPage = 8, page = 1, provider } = (await req.json()) as Body;
    if (!companyName?.trim()) {
      return NextResponse.json({ error: 'companyName requerido' }, { status: 400 });
    }

    const providerDecision = resolveLeadProvider({
      requestedProvider: provider,
      organizationId,
      defaultProviderEnv: 'LEADS_PROVIDER_DEFAULT',
      fallbackDefaultProvider: 'apollo',
    });

    let providerUsed: 'apollo' | 'pdl' = providerDecision.provider;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;
    let candidates: any[] = [];

    if (providerDecision.provider === 'pdl') {
      try {
        candidates = await searchOrgsPdl(companyName, perPage);
      } catch (error: any) {
        if (!isPdlFallbackEnabled()) {
          throw error;
        }
        fallbackApplied = true;
        fallbackReason = error?.message || 'pdl_company_search_failed';
        providerUsed = 'apollo';
        candidates = await searchOrgsApollo(companyName, perPage, page);
      }
    } else {
      candidates = await searchOrgsApollo(companyName, perPage, page);
    }

    const response = NextResponse.json({
      candidates,
      providerRequested: providerDecision.requestedProvider,
      providerUsed,
      providerDefault: providerDecision.defaultProvider,
      fallbackApplied,
      fallbackReason,
      providerForcedReason: providerDecision.forcedApolloReason,
    });
    response.headers.set('x-provider-used', providerUsed);
    return response;
  } catch (e: any) {
    const authRes = handleAuthError(e);
    if (authRes.status !== 500 || e.name === 'AuthError') return authRes;

    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}

async function searchOrgsApollo(companyName: string, perPage: number, page: number) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error('APOLLO_API_KEY missing');

  const qs = new URLSearchParams();
  qs.set('per_page', String(Math.max(1, Math.min(25, perPage))));
  qs.set('page', String(Math.max(1, page)));
  qs.append('q_organization_name', companyName);

  const url = `${BASE}/mixed_companies/search?${qs.toString()}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`apollo_company_search_failed:${r.status}:${text.slice(0, 300)}`);
  }

  const j = await r.json();
  const orgs: any[] = j?.organizations || [];
  const normTarget = normalizeName(companyName);

  return orgs
    .map((o) => {
      const domain = o.primary_domain || cleanDomain(o.website_url) || undefined;
      return {
        id: o.id,
        name: o.name,
        website_url: o.website_url || (domain ? `https://${domain}` : undefined),
        linkedin_url: o.linkedin_url || o.linkedin_url_clean,
        primary_domain: domain,
        logo: domain ? `https://logo.clearbit.com/${domain}` : undefined,
        score: similarityScore(normTarget, normalizeName(o.name || '')),
      };
    })
    .sort((a, b) => b.score - a.score);
}

async function searchOrgsPdl(companyName: string, perPage: number) {
  const size = Math.max(1, Math.min(25, perPage));
  const sql = `SELECT * FROM company WHERE ${containsClause('name', companyName)}`;
  const result = await searchCompaniesWithPDL({
    sql,
    size,
    dataInclude: ['id', 'name', 'website', 'linkedin_url'],
  });

  const orgs = Array.isArray(result.data) ? result.data : [];
  const normTarget = normalizeName(companyName);

  return orgs
    .map((o: any) => {
      const domain = cleanDomain(o.website) || undefined;
      return {
        id: o.id,
        name: o.name,
        website_url: o.website || (domain ? `https://${domain}` : undefined),
        linkedin_url: o.linkedin_url,
        primary_domain: domain,
        logo: domain ? `https://logo.clearbit.com/${domain}` : undefined,
        score: similarityScore(normTarget, normalizeName(o.name || '')),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/* helpers */

function normalizeName(s: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(grupo|the)\b/g, ' ')
    .replace(/\b(s\.?a\.?|s\.?p\.?a\.?|ltda|llc|inc|corp(oration)?|company|co|gmbh|srl|s\.?l\.?|plc|ag|sa de cv)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a: string, b: string) {
  if (!a || !b) return 0;
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  const inter = [...A].filter((t) => B.has(t)).length;
  const union = new Set([...A, ...B]).size;
  let score = union ? inter / union : 0;
  if (b.startsWith(a) || a.startsWith(b)) score += 0.25;
  if (a.includes(b) || b.includes(a)) score += 0.15;
  return Math.min(score, 1);
}

function cleanDomain(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = u.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = String(url).toLowerCase().replace(/^https?:\/\//, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

function containsClause(field: string, value: string) {
  const escaped = String(value || '').trim().replace(/'/g, "''").replace(/%/g, '').replace(/_/g, '');
  return `${field} LIKE '%${escaped}%'`;
}
