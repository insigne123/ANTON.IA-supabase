import { NextRequest, NextResponse } from 'next/server';
import type { LeadFromApollo } from '@/lib/types';
import { fetchWithLog } from '@/lib/debug';
import * as San from '@/lib/input-sanitize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // <-- asegura Node runtime

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
};

const LOCKED_RE = /email_not_unlocked@domain\.com/i;

export async function POST(req: NextRequest) {
  try {
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
    } = (await req.json()) as Body;

    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'APOLLO_API_KEY missing' }, { status: 500 });

    // 1) Dominios: usar los entregados + resolver por nombre si hace falta
    const domainSet = new Set<string>(domains.filter(Boolean).map(d => d.toLowerCase()));
    const namesToResolve = Array.from(new Set((companyNames || []).map(normalizeName).filter(Boolean)));

    for (const name of namesToResolve) {
      const dom = await resolveDomainFromName(name, apiKey);
      if (dom) domainSet.add(dom.toLowerCase());
    }

    const domainList = Array.from(domainSet);
    if (domainList.length === 0) {
      return NextResponse.json({ leads: [], domains: [], note: 'Sin dominios para q_organization_domains_list' });
    }

    const rawTitles = (personTitles || []) as string[];
    const cleanTitles = rawTitles.map(San.sanitizeTitle).filter(Boolean);

    const rawLocs = (personLocations || []) as string[] | undefined;
    const cleanLocs = rawLocs?.map(San.sanitizeLocation).filter(Boolean);


    // 2) People search con paginación completa
    const leads: LeadFromApollo[] = [];
    let page = 1;
    const per = Math.max(1, Math.min(100, perPage));
    const maxP = Math.max(1, Math.min(500, maxPages));

    while (page <= maxP) {
      // --- construimos query con URLSearchParams (sin .searchParams.set) ---
      const qs = new URLSearchParams();
      // títulos (opcionales)
      cleanTitles.forEach(t => qs.append('person_titles[]', t));
      if (cleanTitles.length && similarTitles) {
        qs.set('person_titles_similar', 'true');  // algunas cuentas usan esta
        qs.set('similar_titles', 'true');         // otras usan esta
      }
      // dominios
      domainList.forEach(d => qs.append('q_organization_domains_list[]', d));
      // ubicación persona
      cleanLocs?.forEach(l => qs.append('person_locations[]', l));
      // emails verificados
      if (onlyVerifiedEmails) qs.append('contact_email_status[]', 'verified');
      // paginación
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
        return NextResponse.json({ error: txt, page }, { status: 502 });
      }

      const data = await res.json();
      const people: any[] = data?.people ?? [];
      for (const p of people) {
        const rawEmail = p.email ?? undefined;
        const isLocked = !!(rawEmail && LOCKED_RE.test(rawEmail));
        const outEmail = includeLockedEmails
          ? rawEmail
          : (isLocked ? undefined : rawEmail);
        
        leads.push({
          id: p.id ?? p.person_id, // <-- usamos id de Apollo
          fullName: p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
          title: p.title ?? p.headline ?? '',
          email: outEmail,
          lockedEmail: isLocked, // <-- flag para la UI
          guessedEmail: p.email_status === 'guessed',
          linkedinUrl: p.linkedin_url ?? undefined,
          location: [p.city, p.state, p.country].filter(Boolean).join(', ') || undefined,
          companyName: p.organization?.name ?? undefined,
          companyDomain: p.organization?.primary_domain ?? undefined,
        });
      }

      // paginación oficial
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
      if (people.length < per) break; // fallback
      page++;
    }

    // 3) Dedup opcional
    let final = leads;

    if (dedupe === 'id' || dedupe === 'smart') {
      const seen = new Set<string>();
      final = leads.filter(x => {
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
      final = leads.filter(x => {
        // si es locked, lo tratamos como "sin email" para no colapsar todos
        const k = x.email && !LOCKED_RE.test(x.email) ? x.email.toLowerCase() : '';
        if (!k) return true;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    // dedupe === 'none' => no tocamos la lista

    return NextResponse.json({ leads: final, total: leads.length, returned: final.length, domains: domainList });
  } catch (e: any) {
    console.error("[leads-apollo] fatal", { message: e?.message, stack: e?.stack });
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}

/* ===== helpers: org search + matching ===== */

async function resolveDomainFromName(companyNameRaw: string, apiKey: string): Promise<string | null> {
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
