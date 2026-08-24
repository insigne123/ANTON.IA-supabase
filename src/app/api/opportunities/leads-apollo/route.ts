// src/app/api/opportunities/leads-apollo/route.ts
import { NextRequest, NextResponse } from 'next/server';
import type { LeadFromApollo } from '@/lib/types';
import { fetchWithLog } from '@/lib/debug';
import * as San from '@/lib/input-sanitize';
import { requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { resolveLeadProvider } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = 'https://api.apollo.io/api/v1';

type Body = {
  personTitles?: string[];
  domains?: string[];
  companyNames?: string[];
  personLocations?: string[];
  perPage?: number;
  maxPages?: number;
  onlyVerifiedEmails?: boolean;
  similarTitles?: boolean;
  dedupe?: 'smart' | 'id' | 'email' | 'none'; // default 'smart'
  includeLockedEmails?: boolean; // default true (se muestran, pero no deduplican)
  provider?: unknown;
};

const LOCKED_RE = /email_not_unlocked@domain\.com/i;
type SearchResult = {
  leads: LeadFromApollo[];
  total: number;
  returned: number;
  domains: string[];
};

export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireAuth();

    // We could check quota here too if needed (e.g. 'leadSearch' quota)

    const body = (await req.json()) as Body;
    const providerDecision = resolveLeadProvider({
      requestedProvider: body.provider,
      organizationId,
    });

    const providerUsed = providerDecision.provider;
    const result = await searchLeadsWithApollo(body);

    const response = NextResponse.json({
      ...result,
      providerRequested: providerDecision.requestedProvider,
      providerUsed,
      providerDefault: providerDecision.defaultProvider,
      fallbackApplied: false,
      providerForcedReason: providerDecision.forcedApolloReason,
    });
    response.headers.set('x-provider-used', providerUsed);
    return response;
  } catch (e: any) {
    const authRes = handleAuthError(e);
    if (authRes.status !== 500 || e.name === 'AuthError') return authRes;

    console.error("[leads-apollo] fatal", { message: e?.message, stack: e?.stack });
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}

async function searchLeadsWithApollo(body: Body): Promise<SearchResult> {
  const {
    personTitles = [],
    domains = [],
    companyNames = [],
    personLocations,
    perPage = 50,
    maxPages = 10,
    onlyVerifiedEmails = true,
    similarTitles = true,
    dedupe = 'smart',
    includeLockedEmails = true,
  } = body;

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error('APOLLO_API_KEY missing');

  const domainSet = new Set<string>(domains.filter(Boolean).map((d) => d.toLowerCase()));
  const namesToResolve = Array.from(new Set((companyNames || []).map(normalizeName).filter(Boolean)));

  for (const name of namesToResolve) {
    const dom = await resolveDomainFromNameApollo(name, apiKey);
    if (dom) domainSet.add(dom.toLowerCase());
  }

  const domainList = Array.from(domainSet);
  if (domainList.length === 0) {
    return { leads: [], total: 0, returned: 0, domains: [] };
  }

  const rawTitles = (personTitles || []) as string[];
  const cleanTitles = rawTitles.map(San.sanitizeTitle).filter(Boolean);

  const rawLocs = (personLocations || []) as string[] | undefined;
  const cleanLocs = rawLocs?.map(San.sanitizeLocation).filter(Boolean);

  const leads: LeadFromApollo[] = [];
  let page = 1;
  const per = Math.max(1, Math.min(100, perPage));
  const maxP = Math.max(1, Math.min(500, maxPages));

  while (page <= maxP) {
    const qs = new URLSearchParams();
    cleanTitles.forEach((t) => qs.append('person_titles[]', t));
    if (cleanTitles.length && similarTitles) {
      qs.set('person_titles_similar', 'true');
      qs.set('similar_titles', 'true');
    }
    domainList.forEach((d) => qs.append('q_organization_domains_list[]', d));
    cleanLocs?.forEach((l) => qs.append('person_locations[]', l));
    if (onlyVerifiedEmails) qs.append('contact_email_status[]', 'verified');
    qs.set('per_page', String(per));
    qs.set('page', String(page));

    const url = `${BASE}/mixed_people/search?${qs.toString()}`;
    const res = await fetchWithLog('APOLLO people search', url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`apollo_search_failed:${res.status}:${txt.slice(0, 300)}`);
    }

    const data = await res.json();
    const people: any[] = data?.people ?? [];
    for (const p of people) {
      const rawEmail = p.email ?? undefined;
      const isLocked = !!(rawEmail && LOCKED_RE.test(rawEmail));
      const outEmail = includeLockedEmails ? rawEmail : (isLocked ? undefined : rawEmail);

      leads.push({
        id: p.id ?? p.person_id,
        fullName: p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
        title: p.title ?? p.headline ?? '',
        email: outEmail,
        lockedEmail: isLocked,
        guessedEmail: p.email_status === 'guessed',
        linkedinUrl: p.linkedin_url ?? undefined,
        location: [p.city, p.state, p.country].filter(Boolean).join(', ') || undefined,
        companyName: p.organization?.name ?? undefined,
        companyDomain: p.organization?.primary_domain ?? undefined,
      });
    }

    const nextPage = Number(data?.pagination?.next_page || 0);
    const totalPages = Number(data?.pagination?.total_pages || 0);

    if (totalPages > 0) {
      if (page >= Math.min(totalPages, maxP)) break;
      page++;
      continue;
    }
    if (nextPage && page < maxP) {
      page = nextPage;
      continue;
    }
    if (people.length < per) break;
    page++;
  }

  const final = dedupeLeads(leads, dedupe);
  return { leads: final, total: leads.length, returned: final.length, domains: domainList };
}

function dedupeLeads(leads: LeadFromApollo[], dedupe: Body['dedupe']) {
  let final = leads;

  if (dedupe === 'id' || dedupe === 'smart') {
    const seen = new Set<string>();
    final = leads.filter((x) => {
      const key =
        (dedupe === 'id' ? x.id : undefined) ||
        x.id || x.linkedinUrl || `${x.fullName}|${x.companyDomain || x.companyName}|${x.title}`;
      const k = (key || '').toLowerCase();
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } else if (dedupe === 'email') {
    const seen = new Set<string>();
    final = leads.filter((x) => {
      const k = x.email && !LOCKED_RE.test(x.email) ? x.email.toLowerCase() : '';
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return final;
}

/* ===== helpers: org search + matching ===== */

async function resolveDomainFromNameApollo(companyNameRaw: string, apiKey: string): Promise<string | null> {
  // pedimos hasta 5 y elegimos el más parecido; si no supera umbral, tomamos el primero
  const qs = new URLSearchParams();
  qs.set('per_page', '5');
  qs.append('q_organization_name', companyNameRaw);
  const url = `${BASE}/mixed_companies/search?${qs.toString()}`;

  const r = await fetchWithLog('APOLLO org search', url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
  if (!r.ok) return null;

  const j = await r.json();
  const orgs: any[] = j?.organizations || [];
  if (orgs.length === 0) return null;

  const best = pickBestOrgMatch(companyNameRaw, orgs);
  const chosen = best || orgs[0];
  return chosen?.primary_domain || cleanDomain(chosen?.website_url) || null;
}

function pickBestOrgMatch(targetNameRaw: string, orgs: any[]) {
  const target = normalizeName(targetNameRaw);
  let best: any = null, bestScore = -1;
  for (const org of orgs) {
    const candidate = normalizeName(org?.name || '');
    const score = similarityScore(target, candidate);
    if (score > bestScore) { bestScore = score; best = org; }
  }
  return bestScore >= 0.45 ? best : null;
}

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
  const inter = [...A].filter(t => B.has(t)).length;
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
